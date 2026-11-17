import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleHeader, CollapsibleTrigger, Icon, IconButton, Notice, PageHeader, Text } from '@egdev/ui';
import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { listLocalApps, openLocalApp, repairLocalApp, type LocalAppRow } from './index';
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
        await openLocalApp(row.origin.id);
        setMessage({ error: false, key: 'native.appLaunchRequested' });
      } else await repairLocalApp(row.origin.id);
    } catch (error) {
      setMessage({ error: true, key: errorKey(error) });
    } finally {
      busyRef.current = false; setBusy(false); refresh();
    }
  }

  if (!native) return null;
  const lookup = [...names, ...rows.map(row => ({ id: row.id, name: row.name }))];
  return <section aria-label={t(locale, 'localApps.heading')}>
    <div className="apps-section-header"><PageHeader level={2} title={t(locale, 'localApps.heading')} actions={<Button type="button" variant="neutral" size="sm" onClick={refresh}>{t(locale, 'localApps.refresh')}</Button>} /></div>
    {listError && <Notice tone="danger" size="sm" summary={t(locale, listError)} />}
    {message && <Notice tone={message.error ? 'danger' : 'success'} size="sm" summary={t(locale, message.key)} />}
    {rows.map(row => {
      const other = row.duplicateOf && (lookup.find(item => item.id === row.duplicateOf)?.name ?? row.duplicateOf);
      return <Collapsible className="app-card" key={row.id} open={(onDisclosureChange ? openId === `local:${row.id}` : standaloneOpen === row.id)} onOpenChange={open => onDisclosureChange ? onDisclosureChange(row.id, open) : setStandaloneOpen(open ? row.id : null)}>
        <CollapsibleHeader actions={<>
          {row.state !== 'ready' && <Button type="button" variant="neutral" size="sm" aria-label={t(locale, 'localApps.repairFor', { name: row.name })} disabled={busy} onClick={() => void action(row, 'repair')}>{t(locale, 'localApps.repair')}</Button>}
          <IconButton type="button" variant="ghost" icon={<Icon name="external-link" />} label={t(locale, 'appControl.openFor', { name: row.name })} title={t(locale, row.state === 'ready' ? 'appControl.requestOpen' : 'localApps.missing')} disabled={busy || row.state !== 'ready'} onClick={() => void action(row, 'open')} />
        </>}><CollapsibleTrigger motion="none"><span className="row-label">
          <LocalAppIcon row={row} />
          <span className="app-info"><strong>{row.name}</strong><Badge tone="brand">{t(locale, 'localApps.badge')}</Badge>
            {' · '}<Text asChild variant="body" foreground="secondary"><span>{t(locale, 'appControl.runningUnknown')}</span></Text>
          </span></span></CollapsibleTrigger>
        </CollapsibleHeader>
        <CollapsibleContent padding="sm" presence="unmount"><div className="detail-inner">
          {row.executable && <Text variant="body" foreground="secondary" className="meta local-path">{row.executable}</Text>}
          <Text variant="body" foreground="secondary" className="meta">{t(locale, 'localApps.manual')}</Text>
          {row.state !== 'ready' && <Text variant="body" foreground="warning" className="meta">{t(locale, 'localApps.missing')}</Text>}
          {other && <Text variant="body" foreground="warning" className="meta">{t(locale, 'localApps.duplicate', { name: other })}</Text>}
          <Text variant="body" foreground="secondary" className="meta">{t(locale, 'appControl.closeWithoutPlugin')}</Text>
        </div></CollapsibleContent>
      </Collapsible>;
    })}
  </section>;
}
