import { useEffect, useRef, useState } from 'react';
import type { HubApp } from '../../model';
import { cancelInstall, installApp, onInstallProgress, type InstallError, type InstallPhase, type InstallProgress } from './index';

type DisplayError = InstallError | { status: 'unexpected' };
type Running = { status: 'running'; progress: InstallProgress; cancelling: boolean; cancelError?: 'cancelFailed' | 'cleanupFailed'; cleanupFailed?: boolean };
export type InstallEntry = Running | { status: 'error'; error: DisplayError; cleanupFailed?: boolean } | { status: 'installed' };
type Claim = { phase: InstallPhase; cancelling: boolean; cancelError?: Running['cancelError']; cleanupFailed?: boolean };
const phases: InstallPhase[] = ['fetching', 'awaitingApproval', 'downloading', 'verifying', 'installing', 'detecting'];

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
        else if (current?.status === 'installed') put(progress.id, { status: 'error', error: { status: 'cleanupFailed' } });
        return;
      }
      if (!claim || phases.indexOf(progress.phase) < phases.indexOf(claim.phase)) return;
      claim.phase = progress.phase;
      put(progress.id, { status: 'running', progress, cancelling: claim.cancelling, cancelError: claim.cancelError, cleanupFailed: claim.cleanupFailed });
    }).then(unlisten => {
      if (disposed) unlisten();
      else { stop = unlisten; setConnection('ready'); }
    }).catch(() => { if (!disposed) setConnection('error'); });
    return () => { disposed = true; stop?.(); };
  }, [enabled, attempt]);

  // Keep a confirmed result hidden while refresh is pending, then defer to the next observation.
  useEffect(() => {
    for (const [id, entry] of entriesRef.current) {
      if (entry.status !== 'installed') continue;
      const app = apps.find(item => item.source === 'official' && item.id === id);
      if (!app || app.statusKnown === false || app.installationState === 'unknown') observedUnknown.current.add(id);
      else if (app.installed || app.installationState === 'installed' || observedUnknown.current.has(id)) {
        observedUnknown.current.delete(id); remove(id);
      }
    }
  }, [apps]);

  function start(id: string) {
    if (connection !== 'ready' || claims.current.has(id)) return;
    const claim: Claim = { phase: 'fetching', cancelling: false };
    claims.current.set(id, claim);
    put(id, { status: 'running', progress: { id, phase: 'fetching' }, cancelling: false });
    void installApp(id).then(result => {
      if (claims.current.get(id) !== claim) return;
      claims.current.delete(id);
      if (result.status === 'installed') {
        put(id, claim.cleanupFailed ? { status: 'error', error: { status: 'cleanupFailed' } } : { status: 'installed' });
        refresh.current?.();
      } else if (result.status === 'cancelled') {
        if (claim.cleanupFailed) put(id, { status: 'error', error: { status: 'cleanupFailed' } });
        else remove(id);
      } else {
        put(id, { status: 'error', error: result, cleanupFailed: claim.cleanupFailed });
        if (result.status === 'alreadyInstalled' || result.status === 'detectionUnknown' || result.status === 'notDetected') refresh.current?.();
      }
    }).catch(() => {
      if (claims.current.get(id) !== claim) return;
      claims.current.delete(id); put(id, { status: 'error', error: { status: 'unexpected' }, cleanupFailed: claim.cleanupFailed });
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

  return { entries, connection: enabled ? connection : 'error' as const, start, cancel, retryConnection: () => setAttempt(value => value + 1) };
}
export type CatalogInstalls = ReturnType<typeof useCatalogInstalls>;
