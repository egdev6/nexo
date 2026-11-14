import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import type { AutostartViewState, Language, NewsVisit, StoredSettings } from '../model';
import { defaultSettings } from '../sample';

// Browser previews remain illustrative; only the Rust-owned file is durable.
const preview: StoredSettings = { ...defaultSettings, firstRunComplete: false,
  sources: [{ id: 'official', label: 'Catálogo oficial egdev', kind: 'official' }] };
type FileState = 'missing' | 'ready' | 'corrupt' | 'unreadable' | 'future';
type Patch = Partial<StoredSettings>;
type Snapshot = { settings: StoredSettings; state: FileState };
const text = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useSettings() {
  const native = isTauri();
  const [settings, setSettings] = useState<StoredSettings | null>(() => native ? null : preview);
  const current = useRef(settings);
  const [fileState, setFileState] = useState<FileState | null>(native ? null : 'missing');
  const [error, setError] = useState<string | null>(null);
  const [startup, setStartup] = useState<{ confirmed: boolean | null; busy: boolean; error: string | null }>(
    { confirmed: native ? null : false, busy: native, error: null });
  const startupRef = useRef(startup);
  const desiredStartup = useRef<boolean | null>(null);
  const pending = useRef<Patch>({});
  // A queued visit is not exposed as persisted until Rust confirms the write.
  const desiredVisit = useRef<NewsVisit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);

  function updateStartup(value: typeof startup) { startupRef.current = value; if (mounted.current) setStartup(value); }
  function updateCurrent(value: StoredSettings) { current.current = value; if (mounted.current) setSettings(value); }

  // A single patch queue protects unrelated and more recent edits from stale snapshots.
  function flush(): Promise<boolean> {
    if (!native) return Promise.resolve(true);
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    if (running.current) return running.current;
    const work = async () => {
      while (Object.keys(pending.current).length) {
        const patch = pending.current;
        pending.current = {};
        try {
          const saved = await invoke<StoredSettings>('save_settings', { patch });
          if (!Object.hasOwn(pending.current, 'newsVisit')) desiredVisit.current = saved.newsVisit ?? null;
          updateCurrent({ ...saved, ...pending.current, newsVisit: saved.newsVisit });
          if (mounted.current) setError(null);
        } catch (failure) {
          pending.current = { ...patch, ...pending.current };
          if (mounted.current) setError(`No se pudieron guardar los ajustes: ${text(failure)}`);
          return false;
        }
      }
      return true;
    };
    const task = work().finally(() => { running.current = null; });
    running.current = task;
    return task;
  }

  function change(patch: Patch, immediate = false, optimistic = true) {
    if (!current.current) return;
    if (!native) { updateCurrent({ ...current.current, ...patch }); return; }
    if (optimistic) updateCurrent({ ...current.current, ...patch });
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    if (immediate) void flush();
    else timer.current = setTimeout(() => { void flush(); }, 200);
  }

  function recordVisit(at: string, keys: string[], validKeys?: ReadonlySet<string>) {
    if (!current.current) return;
    const previous = desiredVisit.current;
    const retained = (previous?.seenKeys ?? []).filter(key => !validKeys || validKeys.has(key));
    const seenKeys = Array.from(new Set([...retained, ...keys]));
    const lastVisitAt = previous && Date.parse(previous.lastVisitAt) > Date.parse(at) ? previous.lastVisitAt : at;
    if (previous && previous.lastVisitAt === lastVisitAt && previous.seenKeys.length === seenKeys.length && previous.seenKeys.every((key, index) => key === seenKeys[index])) return;
    const visit = { lastVisitAt, seenKeys };
    desiredVisit.current = visit;
    change({ newsVisit: visit }, true, false);
  }

  async function load() {
    try {
      const snapshot = await invoke<Snapshot>('get_settings');
      if (!mounted.current) return;
      desiredVisit.current = snapshot.settings.newsVisit ?? null;
      updateCurrent(snapshot.settings);
      setFileState(snapshot.state);
      setError(null);
    } catch (failure) {
      if (mounted.current) { setFileState('unreadable'); setError(`No se pudieron leer los ajustes: ${text(failure)}`); }
    }
  }

  async function recover() {
    try {
      const saved = await invoke<StoredSettings>('recover_settings');
      desiredVisit.current = saved.newsVisit ?? null;
      updateCurrent(saved); setFileState('ready'); setError(null);
    } catch (failure) { setError(`No se pudieron recuperar los ajustes: ${text(failure)}`); }
  }

  async function readStartup() {
    if (!native || startupRef.current.busy) return;
    updateStartup({ ...startupRef.current, busy: true, error: null });
    try {
      const confirmed = await invoke<boolean>('plugin:autostart|is_enabled');
      updateStartup({ confirmed, busy: false, error: null });
      if (current.current && current.current.startWithWindows !== confirmed) change({ startWithWindows: confirmed });
    } catch (failure) { updateStartup({ confirmed: null, busy: false, error: `No se pudo leer el inicio con Windows: ${text(failure)}` }); }
  }

  async function changeStartup(desired: boolean) {
    if (!native) { updateStartup({ confirmed: desired, busy: false, error: null }); change({ startWithWindows: desired }); return; }
    if (startupRef.current.busy || startupRef.current.confirmed === null) return;
    desiredStartup.current = desired;
    updateStartup({ ...startupRef.current, busy: true, error: null });
    try {
      await invoke(desired ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
      const confirmed = await invoke<boolean>('plugin:autostart|is_enabled');
      if (confirmed !== desired) {
        updateStartup({ confirmed, busy: false, error: 'El sistema no confirmó el cambio de inicio con Windows.' });
        if (current.current && current.current.startWithWindows !== confirmed) change({ startWithWindows: confirmed });
        return;
      }
      desiredStartup.current = null;
      updateStartup({ confirmed, busy: false, error: null });
      change({ startWithWindows: confirmed });
    } catch (failure) {
      updateStartup({ confirmed: null, busy: false, error: `No se pudo confirmar el inicio con Windows: ${text(failure)}` });
    }
  }

  function retryStartup() {
    if (startupRef.current.confirmed === null || desiredStartup.current === null) void readStartup();
    else void changeStartup(desiredStartup.current);
  }

  useEffect(() => {
    mounted.current = true;
    if (!native) return () => { mounted.current = false; };
    void load();
    // Quit is requested by the tray; pending debounced writes must finish first.
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen<'all' | 'hub-only'>('quit-requested', async event => {
      if (await flush()) await invoke(event?.payload === 'hub-only' ? 'hub_only_exit' : 'quit_after_settings');
    }).then(unlisten => { if (cancelled) unlisten(); else dispose = unlisten; })
      .catch(failure => { if (mounted.current) setError(`No se pudo preparar la salida: ${text(failure)}`); });
    const onBlur = () => { void flush(); };
    window.addEventListener('blur', onBlur);
    return () => { cancelled = true; mounted.current = false; dispose?.(); window.removeEventListener('blur', onBlur); if (timer.current) clearTimeout(timer.current); };
  }, []); // The queue is deliberately stable and uses refs for all mutable state.

  useEffect(() => {
    if (native && (fileState === 'ready' || fileState === 'missing')) {
      // Initial state is unknown; avoid treating the persisted cache as OS confirmation.
      startupRef.current = { confirmed: null, busy: false, error: null };
      void readStartup();
    }
  }, [fileState]);

  useEffect(() => {
    if (!native || (fileState !== 'ready' && fileState !== 'missing')) return;
    const onFocus = () => { void readStartup(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fileState]);

  const autostart: AutostartViewState = { ...startup, change: value => { void changeStartup(value); }, retry: retryStartup };
  return {
    settings, fileState, error, autostart, change, recordVisit,
    getVisit: () => desiredVisit.current,
    choose: (language: Language) => change({ language, firstRunComplete: true }, true, false),
    retry: () => { void flush(); }, recover: () => { void recover(); }, reload: () => { void load(); }, flush,
  };
}
