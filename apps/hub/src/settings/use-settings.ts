import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import type { AutostartViewState, Language, NewsVisit, StoredSettings } from '../model';
import { t, type MessageKey } from '../i18n';
import { defaultSettings } from '../sample';

// Browser previews remain illustrative; only the Rust-owned file is durable.
const preview: StoredSettings = { ...defaultSettings, firstRunComplete: false,
  sources: [{ id: 'official', label: 'Catálogo oficial egdev', kind: 'official' }] };
type FileState = 'missing' | 'ready' | 'corrupt' | 'unreadable' | 'future';
type Patch = Partial<StoredSettings>;
type Snapshot = { settings: StoredSettings; state: FileState };
type Failure = { key: MessageKey; detail?: string; detailKey?: MessageKey };
const text = (error: unknown) => error instanceof Error ? error.message : String(error);
const configErrors: Readonly<Record<string, MessageKey>> = {
  'nexo.config.save.future': 'settings.saveBlockedFuture',
  'nexo.config.save.corrupt': 'settings.saveBlockedCorrupt',
  'nexo.config.save.unreadable': 'settings.saveBlockedUnreadable',
  'nexo.config.sourceSelectionRequired': 'settings.sourceSelectionRequired',
  'nexo.config.recoveryNotAllowed': 'settings.recoverNotAllowed',
};
const configFailure = (key: MessageKey, error: unknown): Failure => {
  const detail = text(error);
  return { key, detail, detailKey: Object.hasOwn(configErrors, detail) ? configErrors[detail] : undefined };
};

export function useSettings() {
  const native = isTauri();
  const [settings, setSettings] = useState<StoredSettings | null>(() => native ? null : preview);
  const current = useRef(settings);
  const confirmed = useRef(settings);
  const [fileState, setFileState] = useState<FileState | null>(native ? null : 'missing');
  const [error, setError] = useState<Failure | null>(null);
  const [languageDraft, setLanguageDraft] = useState<Language | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const onboardingPreview = useRef<Language>('es');
  const [startup, setStartup] = useState<{ confirmed: boolean | null; busy: boolean; error: Failure | null }>(
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

  async function refreshNative() {
    if (!native) return;
    const sequence = ++refreshSequence.current;
    try {
      await invoke('apply_saved_language');
      if (mounted.current && sequence === refreshSequence.current) setNativeError(null);
    } catch (failure) {
      if (mounted.current && sequence === refreshSequence.current) setNativeError(text(failure));
    }
  }

  // A single patch queue protects unrelated and more recent edits from stale snapshots.
  function flush(): Promise<boolean> {
    if (!native) return Promise.resolve(true);
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    if (running.current) return running.current;
    const work = async () => {
      let savedLanguage = false;
      const refreshIfChanged = () => {
        if (savedLanguage) void refreshNative();
      };
      while (Object.keys(pending.current).length) {
        let patch = pending.current;
        pending.current = {};
        const deferChoice = patch.firstRunComplete === true && patch.language !== onboardingPreview.current;
        if (deferChoice) {
          const { language, firstRunComplete, ...other } = patch;
          pending.current = { language, firstRunComplete };
          patch = other;
          if (!Object.keys(patch).length) { refreshIfChanged(); return false; }
        }
        try {
          const saved = await invoke<StoredSettings>('save_settings', { patch });
          if (patch.language !== undefined) savedLanguage = true;
          confirmed.current = saved;
          if (!Object.hasOwn(pending.current, 'newsVisit')) desiredVisit.current = saved.newsVisit ?? null;
          const next = { ...saved, ...pending.current, newsVisit: saved.newsVisit };
          // A later language choice must not be replaced by an older result.
          if (pending.current.language !== undefined && current.current) next.language = current.current.language;
          if (pending.current.firstRunComplete !== undefined && current.current) next.firstRunComplete = current.current.firstRunComplete;
          updateCurrent(next);
          if (mounted.current) {
            if (pending.current.language === undefined) setLanguageDraft(null);
            if (!deferChoice) setError(null);
          }
        } catch (failure) {
          pending.current = { ...patch, ...pending.current };
          if (current.current && confirmed.current) updateCurrent({ ...current.current, language: confirmed.current.language, firstRunComplete: confirmed.current.firstRunComplete });
          if (mounted.current) { setLanguageDraft(null); setError(configFailure('settings.saveError', failure)); }
          refreshIfChanged();
          return false;
        }
      }
      refreshIfChanged();
      return true;
    };
    const task = work().finally(() => { running.current = null; });
    running.current = task;
    return task;
  }

  function change(patch: Patch, immediate = false, optimistic = true) {
    if (!current.current) return;
    if (!native) { updateCurrent({ ...current.current, ...patch }); return; }
    if (optimistic) {
      if (patch.language !== undefined) setLanguageDraft(patch.language);
      const { language: _language, firstRunComplete: _firstRun, ...other } = patch;
      updateCurrent({ ...current.current, ...other });
    }
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
      confirmed.current = snapshot.settings;
      desiredVisit.current = snapshot.settings.newsVisit ?? null;
      updateCurrent(snapshot.settings);
      setFileState(snapshot.state);
      setError(null);
    } catch (failure) {
      if (mounted.current) { setFileState('unreadable'); setError({ key: 'settings.readError', detail: text(failure) }); }
    }
  }

  async function recover() {
    try {
      const saved = await invoke<StoredSettings>('recover_settings');
      confirmed.current = saved;
      desiredVisit.current = saved.newsVisit ?? null;
      updateCurrent(saved); setFileState('ready'); setError(null);
    } catch (failure) { setError(configFailure('settings.recoverError', failure)); }
  }

  async function readStartup() {
    if (!native || startupRef.current.busy) return;
    updateStartup({ ...startupRef.current, busy: true, error: null });
    try {
      const value = await invoke<boolean>('plugin:autostart|is_enabled');
      updateStartup({ confirmed: value, busy: false, error: null });
      if (current.current && current.current.startWithWindows !== value) change({ startWithWindows: value });
    } catch (failure) { updateStartup({ confirmed: null, busy: false, error: { key: 'settings.startupReadError', detail: text(failure) } }); }
  }

  async function changeStartup(desired: boolean) {
    if (!native) { updateStartup({ confirmed: desired, busy: false, error: null }); change({ startWithWindows: desired }); return; }
    if (startupRef.current.busy || startupRef.current.confirmed === null) return;
    desiredStartup.current = desired;
    updateStartup({ ...startupRef.current, busy: true, error: null });
    try {
      await invoke(desired ? 'plugin:autostart|enable' : 'plugin:autostart|disable');
      const value = await invoke<boolean>('plugin:autostart|is_enabled');
      if (value !== desired) {
        updateStartup({ confirmed: value, busy: false, error: { key: 'settings.startupMismatch' } });
        if (current.current && current.current.startWithWindows !== value) change({ startWithWindows: value });
        return;
      }
      desiredStartup.current = null;
      updateStartup({ confirmed: value, busy: false, error: null });
      change({ startWithWindows: value });
    } catch (failure) {
      updateStartup({ confirmed: null, busy: false, error: { key: 'settings.startupConfirmError', detail: text(failure) } });
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
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen<'all' | 'hub-only'>('quit-requested', async event => {
      if (await flush()) await invoke(event?.payload === 'hub-only' ? 'hub_only_exit' : 'quit_after_settings');
    }).then(unlisten => { if (cancelled) unlisten(); else dispose = unlisten; })
      .catch(failure => { if (mounted.current) setError({ key: 'settings.quitError', detail: text(failure) }); });
    const onBlur = () => { void flush(); };
    window.addEventListener('blur', onBlur);
    return () => { cancelled = true; mounted.current = false; dispose?.(); window.removeEventListener('blur', onBlur); if (timer.current) clearTimeout(timer.current); };
  }, []); // The queue is deliberately stable and uses refs for all mutable state.

  useEffect(() => {
    if (native && (fileState === 'ready' || fileState === 'missing')) {
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

  const startupError = startup.error ? t(settings?.language ?? 'es', startup.error.key, { error: startup.error.detail ?? '' }) : null;
  const autostart: AutostartViewState = { ...startup, error: startupError, change: value => { void changeStartup(value); }, retry: retryStartup };
  return {
    settings, fileState, error, autostart, change, languageDraft, nativeError, recordVisit,
    getVisit: () => desiredVisit.current,
    previewChoice: (language: Language) => { onboardingPreview.current = language; },
    choose: (language: Language) => { onboardingPreview.current = language; change({ language, firstRunComplete: true }, true, false); },
    retryNative: () => { void refreshNative(); },
    retry: () => { void flush(); }, recover: () => { void recover(); }, reload: () => { void load(); }, flush,
  };
}
