import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, IconButton, Notice, PageHeader, StatusDot, Tabs } from '@egdev/ui';
import { LinkIcon } from './apps/action-icons';
import { AppDetails } from './apps/details';
import { isTauri } from '@tauri-apps/api/core';
import { closeConnectedApp, closeOfficialApp, localizeAppReason, openOfficialApp, scanInstallations, type InstallationObservation } from './apps';
import { CatalogView } from './catalog';
import { useCatalogInstalls, type CatalogInstalls } from './catalog/install/use-installs';
import { InstallAction } from './catalog/install/action';
import { availableUpdate } from './catalog/update';
import { diskCache, diskCacheV2, diskCacheV3, loadVersionedCatalog, OFFICIAL_CATALOG_URL, OFFICIAL_CATALOG_V2_URL, OFFICIAL_CATALOG_V3_URL, webFetcher, type CatalogState } from './catalog/loader';
import { projectCatalog } from './catalog/mapping';
import { FirstRun } from './first-run';
import { formatNumber, intlLocale, t } from './i18n';
import { LocaleProvider, localeFrom, useLocale } from './i18n/use-locale';
import { LocalAppsView } from './local-apps/view';
import type { HubApp, HubSettings, Language, NewsItem } from './model';
import { NewsPopup } from './news';
import { selectOfficialNews } from './news/selection';
import { useFlyoutVisibility } from './news/use-flyout';
import { defaultSettings, sampleApps, sampleNews } from './sample';
import { SettingsView } from './settings';
import { accentVariables, DEFAULT_ACCENT, normalizeHex } from './settings/palette';
import { useSettings } from './settings/use-settings';
import { exitHubOnly, subscribeRegistry } from './shell/registry';
import { requestFlyoutHide, useFlyoutMotion } from './shell/motion';
import { useContentBackdrop } from './shell/backdrop';
import { noticeText } from './shell/notice';
import type { RegistryApp, RegistrySnapshot } from './shell/registry';
import { backdropAvailable, hideFlyout } from './window';
import nexoLogo from '../src-tauri/app-icon.svg';
import './style.css';

type Tab = 'apps' | 'catalog';

function OpenAction({ app, onOpen, busy, stale }: { app: HubApp; onOpen?: (id: string) => void; busy: boolean; stale: boolean }) {
  const locale = useLocale();
  const enabled = !!onOpen && app.source === 'official' && app.installationState === 'installed' && app.canOpen === true && !busy && !stale;
  const title = stale ? t(locale, 'appControl.staleTitle') : app.openReason ? localizeAppReason(locale, app.openReason) : t(locale, enabled ? 'appControl.requestOpen' : 'appControl.openUnavailable');
  return <IconButton variant="ghost" size="md" type="button" icon={<LinkIcon />} label={t(locale, 'appControl.openFor', { name: app.name })} title={title} disabled={!enabled} onClick={() => onOpen?.(app.id)} />;
}

function ProcessCloseAction({ app, onClose, busy, stale }: { app: HubApp; onClose?: (id: string) => void; busy: boolean; stale: boolean }) {
  const locale = useLocale();
  const enabled = !!onClose && app.source === 'official' && app.installationState === 'installed' && !busy && !stale;
  return <IconButton variant="ghost" size="md" type="button" icon={<Icon name="close" />} label={t(locale, 'appControl.closeFor', { name: app.name })} title={t(locale, stale ? 'appControl.staleTitle' : 'appControl.requestClose')} disabled={!enabled} onClick={() => onClose?.(app.id)} />;
}

// TODO(egdev-design-system#410): Replace with the DS square app identity once it supports image and initials.
export function AppIcon({ app }: { app: Pick<HubApp, 'id' | 'name' | 'iconUrl'> }) {
  const [failed, setFailed] = useState<string | null>(null);
  const logo = app.iconUrl && failed !== app.iconUrl ? app.iconUrl : undefined;
  return <span aria-hidden="true" className={`app-icon ${logo ? 'app-icon--logo' : app.id === 'antena' ? 'brand-icon' : ''}`}>
    {logo ? <img src={logo} alt="" onError={() => setFailed(logo)} /> : app.name.trim().charAt(0).toUpperCase()}
  </span>;
}

function Status({ app }: { app: HubApp }) {
  const locale = useLocale();
  if (app.installationState === 'installed') {
    if (app.runningState === 'running') return <span><StatusDot state="running" /> {t(locale, 'appControl.running')}</span>;
    if (app.runningState === 'notRunning') return <span className="secondary">{t(locale, 'appControl.notRunning')}</span>;
    return <span className="secondary">{t(locale, 'appControl.runningUnknown')}</span>;
  }
  if (app.integration === 'local') return <span className="secondary">{t(locale, app.source === 'official' ? 'app.officialLaunch' : 'app.localUnknown')}</span>;
  return <span className="secondary">{t(locale, 'app.unknown')}{app.update && <> · <span className="status-warning">{t(locale, 'app.updateSample')}</span></>}</span>;
}

function updateRunning(installs: CatalogInstalls, id: string): boolean {
  const entry = installs.entries.get(id);
  return entry?.operation === 'update' && entry.status === 'running';
}

function UpdateControl({ app, catalogState, installs, part = 'action' }: { app: HubApp; catalogState?: CatalogState; installs: CatalogInstalls; part?: 'action' | 'feedback' }) {
  const update = availableUpdate(app, catalogState?.catalog);
  const entry = installs.entries.get(app.id);
  if (update?.status !== 'available' && entry?.operation !== 'update') return null;
  const unverifiable = update?.status === 'unverifiable';
  const reason = unverifiable ? (catalogState?.stale ? 'update.unverifiableStale' : 'update.unverifiable') : catalogState?.stale ? 'update.stale' : catalogState?.status !== 'ready' ? 'update.unavailable' : installs.connection !== 'ready' ? 'update.progressUnavailable' : undefined;
  return <InstallAction app={app} installs={installs} mode="update" version={update?.status === 'available' ? update.version : undefined} reason={reason} unverifiable={unverifiable} compact part={part} />;
}

function UpdateNotes({ app, catalogState }: { app: HubApp; catalogState?: CatalogState }) {
  const notes = availableUpdate(app, catalogState?.catalog)?.notes;
  return notes ? <div className="meta update-notes"><strong>{notes.title}</strong><p>{notes.text}</p></div> : null;
}

function ConnectedRow({ app, official, onClose, onOpen, busy, catalogState, installs, open, onOpenChange }: { app: RegistryApp; official?: HubApp; onClose?: (id: string) => void; onOpen?: (id: string) => void; busy: boolean; catalogState?: CatalogState; installs: CatalogInstalls; open: boolean; onOpenChange: (open: boolean) => void }) {
  const locale = useLocale();
  const update = official && availableUpdate(official, catalogState?.catalog);
  const canShow = !!onOpen && !!official && app.responsive && app.capabilities.includes('show') && !busy && !updateRunning(installs, app.app.id);
  return <Collapsible className="app-card" open={open} onOpenChange={onOpenChange}>
    <div className="app-row"><CollapsibleTrigger>
      <span className="row-label"><AppIcon app={{ id: app.app.id, name: app.app.name, iconUrl: official?.iconUrl }} />
        <span className="app-info"><strong>{app.app.name}</strong>
          {app.responsive ? <span><StatusDot state="running" /> {t(locale, 'app.connected')}</span> : <span className="secondary">{t(locale, 'app.unresponsive')}</span>}
        </span>
      </span>
    </CollapsibleTrigger><div className="row-actions">{official && <UpdateControl app={official} catalogState={catalogState} installs={installs} />}
      <IconButton type="button" variant="ghost" icon={<LinkIcon />} label={t(locale, 'appControl.openFor', { name: app.app.name })} title={t(locale, canShow ? 'appControl.requestOpen' : 'appControl.showUnavailable')} disabled={!canShow} onClick={() => onOpen?.(app.app.id)} />
    </div></div>
    {official && <UpdateControl app={official} catalogState={catalogState} installs={installs} part="feedback" />}
    <CollapsibleContent><div className="detail-inner">
      <AppDetails app={official} version={official?.installationState === 'installed' ? official.version : undefined} newVersion={update?.status === 'available' ? update.version : undefined} showInstalledVersion={official?.installationState !== 'unknown'} />
      {update?.status === 'unverifiable' && <p className="meta">{t(locale, catalogState?.stale ? 'update.unverifiableStale' : 'update.unverifiable')}</p>}
      {official && <UpdateNotes app={official} catalogState={catalogState} />}
      <p className="meta">{t(locale, 'app.reportedVersion', { version: app.app.version, tray: t(locale, app.unified ? 'app.unified' : 'app.ownIcon') })}</p>
      {onClose && (app.responsive && app.capabilities.includes('quit') ?
        <Button type="button" size="sm" variant="secondary" aria-label={t(locale, 'appControl.closeFor', { name: app.app.name })} disabled={busy} onClick={() => onClose(app.app.id)}>{t(locale, 'common.close')}</Button> :
        <p className="meta">{t(locale, 'appControl.closeUnavailable')}</p>)}
      {app.menu.length > 0 && <><p className="meta">{t(locale, 'app.reportedMenu')}</p><ul className="registry-menu">
        {app.menu.map((item, index) => <li key={`${item.id}-${index}`}>{item.label}{!item.enabled && t(locale, 'app.disabled')}{item.checked === true && t(locale, 'app.checked')}{item.checked === false && t(locale, 'app.unchecked')}</li>)}
      </ul></>}
    </div></CollapsibleContent>
  </Collapsible>;
}

function AppRow({ app, onOpen, onClose, busy, stale, catalogState, installs, open, onOpenChange }: { app: HubApp; onOpen?: (id: string) => void; onClose?: (id: string) => void; busy: boolean; stale: boolean; catalogState?: CatalogState; installs: CatalogInstalls; open: boolean; onOpenChange: (open: boolean) => void }) {
  const locale = useLocale();
  const update = availableUpdate(app, catalogState?.catalog);
  return <Collapsible className="app-card" open={open} onOpenChange={onOpenChange}>
    <div className="app-row">
      <CollapsibleTrigger><span className="row-label"><AppIcon app={app} /><span className="app-info"><strong>{app.name}</strong><Status app={app} /></span></span></CollapsibleTrigger>
      <div className="row-actions"><UpdateControl app={app} catalogState={catalogState} installs={installs} />
        {app.source === 'official' && app.runningState === 'running' ?
          <ProcessCloseAction app={app} onClose={onClose} busy={busy || updateRunning(installs, app.id)} stale={stale} /> :
          <OpenAction app={app} onOpen={onOpen} busy={busy || updateRunning(installs, app.id)} stale={stale} />}</div>
    </div>
    <UpdateControl app={app} catalogState={catalogState} installs={installs} part="feedback" />
    <CollapsibleContent><div className="detail-inner">
      <AppDetails app={app} version={app.version} newVersion={update?.status === 'available' ? update.version : undefined} />
      {update?.status === 'unverifiable' && <p className="meta">{t(locale, catalogState?.stale ? 'update.unverifiableStale' : 'update.unverifiable')}</p>}
      <UpdateNotes app={app} catalogState={catalogState} />
      <p className="meta">{app.description}</p>
      {onOpen && !app.canOpen && <p className="meta">{t(locale, 'appControl.openUnavailableDetail', { reason: app.openReason ? localizeAppReason(locale, app.openReason) : t(locale, 'appControl.executableUnchecked') })}</p>}
      {onOpen && stale && <p className="meta">{t(locale, 'appControl.staleOpenDetail')}</p>}
    </div></CollapsibleContent>
  </Collapsible>;
}

function isInstalled(app: HubApp) {
  return app.statusKnown !== false && app.installed && app.installationState !== 'unknown' && app.installationState !== 'notInstalled';
}

function InstalledPanel({ apps, connected, selectCatalog, installedStateKnown, onRefresh, onClose, onProcessClose, onOpen, actionBusy, stale, localCycle, catalogState, installs }: { apps: HubApp[]; connected: RegistryApp[]; selectCatalog: () => void; installedStateKnown: boolean; onRefresh?: () => void; onClose?: (id: string) => void; onProcessClose?: (id: string) => void; onOpen?: (id: string) => void; actionBusy: boolean; stale: boolean; localCycle?: number; catalogState?: CatalogState; installs: CatalogInstalls }) {
  const locale = useLocale();
  const ids = new Set(connected.map(entry => entry.app.id));
  const allInstalled = apps.filter(isInstalled);
  const installed = allInstalled.filter(app => !ids.has(app.id));
  const [openRow, setOpenRow] = useState<string | null>(null);
  const disclosure = (id: string) => ({ open: openRow === id, onOpenChange: (open: boolean) => setOpenRow(current => open ? id : current === id ? null : current) });
  return <>
    {connected.length > 0 && <section aria-label={t(locale, 'app.connectedPlural')}><div className="apps-section-header"><PageHeader level={2} title={t(locale, 'app.connectedPlural')} /></div>
      {connected.map(app => <ConnectedRow key={app.app.id} app={app} official={apps.find(item => item.source === 'official' && item.id === app.app.id)} onClose={onClose} onOpen={onOpen} busy={actionBusy} catalogState={catalogState} installs={installs} {...disclosure(`connected:${app.app.id}`)} />)}
    </section>}
    <div className="apps-section-header"><PageHeader level={2} title={t(locale, 'app.installed')} actions={onRefresh && <Button variant="neutral" size="sm" onClick={onRefresh}>{t(locale, 'appControl.refresh')}</Button>} /></div>
    {installed.length ? installed.map(app => <AppRow key={app.id} app={app} onOpen={onOpen} onClose={onProcessClose} busy={actionBusy} stale={stale} catalogState={catalogState} installs={installs} {...disclosure(`official:${app.id}`)} />) : <div className="empty-state"><p>{allInstalled.length ? t(locale, 'appControl.connectedAbove') : t(locale, installedStateKnown ? 'app.empty' : 'app.installationUnknown')}</p><Button variant="neutral" size="sm" onClick={selectCatalog}>{t(locale, 'app.viewCatalog')}</Button></div>}
    {apps.filter(app => !isInstalled(app) && !ids.has(app.id) && installs.entries.get(app.id)?.operation === 'update').map(app => <UpdateControl key={app.id} app={app} catalogState={catalogState} installs={installs} part="feedback" />)}
    <LocalAppsView names={[...apps.map(app => ({ id: app.id, name: app.name })), ...connected.map(entry => entry.app)]} cycle={localCycle} openId={openRow} onDisclosureChange={(id, open) => disclosure(`local:${id}`).onOpenChange(open)} />
    <p className="foot">{t(locale, onRefresh ? 'appControl.officialCloseFoot' : installedStateKnown ? 'app.sampleFoot' : 'app.managementUnavailable')}</p>
  </>;
}

interface FlyoutProps {
  apps?: HubApp[];
  news?: NewsItem[];
  catalogState?: CatalogState;
  onCatalogRetry?: () => void;
  installedStateKnown?: boolean;
  onAppsRefresh?: () => void;
  validNewsKeys?: ReadonlySet<string>;
}

export function FlyoutPanel({ apps = sampleApps, news = sampleNews, catalogState, onCatalogRetry, installedStateKnown = true, onAppsRefresh, validNewsKeys }: FlyoutProps) {
  const [active, setActive] = useState<Tab>('apps');
  const store = useSettings();
  const settings = store.settings;
  const locale = localeFrom(settings);
  const [previewLanguage, setPreviewLanguage] = useState<Language>('es');
  const shown = settings ?? defaultSettings;
  const firstRun = !settings?.firstRunComplete;
  const usable = store.fileState === 'ready' || store.fileState === 'missing';
  const native = isTauri();
  const motion = useFlyoutMotion();
  const { visibility, lastShow, error: visibilityError } = useFlyoutVisibility(() => {
    finishNews();
  });
  const refreshAppsRef = useRef(onAppsRefresh);
  refreshAppsRef.current = onAppsRefresh;
  const installs = useCatalogInstalls(native && !!onAppsRefresh, apps, onAppsRefresh);
  useEffect(() => {
    if (visibility?.visible) refreshAppsRef.current?.();
  }, [visibility?.cycle, visibility?.visible]);
  const openedCycle = useRef(0);
  const visitedCycle = useRef(0);
  const viewed = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<{ items: NewsItem[]; at: string; stale: boolean; cycle: number; seenKeys: ReadonlySet<string> } | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [targetAppId, setTargetAppId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hasBackdrop, setHasBackdrop] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useContentBackdrop(panelRef, native && hasBackdrop, motion.phase, motion.generation, shown.blur, shown.opacity);
  const [registry, setRegistry] = useState<RegistrySnapshot>({ revision: 0, apps: [] });
  const [registryFailed, setRegistryFailed] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ error: boolean; warning?: boolean; text: string; localize?: boolean; key?: 'appControl.quitAccepted' } | null>(null);
  function openApp(id: string) {
    setActionBusy(true); setActionMessage(null);
    void openOfficialApp(id).then(text => setActionMessage({ error: false, text, localize: true }))
      .catch(error => setActionMessage({ error: true, text: String(error), localize: true }))
      .finally(() => { setActionBusy(false); onAppsRefresh?.(); });
  }
  function closeApp(id: string) {
    setActionBusy(true); setActionMessage(null);
    void closeConnectedApp(id).then(() => setActionMessage({ error: false, text: '', key: 'appControl.quitAccepted' }))
      .catch(error => setActionMessage({ error: true, text: String(error) }))
      .finally(() => { setActionBusy(false); onAppsRefresh?.(); });
  }
  function closeProcessApp(id: string) {
    setActionBusy(true); setActionMessage(null);
    void closeOfficialApp(id).then(result => setActionMessage({ error: false, warning: result.status === 'stillRunning', text: result.message }))
      .catch(error => setActionMessage({ error: true, text: String(error), localize: true }))
      .finally(() => { setActionBusy(false); onAppsRefresh?.(); });
  }
  const installed = apps.filter(isInstalled);
  const installedCount = installed.length;
  const sampleInstalled = installed.some(app => app.source !== 'official');

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const failed = (error: unknown) => {
      console.error('No se pudo leer el registro de Nexo.', error);
      if (mounted) setRegistryFailed(true);
    };
    void subscribeRegistry(next => {
      if (mounted) setRegistry(current => next.revision >= current.revision ? next : current);
    }, failed).then(stop => { if (mounted) unlisten = stop; else stop(); }).catch(failed);
    return () => { mounted = false; unlisten?.(); };
  }, []);

  useEffect(() => {
    let mounted = true;
    void backdropAvailable().then(available => { if (mounted) setHasBackdrop(available); });
    return () => { mounted = false; };
  }, []);

  function finishNews() {
    const open = snapshotRef.current;
    if (!open) return;
    snapshotRef.current = null;
    store.recordVisit(open.at, Array.from(viewed.current));
    viewed.current.clear();
    setSnapshot(null);
  }

  function hidePanel() {
    finishNews();
    if (native) requestFlyoutHide();
    else void hideFlyout();
  }

  useEffect(() => {
    if (!visibility || !usable || !settings) return;
    if (lastShow && visitedCycle.current !== lastShow.cycle) {
      visitedCycle.current = lastShow.cycle;
      const shownAt = typeof lastShow.at === 'string' ? lastShow.at : new Date(lastShow.at || Date.now()).toISOString();
      store.recordVisit(shownAt, []);
    }
    if (!visibility.visible) { finishNews(); return; }
    const at = typeof visibility.at === 'string' ? visibility.at : new Date(visibility.at || Date.now()).toISOString();
    if (validNewsKeys && catalogState && !catalogState.stale && catalogState.status !== 'loading') {
      store.recordVisit(at, [], validNewsKeys);
    }
    if (!settings.firstRunComplete) return;
    if (!settings.showNewsOnOpen) { openedCycle.current = visibility.cycle; return; }
    if (openedCycle.current === visibility.cycle) return;
    if (!news.length) return;
    openedCycle.current = visibility.cycle;
    viewed.current.clear();
    const next = { items: news.slice(0, 4), at, stale: !!catalogState?.stale, cycle: visibility.cycle, seenKeys: new Set(store.getVisit()?.seenKeys ?? []) };
    snapshotRef.current = next;
    setTargetAppId(null);
    setSnapshot(next);
  }, [visibility, lastShow, usable, settings, news, validNewsKeys, catalogState]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented && !snapshot) {
        event.preventDefault();
        hidePanel();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [snapshot]);

  const panelStyle = {
    ...accentVariables(shown.accent),
    '--hub-density': shown.compact ? '0.8' : '1', '--hub-opacity': String(shown.opacity / 100), '--hub-blur': `${shown.blur}px`,
  } as CSSProperties;

  function updateSettings(next: HubSettings) {
    if (!settings) return;
    const displayed = { ...settings, language: store.languageDraft ?? settings.language };
    const patch = Object.fromEntries((Object.keys(next) as (keyof HubSettings)[])
      .filter(key => key !== 'startWithWindows' && next[key] !== displayed[key])
      .map(key => [key, next[key]]));
    store.change(patch);
  }
  const errorLocale = usable && firstRun ? previewLanguage : locale;
  const plural = new Intl.PluralRules(intlLocale(locale)).select(installedCount);

  return <LocaleProvider locale={locale}><main ref={panelRef} className={`flyout${hasBackdrop ? ' has-native-backdrop' : ''}${motion.className}`} data-backdrop={motion.sliding ? 'opaque' : undefined} data-custom-accent={normalizeHex(shown.accent) !== DEFAULT_ACCENT ? '' : undefined} aria-labelledby="panel-title" style={panelStyle} onTransitionEnd={motion.onTransitionEnd}>
    <header className="panel-head"><div className="heading"><img className="n-mark" src={nexoLogo} alt="" /><h1 id="panel-title">Nexo</h1>
      <p>· {installedStateKnown ? `${t(locale, plural === 'one' ? 'app.headerOne' : 'app.headerOther', { count: formatNumber(locale, installedCount) })}${sampleInstalled ? ` (${t(locale, 'common.sample')})` : ''}` : t(locale, 'app.headerUnknown')}</p>
      <div className="head-actions">
        {usable && !firstRun && !showSettings && <IconButton label={t(locale, 'common.settings')} title={t(locale, 'common.settings')} variant="ghost" icon={<Icon name="settings" />} onClick={() => setShowSettings(true)} />}
        <IconButton label={t(locale, 'app.closePanel')} title={t(locale, 'app.closePanel')} variant="ghost" icon={<Icon name="close" />} onClick={hidePanel} />
      </div>
    </div></header>
    {visibilityError && <Notice tone="danger" summary={t(locale, 'app.visibilityError', { error: visibilityError })} />}
    {registryFailed && <Notice tone="danger" summary={t(locale, 'app.registryError')} />}
    {actionMessage && <Notice size="sm" tone={actionMessage.error ? 'danger' : actionMessage.warning ? 'warning' : 'success'} summary={actionMessage.key ? t(locale, actionMessage.key) : actionMessage.localize ? localizeAppReason(locale, actionMessage.text) : actionMessage.text} />}
    {registry.notice && <Notice tone="danger" summary={noticeText(locale, registry.notice)} actions={registry.notice.hub_only_allowed && <Button variant="neutral" size="sm" onClick={() => void (async () => {
      if (await store.flush()) await exitHubOnly();
    })().catch(error => console.error('No se pudo cerrar solo Nexo.', error))}>{t(locale, 'app.hubOnly')}</Button>} />}
    {store.nativeError && <Notice tone="danger" summary={`${t(locale, 'native.refreshError', { error: store.nativeError })} `} actions={<Button variant="neutral" size="sm" onClick={store.retryNative}>{t(locale, 'native.refreshRetry')}</Button>} />}
    {store.error && <Notice tone="danger" lang={errorLocale} summary={`${t(errorLocale, store.error.key, { error: store.error.detailKey ? t(errorLocale, store.error.detailKey) : store.error.detail ?? '' })} `} actions={<Button variant="neutral" size="sm" onClick={!usable ? store.reload : firstRun && store.error.key === 'settings.saveError' ? () => store.choose(previewLanguage) : store.retry}>{t(errorLocale, 'common.retry')}</Button>} />}
    {store.fileState === null ? <p role="status" className="settings__foot">{t(locale, 'app.loadingSettings')}</p> : !usable ? <div className="settings__foot">
      {!store.error && <p role="alert">{t(locale, store.fileState === 'future' ? 'app.futureSettings' : 'app.unreadableSettings')}</p>}
      {store.fileState !== 'future' && <Button variant="neutral" size="sm" onClick={store.recover}>{t(locale, 'app.recoverSettings')}</Button>}
      <Button variant="neutral" size="sm" onClick={store.reload}>{t(locale, 'app.retryRead')}</Button>
    </div> : firstRun ? <div className="area-scroll"><FirstRun onChoose={store.choose} onPreview={language => { setPreviewLanguage(language); store.previewChoice(language); }} /></div> : settings && showSettings ? <div className="area-scroll"><SettingsView settings={{ ...settings, language: store.languageDraft ?? settings.language }} languagePending={store.languageDraft !== null} sources={settings.sources} autostart={store.autostart} onChange={updateSettings} onClose={() => setShowSettings(false)} /></div> :
      <Tabs className="main-tabs" variant="segmented" label={t(locale, 'app.sections')} value={active} onValueChange={value => setActive(value as Tab)} items={[
        { value: 'apps', label: t(locale, 'app.myApps'), content: <InstalledPanel apps={apps} connected={registry.apps} installedStateKnown={installedStateKnown} onRefresh={onAppsRefresh} onClose={onAppsRefresh ? closeApp : undefined} onProcessClose={onAppsRefresh ? closeProcessApp : undefined} onOpen={onAppsRefresh ? openApp : undefined} actionBusy={actionBusy} stale={catalogState?.stale === true || (!!catalogState && catalogState.status !== 'ready' && catalogState.status !== 'empty')} localCycle={visibility?.visible ? visibility.cycle : undefined} catalogState={catalogState} installs={installs} selectCatalog={() => setActive('catalog')} /> },
        { value: 'catalog', label: t(locale, 'common.catalog'), content: <CatalogView apps={apps} state={catalogState?.status} stale={catalogState?.stale} reason={catalogState?.reason} installationKnown={installedStateKnown} onRetry={onCatalogRetry} targetAppId={targetAppId} catalog={catalogState?.catalog} installs={installs} /> },
      ]} />}
    {settings && <NewsPopup key={snapshot?.cycle} items={snapshot?.items ?? []} seenKeys={snapshot?.seenKeys} open={usable && !firstRun && !!snapshot} onClose={finishNews} dontShow={!settings.showNewsOnOpen}
      stale={snapshot?.stale} onShown={item => viewed.current.add(item.id)}
      onCatalog={appId => { finishNews(); setShowSettings(false); setTargetAppId(appId); setActive('catalog'); }}
      onDontShowChange={dontShow => store.change({ showNewsOnOpen: !dontShow })} />}
  </main></LocaleProvider>;
}

export default function App(props: FlyoutProps) {
  const native = isTauri();
  const liveCatalog = native && props.apps === undefined;
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' });
  const [installations, setInstallations] = useState<InstallationObservation[] | null>(null);
  const requestId = useRef(0);
  const scanId = useRef(0);

  function refreshApps() {
    if (!liveCatalog || !catalogState.catalog || catalogState.reason === 'cache') return;
    const id = ++scanId.current;
    setInstallations(null);
    void scanInstallations().then(result => {
      if (id === scanId.current) setInstallations(result);
    }).catch(() => {
      if (id === scanId.current) setInstallations(null);
    });
  }

  function retry() {
    const id = ++requestId.current;
    setCatalogState(current => ({ ...current, status: 'loading' }));
    void loadVersionedCatalog(OFFICIAL_CATALOG_V2_URL, OFFICIAL_CATALOG_URL, diskCacheV2, diskCache, webFetcher, OFFICIAL_CATALOG_V3_URL, diskCacheV3).then(result => {
      if (id === requestId.current) setCatalogState(result);
    });
  }
  useEffect(() => {
    if (liveCatalog) retry();
    return () => { requestId.current++; };
  }, [liveCatalog]);

  useEffect(() => {
    setInstallations(null);
    if (liveCatalog && catalogState.catalog) refreshApps();
    function onFocus() { refreshApps(); }
    window.addEventListener('focus', onFocus);
    return () => { scanId.current++; window.removeEventListener('focus', onFocus); };
  }, [liveCatalog, catalogState.catalog, catalogState.reason]);

  if (!liveCatalog) return <FlyoutPanel {...props} news={props.news ?? (native ? [] : sampleNews)} />;
  const byId = new Map((installations ?? []).map(item => [item.id, item]));
  const known = Object.fromEntries((installations ?? []).filter(item => item.state !== 'unknown').map(item => [item.id, {
    installed: item.state === 'installed', running: item.runningState === 'running' || item.runningState === 'connected', version: item.version ?? undefined,
  }]));
  const catalog = catalogState.catalog;
  const projected = catalog ? projectCatalog(catalog, known) : { apps: [] };
  const selection = catalog ? selectOfficialNews(catalog) : { items: [], validKeys: undefined };
  const apps = projected.apps.map(app => ({ ...app, installationState: byId.get(app.id)?.state ?? 'unknown' as const,
    installationReason: byId.get(app.id)?.reason, runningState: byId.get(app.id)?.runningState ?? 'unknown' as const,
    canOpen: byId.get(app.id)?.canOpen === true, openReason: byId.get(app.id)?.openReason ?? undefined }));
  const installedStateKnown = installations !== null && apps.every(app => app.installationState !== 'unknown');
  return <FlyoutPanel {...props} apps={apps} news={selection.items} validNewsKeys={selection.validKeys} catalogState={catalogState} onCatalogRetry={retry} onAppsRefresh={refreshApps} installedStateKnown={installedStateKnown} />;
}
