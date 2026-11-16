import { useEffect, useRef, useState } from 'react';
import type { HubApp } from '../../model';
import { cancelInstall, installApp, updateApp, onInstallProgress, type InstallError, type InstallPhase, type InstallProgress } from './index';

type Operation = 'install' | 'update';
type DisplayError = InstallError | { status: 'unexpected' | 'appStillRunning' } | { status: 'versionMismatch'; version: string };
type Running = { status: 'running'; operation: Operation; progress: InstallProgress; cancelling: boolean; cancelError?: 'cancelFailed' | 'cleanupFailed'; cleanupFailed?: boolean };
export type InstallEntry = Running | { status: 'error'; operation: Operation; error: DisplayError; cleanupFailed?: boolean } | { status: 'installed' | 'installedUnverified'; operation: 'install' } | { status: 'updated' | 'upToDate'; operation: 'update'; version: string };
type Claim = { operation: Operation; phase: InstallPhase; cancelling: boolean; cancelError?: Running['cancelError']; cleanupFailed?: boolean };
const phases: InstallPhase[] = ['fetching', 'awaitingApproval', 'downloading', 'verifying', 'closing', 'installing', 'detecting'];

/** Owned by the flyout, not the unmounting catalog tab; native remains the authority. */
export function useCatalogInstalls(enabled: boolean, apps: HubApp[], onRefresh?: () => void) {
  const [entries, setEntries] = useState(() => new Map<string, InstallEntry>());
  const entriesRef = useRef(entries);
  const claims = useRef(new Map<string, Claim>());
  const observedUnknown = useRef(new Set<string>());
  const refresh = useRef(onRefresh); refresh.current = onRefresh;
  const mounted = useRef(true);
  const [connection, setConnection] = useState<'pending' | 'ready' | 'error'>('pending');
  const [attempt, setAttempt] = useState(0);

  function put(id: string, entry: InstallEntry) {
    if (!mounted.current) return;
    const next = new Map(entriesRef.current); next.set(id, entry);
    entriesRef.current = next; setEntries(next);
  }
  function remove(id: string) {
    if (!mounted.current) return;
    const next = new Map(entriesRef.current); next.delete(id);
    entriesRef.current = next; setEntries(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    setConnection('pending');
    void onInstallProgress(progress => {
      const claim = claims.current.get(progress.id);
      if (progress.cleanupFailed) {
        if (claim) claim.cleanupFailed = true;
        const current = entriesRef.current.get(progress.id);
        if (current?.status === 'running' || current?.status === 'error') put(progress.id, { ...current, cleanupFailed: true });
        else if (current) put(progress.id, { status: 'error', operation: current.operation, error: { status: 'cleanupFailed' } });
        return;
      }
      if (!claim || phases.indexOf(progress.phase) < phases.indexOf(claim.phase)) return;
      claim.phase = progress.phase;
      put(progress.id, { status: 'running', operation: claim.operation, progress, cancelling: claim.cancelling, cancelError: claim.cancelError, cleanupFailed: claim.cleanupFailed });
    }).then(unlisten => {
      if (disposed) unlisten();
      else { stop = unlisten; setConnection('ready'); }
    }).catch(() => { if (!disposed) setConnection('error'); });
    return () => { disposed = true; stop?.(); };
  }, [enabled, attempt]);

  // Keep a confirmed result hidden while refresh is pending, then defer to the next observation.
  useEffect(() => {
    for (const [id, entry] of entriesRef.current) {
      if (entry.status !== 'installed' && entry.status !== 'installedUnverified') continue;
      const app = apps.find(item => item.source === 'official' && item.id === id);
      if (entry.status === 'installedUnverified') {
        if (app?.statusKnown === true && (app.installed || app.installationState === 'installed')) remove(id);
        continue;
      }
      if (!app || app.statusKnown === false || app.installationState === 'unknown') observedUnknown.current.add(id);
      else if (app.installed || app.installationState === 'installed' || observedUnknown.current.has(id)) {
        observedUnknown.current.delete(id); remove(id);
      }
    }
  }, [apps]);

  function start(id: string, operation: Operation = 'install') {
    if (connection !== 'ready' || claims.current.has(id)) return;
    const claim: Claim = { operation, phase: 'fetching', cancelling: false };
    claims.current.set(id, claim);
    put(id, { status: 'running', operation, progress: { id, phase: 'fetching' }, cancelling: false });
    const request = operation === 'update' ? updateApp(id) : installApp(id);
    void request.then(result => {
      if (claims.current.get(id) !== claim) return;
      claims.current.delete(id);
      if (result.status === 'installed' || result.status === 'installedUnverified' || result.status === 'updated' || result.status === 'upToDate') {
        if (claim.cleanupFailed) put(id, { status: 'error', operation, error: { status: 'cleanupFailed' } });
        else if (result.status === 'installed' || result.status === 'installedUnverified') put(id, { status: result.status, operation: 'install' });
        else put(id, { status: result.status, operation: 'update', version: result.version });
        refresh.current?.();
      } else if (result.status === 'cancelled') {
        if (claim.cleanupFailed) put(id, { status: 'error', operation, error: { status: 'cleanupFailed' } });
        else remove(id);
      } else {
        put(id, { status: 'error', operation, error: result, cleanupFailed: claim.cleanupFailed });
        if (result.status === 'alreadyInstalled' || result.status === 'detectionUnknown' || result.status === 'notDetected' || result.status === 'versionMismatch') refresh.current?.();
      }
    }).catch(() => {
      if (claims.current.get(id) !== claim) return;
      claims.current.delete(id); put(id, { status: 'error', operation, error: { status: 'unexpected' }, cleanupFailed: claim.cleanupFailed });
    });
  }

  function cancel(id: string) {
    const claim = claims.current.get(id);
    if (!claim || claim.cancelling || phases.indexOf(claim.phase) >= phases.indexOf('installing')) return;
    claim.cancelling = true; claim.cancelError = undefined;
    const current = entriesRef.current.get(id);
    if (current?.status === 'running') put(id, { ...current, cancelling: true, cancelError: undefined });
    void cancelInstall(id).then(result => {
      if (claims.current.get(id) !== claim) return;
      claim.cancelling = false;
      if (result === 'tooLate') claim.phase = 'installing';
      if (result === 'cleanupFailed') claim.cancelError = 'cleanupFailed';
      if (result === 'notRunning') claim.cancelError = 'cancelFailed';
      const latest = entriesRef.current.get(id);
      if (latest?.status === 'running') put(id, { ...latest, progress: { ...latest.progress, phase: claim.phase }, cancelling: result === 'cancelled', cancelError: claim.cancelError });
    }).catch(() => {
      if (claims.current.get(id) !== claim) return;
      claim.cancelling = false; claim.cancelError = 'cancelFailed';
      const latest = entriesRef.current.get(id);
      if (latest?.status === 'running') put(id, { ...latest, cancelling: false, cancelError: claim.cancelError });
    });
  }

  return { entries, connection: enabled ? connection : 'error' as const, start, startUpdate: (id: string) => start(id, 'update'), cancel, retryConnection: () => setAttempt(value => value + 1) };
}
export type CatalogInstalls = ReturnType<typeof useCatalogInstalls>;
