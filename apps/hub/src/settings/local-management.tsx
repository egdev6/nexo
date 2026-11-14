import { Button, Input } from '@egdev/ui';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useId, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { addLocalApp, clearLocalCatalog, listLocalApps, pickLocalAppIcon, refreshLocalCatalog, removeLocalApp, setLocalCatalog, updateLocalApp, type LocalAppRow, type LocalAppSelection } from '../local-apps';
import { LocalAppIcon } from '../local-apps/icon';
import type { CatalogSource } from '../model';

const errors: Readonly<Record<string, MessageKey>> = {
  'nexo.local.missing': 'localApps.errorMissing',
  'nexo.local.notExecutable': 'localApps.errorNotExecutable',
  'nexo.local.refused': 'localApps.errorRefused',
  'nexo.local.notFound': 'localApps.errorNotFound',
  'nexo.local.invalidName': 'localApps.errorInvalidName',
  'nexo.local.dialogFailed': 'localApps.errorDialog',
  'nexo.local.spawnFailed': 'localApps.errorSpawn',
  'nexo.local.invalidIcon': 'localApps.errorIcon',
  'nexo.local.iconReadFailed': 'localApps.errorIconRead',
  'nexo.local.iconWriteFailed': 'localApps.errorIconWrite',
  'nexo.local.iconCleanupFailed': 'localApps.errorIconCleanup',
  'nexo.local.catalogUnreadable': 'localApps.errorCatalogUnreadable',
  'nexo.local.catalogInvalid': 'localApps.errorCatalogInvalid',
  'nexo.local.catalogLaunchOnly': 'localApps.errorCatalogLaunchOnly',
  'nexo.local.unbound': 'localApps.unbound',
  'nexo.config.save.corrupt': 'settings.saveBlockedCorrupt',
  'nexo.config.save.unreadable': 'settings.saveBlockedUnreadable',
  'nexo.config.save.future': 'settings.saveBlockedFuture',
};
function errorKey(error: unknown): MessageKey {
  const code = error instanceof Error ? error.message : String(error);
  return Object.hasOwn(errors, code) ? errors[code] : 'localApps.errorUnknown';
}

type Snapshot = { settings: { sources: CatalogSource[] } };
type Confirmation = { kind: 'app' | 'source'; id: string } | null;

export function LocalManagement({ initialSources }: { initialSources?: CatalogSource[] }) {
  const locale = useLocale();
  const native = isTauri();
  const id = useId();
  const [sources, setSources] = useState<CatalogSource[]>(initialSources ?? [{ id: 'official', label: 'Catálogo oficial egdev', kind: 'official' }]);
  const [rows, setRows] = useState<LocalAppRow[]>([]);
  const [loading, setLoading] = useState(native);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<{ key: MessageKey; area: 'app' | 'source' } | null>(null);
  const [listError, setListError] = useState<MessageKey | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Map<string, MessageKey>>(() => new Map());
  const [duplicate, setDuplicate] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [iconRevisions, setIconRevisions] = useState<Map<string, number>>(() => new Map());

  async function readSources() {
    const snapshot = await invoke<Snapshot>('get_settings');
    if (!Array.isArray(snapshot.settings.sources)) throw new Error('nexo.local.refused');
    return snapshot.settings.sources;
  }
  async function refreshRows() {
    try { setRows(await listLocalApps()); setListError(null); }
    catch (failure) { setListError(errorKey(failure)); }
  }
  function clearSourceError(sourceId: string) {
    setSourceErrors(previous => {
      const next = new Map(previous); next.delete(sourceId); return next;
    });
  }

  useEffect(() => {
    if (!native) return;
    let active = true;
    void (async () => {
      try {
        const current = await readSources();
        if (!active) return;
        setSources(current);
        const failures = new Map<string, MessageKey>();
        // Startup snapshots are owned by Rust; refresh exposes their current errors here.
        for (const source of current.filter(item => item.kind === 'local')) {
          try { await refreshLocalCatalog(source.id); }
          catch (failure) { failures.set(source.id, errorKey(failure)); }
          if (!active) return;
        }
        setSourceErrors(failures);
      } catch (failure) { if (active) setError({ key: errorKey(failure), area: 'source' }); }
      try {
        const result = await listLocalApps();
        if (active) { setRows(result); setListError(null); }
      } catch (failure) { if (active) setListError(errorKey(failure)); }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [native]);

  async function run(work: () => Promise<boolean>, sourceId?: string, area: 'app' | 'source' = 'app') {
    if (!native || busyRef.current || loading) return;
    busyRef.current = true; setBusy(true);
    const previousError = error;
    const previousSourceError = sourceId ? sourceErrors.get(sourceId) : undefined;
    setError(null);
    if (sourceId) clearSourceError(sourceId);
    try {
      if (!await work()) {
        setError(previousError);
        if (sourceId && previousSourceError) setSourceErrors(previous => new Map(previous).set(sourceId, previousSourceError));
      }
    } catch (failure) {
      if (sourceId) setSourceErrors(previous => new Map(previous).set(sourceId, errorKey(failure)));
      else setError({ key: errorKey(failure), area });
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function selected(result: LocalAppSelection | null) {
    if (!result) return false;
    setDuplicate(result.duplicate);
    await refreshRows();
    return true;
  }
  const disabled = !native || loading || busy;

  return <>
    <section className="settings__group" aria-labelledby={`${id}-apps`}>
      <h2 id={`${id}-apps`}>{t(locale, 'localApps.heading')}</h2>
      {loading && <p role="status">{t(locale, 'settingsLocal.loading')}</p>}
      {listError && <p role="alert" className="settings__error">{t(locale, listError)}</p>}
      {error?.area === 'app' && <p role="alert" className="settings__error">{t(locale, error.key)}</p>}
      {duplicate && <p role="status" className="settings__hint">{t(locale, 'settingsLocal.duplicate')}</p>}
      {!loading && !rows.length && !listError && <p className="settings__hint">{t(locale, 'settingsLocal.emptyAll')}</p>}
      {rows.map(row => {
        if (row.origin.kind === 'catalog') return <div className="settings__local-entry" key={row.id}>
          <div className="settings__row"><div className="row-label"><LocalAppIcon row={row} /><div><strong>{row.name}</strong>
            <span>{t(locale, 'settingsLocal.catalogSource', { source: row.origin.sourceLabel })}</span>
            {row.state !== 'ready' && <span>{t(locale, row.state === 'unbound' ? 'localApps.unbound' : 'localApps.missing')}</span>}
          </div></div></div>
        </div>;
        const appId = row.origin.id;
        const params = { name: row.name };
        return <div className="settings__local-entry" key={row.id}>
          <div className="settings__row"><div className="row-label"><LocalAppIcon row={row} revision={iconRevisions.get(appId) ?? 0} /><div><strong>{row.name}</strong>
            <span>{t(locale, row.state === 'ready' ? 'localApps.manual' : 'localApps.missing')}</span></div></div>
            <div className="settings__actions">
              <Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.renameFor', params)} onClick={() => { setEditing({ id: appId, name: row.name }); setConfirmation(null); }}>{t(locale, 'settingsLocal.rename')}</Button>
              <Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.iconFor', params)} onClick={() => void run(async () => {
                const result = await pickLocalAppIcon(appId);
                if (result) setIconRevisions(previous => new Map(previous).set(appId, (previous.get(appId) ?? 0) + 1));
                return selected(result);
              })}>{t(locale, 'settingsLocal.icon')}</Button>
              <Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.removeFor', params)} onClick={() => { setEditing(null); setConfirmation({ kind: 'app', id: appId }); }}>{t(locale, 'settingsLocal.remove')}</Button>
            </div>
          </div>
          {editing?.id === appId && <form className="settings__inline" onSubmit={event => {
            event.preventDefault();
            void run(async () => { const result = await updateLocalApp(appId, editing.name); setEditing(null); return selected(result); });
          }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(null); } }}>
            <Input autoFocus size="sm" aria-label={t(locale, 'settingsLocal.nameFor', params)} value={editing.name} disabled={disabled} onChange={event => setEditing({ id: appId, name: event.currentTarget.value })} />
            <Button variant="neutral" size="sm" type="submit" disabled={disabled} aria-label={t(locale, 'settingsLocal.saveNameFor', params)}>{t(locale, 'settingsLocal.save')}</Button>
            <Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.cancelEditFor', params)} onClick={() => setEditing(null)}>{t(locale, 'settingsLocal.cancel')}</Button>
          </form>}
          {confirmation?.kind === 'app' && confirmation.id === appId && <div className="settings__confirmation" role="group" aria-label={t(locale, 'settingsLocal.confirmAppFor', params)}>
            <p>{t(locale, 'settingsLocal.confirmApp')}</p>
            <div className="settings__actions"><Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => void run(async () => { await removeLocalApp(appId); setConfirmation(null); setDuplicate(false); await refreshRows(); return true; })}>{t(locale, 'settingsLocal.removeApp')}</Button>
              <Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => setConfirmation(null)}>{t(locale, 'settingsLocal.cancel')}</Button></div>
          </div>}
        </div>;
      })}
      <div className="settings__actions"><Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => void run(async () => selected(await addLocalApp()))}>{t(locale, 'settingsLocal.addApp')}</Button>
        {native && <Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => void run(async () => { await refreshRows(); return true; })}>{t(locale, 'localApps.refresh')}</Button>}</div>
    </section>
    <section className="settings__group" aria-labelledby={`${id}-sources`}>
      <h2 id={`${id}-sources`}>{t(locale, 'settings.sources')}</h2>
      {error?.area === 'source' && <p role="alert" className="settings__error">{t(locale, error.key)}</p>}
      {sources.map(source => {
        const params = { name: source.label };
        const sourceError = sourceErrors.get(source.id);
        return <div className="settings__local-entry" key={source.id}>
          <div className="settings__row"><div><strong>{source.id === 'official' && source.kind === 'official' && source.label === 'Catálogo oficial egdev' ? t(locale, 'settings.officialSource') : source.label}</strong>
            <span>{t(locale, source.kind === 'official' ? 'settings.official' : 'settings.local')}</span>{source.kind === 'local' && source.location && <span>{source.location}</span>}</div>
            {source.kind === 'local' && <div className="settings__actions">
              <Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.refreshSourceFor', params)} onClick={() => void run(async () => { try { await refreshLocalCatalog(source.id); } finally { await refreshRows(); } return true; }, source.id)}>{t(locale, 'settingsLocal.refreshSource')}</Button>
              <Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.replaceSourceFor', params)} onClick={() => void run(async () => { const result = await setLocalCatalog(source.id); if (!result) return false; setSources(await readSources()); await refreshRows(); return true; }, source.id)}>{t(locale, 'settingsLocal.replaceSource')}</Button>
              <Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.removeSourceFor', params)} onClick={() => { setEditing(null); setConfirmation({ kind: 'source', id: source.id }); }}>{t(locale, 'settingsLocal.remove')}</Button>
            </div>}
          </div>
          {sourceError && <p role="alert" className="settings__error">{t(locale, sourceError)}</p>}
          {confirmation?.kind === 'source' && confirmation.id === source.id && <div className="settings__confirmation" role="group" aria-label={t(locale, 'settingsLocal.confirmSourceFor', params)}>
            <p>{t(locale, 'settingsLocal.confirmSource')}</p>
            <div className="settings__actions"><Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => void run(async () => { await clearLocalCatalog(source.id); setConfirmation(null); setSources(await readSources()); await refreshRows(); return true; }, source.id)}>{t(locale, 'settingsLocal.removeSource')}</Button>
              <Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => setConfirmation(null)}>{t(locale, 'settingsLocal.cancel')}</Button></div>
          </div>}
        </div>;
      })}
      <div className="settings__actions"><Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => void run(async () => { const result = await setLocalCatalog(); if (!result) return false; setSources(await readSources()); await refreshRows(); return true; }, undefined, 'source')}>{t(locale, 'settings.addSource')}</Button>
        {native && <Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => void run(async () => { setSources(await readSources()); return true; }, undefined, 'source')}>{t(locale, 'settingsLocal.reloadSources')}</Button>}</div>
    </section>
    <p className="settings__foot">{t(locale, 'settingsLocal.sourceFoot')}</p>
  </>;
}
