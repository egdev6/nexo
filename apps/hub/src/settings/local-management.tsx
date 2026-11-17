import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogTrigger, Button, Heading, Input, Notice, Panel, PanelBody, PanelHeader } from '@egdev/ui';
import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useId, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { listLocalApps, pickLocalAppIcon, removeLocalApp, updateLocalApp, type LocalAppRow, type LocalAppSelection } from '../local-apps';
import { LocalAppIcon } from '../local-apps/icon';
import { AddLocalDialog } from './add-local-dialog';
import { DEFAULT_ACCENT } from './palette';

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
  'nexo.config.save.corrupt': 'settings.saveBlockedCorrupt',
  'nexo.config.save.unreadable': 'settings.saveBlockedUnreadable',
  'nexo.config.save.future': 'settings.saveBlockedFuture',
};
function errorKey(error: unknown): MessageKey {
  const code = error instanceof Error ? error.message : String(error);
  return Object.hasOwn(errors, code) ? errors[code] : 'localApps.errorUnknown';
}

type Confirmation = { kind: 'app'; id: string } | null;

export function LocalManagement({ accent = DEFAULT_ACCENT }: { accent?: string }) {
  const locale = useLocale();
  const native = isTauri();
  const id = useId();
  const [rows, setRows] = useState<LocalAppRow[]>([]);
  const [loading, setLoading] = useState(native);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [listError, setListError] = useState<MessageKey | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [iconRevisions, setIconRevisions] = useState<Map<string, number>>(() => new Map());

  async function refreshRows() {
    try { setRows(await listLocalApps()); setListError(null); }
    catch (failure) { setListError(errorKey(failure)); }
  }
  useEffect(() => {
    if (!native) return;
    let active = true;
    void (async () => {
      try {
        const result = await listLocalApps();
        if (active) { setRows(result); setListError(null); }
      } catch (failure) { if (active) setListError(errorKey(failure)); }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [native]);

  async function run(work: () => Promise<boolean>) {
    if (!native || busyRef.current || loading) return;
    busyRef.current = true; setBusy(true);
    const previousError = error;
    setError(null);
    try {
      if (!await work()) setError(previousError);
    } catch (failure) {
      setError(errorKey(failure));
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
      <Panel variant="banded">
        <PanelHeader><Heading level={2} variant="compact" foreground="default" id={`${id}-apps`}>{t(locale, 'localApps.heading')}</Heading></PanelHeader>
        <PanelBody><div>
      {loading && <p role="status">{t(locale, 'settingsLocal.loading')}</p>}
      {listError && <Notice tone="danger" size="sm" summary={t(locale, listError)} />}
      {error && !confirmation && <Notice tone="danger" size="sm" summary={t(locale, error)} />}
      {duplicate && <p role="status" className="settings__hint">{t(locale, 'settingsLocal.duplicate')}</p>}
      {!loading && !rows.length && !listError && <p className="settings__hint">{t(locale, 'settingsLocal.emptyAll')}</p>}
      {rows.map(row => {
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
              <AlertDialog open={confirmation?.id === appId} onOpenChange={open => {
                if (busyRef.current) return;
                if (open) { setEditing(null); setConfirmation({ kind: 'app', id: appId }); }
                else setConfirmation(null);
              }}>
                <AlertDialogTrigger asChild><Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.removeFor', params)}>{t(locale, 'settingsLocal.remove')}</Button></AlertDialogTrigger>
                <AlertDialogContent tone="danger" title={t(locale, 'settingsLocal.confirmAppFor', params)} description={t(locale, 'settingsLocal.confirmApp')}
                  actions={<>
                    <AlertDialogCancel asChild><Button variant="neutral" size="sm" type="button" disabled={disabled}>{t(locale, 'settingsLocal.cancel')}</Button></AlertDialogCancel>
                    <AlertDialogAction asChild><Button variant="primary" size="sm" type="button" disabled={disabled} onClick={event => {
                      event.preventDefault();
                      void run(async () => { await removeLocalApp(appId); setConfirmation(null); setDuplicate(false); await refreshRows(); return true; });
                    }}>{t(locale, 'settingsLocal.removeApp')}</Button></AlertDialogAction>
                  </>}>
                  {error && <Notice tone="danger" size="sm" summary={t(locale, error)} />}
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          {editing?.id === appId && <form className="settings__inline" onSubmit={event => {
            event.preventDefault();
            void run(async () => { const result = await updateLocalApp(appId, editing.name); setEditing(null); return selected(result); });
          }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(null); } }}>
            <Input className="settings__inline-input" autoFocus size="sm" aria-label={t(locale, 'settingsLocal.nameFor', params)} value={editing.name} disabled={disabled} onChange={event => setEditing({ id: appId, name: event.currentTarget.value })} />
            <Button variant="neutral" size="sm" type="submit" disabled={disabled} aria-label={t(locale, 'settingsLocal.saveNameFor', params)}>{t(locale, 'settingsLocal.save')}</Button>
            <Button variant="neutral" size="sm" type="button" disabled={disabled} aria-label={t(locale, 'settingsLocal.cancelEditFor', params)} onClick={() => setEditing(null)}>{t(locale, 'settingsLocal.cancel')}</Button>
          </form>}
        </div>;
      })}
      <div className="settings__actions"><AddLocalDialog accent={accent} disabled={disabled} errorKey={errorKey} onAdded={async result => { await selected(result); }} />
        {native && <Button variant="neutral" size="sm" type="button" disabled={disabled} onClick={() => void run(async () => { await refreshRows(); return true; })}>{t(locale, 'localApps.refresh')}</Button>}</div>
        </div></PanelBody>
      </Panel>
    </section>
    <p className="settings__foot">{t(locale, 'settingsLocal.localFoot')}</p>
  </>;
}
