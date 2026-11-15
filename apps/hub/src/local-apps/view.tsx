import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, IconButton } from '@egdev/ui';
import { LinkIcon } from '../apps/action-icons';
import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { bindLocalCatalogEntry, listLocalApps, openLocalApp, openLocalCatalogEntry, repairLocalApp, type LocalAppRow } from './index';
import { LocalAppIcon } from './icon';

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
const errorKey = (error: unknown): MessageKey => {
  const code = error instanceof Error ? error.message : String(error);
  return Object.hasOwn(errors, code) ? errors[code] : 'localApps.errorUnknown';
};

/** Local rows never enter the official projection, registry merge, or News inputs. */
export function LocalAppsView({ names, cycle, openId, onDisclosureChange }: { names: { id: string; name: string }[]; cycle?: number; openId?: string | null; onDisclosureChange?: (id: string, open: boolean) => void }) {
  const locale = useLocale();
  const native = isTauri();
  const [rows, setRows] = useState<LocalAppRow[]>([]);
  const [standaloneOpen, setStandaloneOpen] = useState<string | null>(null);
  const [listError, setListError] = useState<MessageKey | null>(null);
  const [message, setMessage] = useState<{ error: boolean; key: MessageKey } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sequence = useRef(0);

  function refresh() {
    const request = ++sequence.current;
    void listLocalApps().then(result => {
      if (request === sequence.current) { setRows(result); setListError(null); }
    }).catch(error => {
      if (request === sequence.current) { setRows([]); setListError(errorKey(error)); }
    });
  }

  useEffect(() => {
    if (!native) return;
    refresh();
    return () => { sequence.current++; };
  }, [native, cycle]);

  async function action(row: LocalAppRow, kind: 'open' | 'repair') {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage(null);
    try {
      if (kind === 'open') {
        if (row.origin.kind === 'manual') await openLocalApp(row.origin.id);
        else await openLocalCatalogEntry({ sourceId: row.origin.sourceId, appId: row.origin.appId });
        setMessage({ error: false, key: 'native.appLaunchRequested' });
      } else if (row.origin.kind === 'manual') await repairLocalApp(row.origin.id);
      else await bindLocalCatalogEntry({ sourceId: row.origin.sourceId, appId: row.origin.appId });
    } catch (error) {
      setMessage({ error: true, key: errorKey(error) });
    } finally {
      busyRef.current = false; setBusy(false); refresh();
    }
  }

  if (!native) return null;
  const lookup = [...names, ...rows.map(row => ({ id: row.id, name: row.name }))];
  return <section aria-label={t(locale, 'localApps.heading')}>
    <div className="section-label"><h2>{t(locale, 'localApps.heading')}</h2><Button type="button" variant="neutral" size="sm" onClick={refresh}>{t(locale, 'localApps.refresh')}</Button></div>
    {listError && <p role="alert" className="status-warning">{t(locale, listError)}</p>}
    {message && <p role={message.error ? 'alert' : 'status'} className="meta">{t(locale, message.key)}</p>}
    {rows.map(row => {
      const reason = row.state === 'unbound' ? 'localApps.unbound' : 'localApps.missing';
      const other = row.duplicateOf && (lookup.find(item => item.id === row.duplicateOf)?.name ?? row.duplicateOf);
      return <Collapsible className="app-card" key={row.id} open={(onDisclosureChange ? openId === `local:${row.id}` : standaloneOpen === row.id)} onOpenChange={open => onDisclosureChange ? onDisclosureChange(row.id, open) : setStandaloneOpen(open ? row.id : null)}>
        <div className="app-row"><CollapsibleTrigger><span className="row-label">
          <LocalAppIcon row={row} />
          <span className="app-info"><strong>{row.name}</strong><Badge tone="brand">{t(locale, 'localApps.badge')}</Badge>
            {' · '}<span className="secondary">{t(locale, 'appControl.runningUnknown')}</span>
          </span></span></CollapsibleTrigger>
          <div className="row-actions">
            {row.state !== 'ready' && <Button type="button" variant="neutral" size="sm" aria-label={t(locale, row.state === 'unbound' ? 'localApps.bindFor' : 'localApps.repairFor', { name: row.name })} disabled={busy} onClick={() => void action(row, 'repair')}>{t(locale, row.state === 'unbound' ? 'localApps.bind' : 'localApps.repair')}</Button>}
            <IconButton type="button" variant="ghost" icon={<LinkIcon />} label={t(locale, 'appControl.openFor', { name: row.name })} title={t(locale, row.state === 'ready' ? 'appControl.requestOpen' : reason)} disabled={busy || row.state !== 'ready'} onClick={() => void action(row, 'open')} />
          </div>
        </div>
        <CollapsibleContent><div className="detail-inner">
          {row.executable && <p className="meta local-path">{row.executable}</p>}
          <p className="meta">{row.origin.kind === 'manual' ? t(locale, 'localApps.manual') : row.origin.sourceLabel}</p>
          {row.state !== 'ready' && <p className="status-warning">{t(locale, reason)}</p>}
          {other && <p className="status-warning">{t(locale, 'localApps.duplicate', { name: other })}</p>}
          {row.description && <p className="meta">{row.description}</p>}
          <p className="meta">{t(locale, 'appControl.closeWithoutPlugin')}</p>
        </div></CollapsibleContent>
      </Collapsible>;
    })}
  </section>;
}
