import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, IconButton, Tabs } from '@egdev/ui';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { closeConnectedApp, localizeAppReason, openOfficialApp, scanInstallations, type InstallationObservation } from './apps';
import { CatalogView } from './catalog';
import { diskCache, diskCacheV2, loadVersionedCatalog, OFFICIAL_CATALOG_URL, OFFICIAL_CATALOG_V2_URL, webFetcher, type CatalogState } from './catalog/loader';
import { projectCatalog } from './catalog/mapping';
import { FirstRun } from './first-run';
import { formatNumber, intlLocale, t } from './i18n';
import { LocaleProvider, localeFrom, useLocale } from './i18n/use-locale';
import type { HubApp, HubSettings, Language, NewsItem } from './model';
import { NewsPopup } from './news';
import { selectOfficialNews } from './news/selection';
import { useFlyoutVisibility } from './news/use-flyout';
import { defaultSettings, sampleApps, sampleNews } from './sample';
import { SettingsView } from './settings';
import { derivePalette } from './settings/palette';
import { useSettings } from './settings/use-settings';
import { exitHubOnly, subscribeRegistry } from './shell/registry';
import { noticeText } from './shell/notice';
import type { RegistryApp, RegistrySnapshot } from './shell/registry';
import { backdropAvailable, hideFlyout } from './window';
import nexoLogo from '../src-tauri/app-icon.svg';
import './style.css';

type Tab = 'apps' | 'catalog';

// Catalog actions remain illustrative until their own roadmap issues implement them.
function Action({ label, app, primary = false }: { label: string; app: HubApp; primary?: boolean }) {
  const locale = useLocale();
  return <Button variant={primary ? 'primary' : 'neutral'} size="sm" type="button" aria-label={`${label} ${app.name}`} title={t(locale, 'app.illustrativeDisabled')} disabled>{label}</Button>;
}

function OpenAction({ app, onOpen, busy, stale }: { app: HubApp; onOpen?: (id: string) => void; busy: boolean; stale: boolean }) {
  const locale = useLocale();
  const enabled = !!onOpen && app.source === 'official' && app.installationState === 'installed' && app.canOpen === true && !busy && !stale;
  const title = stale ? t(locale, 'appControl.staleTitle') : app.openReason ? localizeAppReason(locale, app.openReason) : t(locale, enabled ? 'appControl.requestOpen' : 'appControl.openUnavailable');
  return <Button variant="neutral" size="sm" type="button" aria-label={t(locale, 'appControl.openFor', { name: app.name })} title={title} disabled={!enabled} onClick={() => onOpen?.(app.id)}>{t(locale, 'common.open')}</Button>;
}

function AppIcon({ app }: { app: HubApp }) {
  return <span aria-hidden="true" className={`app-icon ${app.id === 'antena' ? 'brand-icon' : ''}`}>{app.name[0]}</span>;
}

function Status({ app }: { app: HubApp }) {
  const locale = useLocale();
  if (app.installationState === 'installed') return <span className="secondary"><span>{t(locale, 'app.installedVersion', { version: app.version ?? t(locale, 'appControl.versionUnavailable') })}</span> · <span>{t(locale, 'appControl.runningUnknown')}</span></span>;
  if (app.integration === 'local') return <span className="secondary">{t(locale, app.source === 'official' ? 'app.officialLaunch' : 'app.localUnknown')}</span>;
  return <span className="secondary">{t(locale, 'app.unknown')}{app.update && <> · <span className="status-warning">{t(locale, 'app.updateSample')}</span></>}</span>;
}

function ConnectedRow({ app, official, onClose, onOpen, busy }: { app: RegistryApp; official?: HubApp; onClose?: (id: string) => void; onOpen?: (id: string) => void; busy: boolean }) {
  const locale = useLocale();
  return <Collapsible className="app-card" defaultOpen>
    <div className="app-row"><CollapsibleTrigger>
      <span className="row-label"><span aria-hidden="true" className="app-icon">{app.app.name[0]}</span>
        <span className="app-info"><strong>{app.app.name}</strong>
          {app.responsive ? <span className="status-running">{t(locale, 'app.connected')}</span> : <span className="secondary">{t(locale, 'app.unresponsive')}</span>}
        </span>
      </span>
    </CollapsibleTrigger></div>
    <CollapsibleContent>
      <p className="meta">{t(locale, 'app.reportedVersion', { version: app.app.version, tray: t(locale, app.unified ? 'app.unified' : 'app.ownIcon') })}</p>
      {official && <p className="meta">{official.installationState === 'installed' ? t(locale, 'app.installedVersion', { version: official.version ?? t(locale, 'appControl.versionUnavailable') }) : official.installationState === 'notInstalled' ? t(locale, 'appControl.notInstalled') : t(locale, 'appControl.installationUnknownDetail', { reason: official.installationReason ? localizeAppReason(locale, official.installationReason) : t(locale, 'appControl.unchecked') })}</p>}
      {onOpen && official && <Button type="button" size="sm" variant="neutral" aria-label={t(locale, 'appControl.openFor', { name: app.app.name })} title={t(locale, !app.responsive || !app.capabilities.includes('show') ? 'appControl.showUnavailable' : 'appControl.requestOpen')} disabled={busy || !app.responsive || !app.capabilities.includes('show')} onClick={() => onOpen(app.app.id)}>{t(locale, 'common.open')}</Button>}
      {onClose && (app.responsive && app.capabilities.includes('quit') ?
        <Button type="button" size="sm" variant="neutral" aria-label={t(locale, 'appControl.closeFor', { name: app.app.name })} disabled={busy} onClick={() => onClose(app.app.id)}>{t(locale, 'common.close')}</Button> :
        <p className="meta">{t(locale, 'appControl.closeUnavailable')}</p>)}
      {app.menu.length > 0 && <><p className="meta">{t(locale, 'app.reportedMenu')}</p><ul className="registry-menu">
        {app.menu.map((item, index) => <li key={`${item.id}-${index}`}>{item.label}{!item.enabled && t(locale, 'app.disabled')}{item.checked === true && t(locale, 'app.checked')}{item.checked === false && t(locale, 'app.unchecked')}</li>)}
      </ul></>}
    </CollapsibleContent>
  </Collapsible>;
}

function AppRow({ app, onOpen, busy, stale }: { app: HubApp; onOpen?: (id: string) => void; busy: boolean; stale: boolean }) {
  const locale = useLocale();
  return <Collapsible className="app-card" defaultOpen={app.id === 'antena'}>
    <div className="app-row">
      <CollapsibleTrigger>
        <span className="row-label"><AppIcon app={app} /><span className="app-info"><strong>{app.name}</strong><Status app={app} /></span></span>
      </CollapsibleTrigger>
      {app.id !== 'antena' && (onOpen ? <OpenAction app={app} onOpen={onOpen} busy={busy} stale={stale} /> : <Action label={t(locale, 'common.open')} app={app} />)}
    </div>
    <CollapsibleContent>
      {app.update && <div className="detail-grid">
        <div><div className="status-warning">{t(locale, 'app.available', { version: app.update })}</div><div className="version">{t(locale, 'app.installedVersion', { version: app.version ?? '' })}</div></div>
        <Action label={t(locale, 'common.update')} app={app} primary />
      </div>}
      <p className="meta">{app.description}</p>
      {onOpen && !app.canOpen && <p className="meta">{t(locale, 'appControl.openUnavailableDetail', { reason: app.openReason ? localizeAppReason(locale, app.openReason) : t(locale, 'appControl.executableUnchecked') })}</p>}
      {onOpen && stale && <p className="meta">{t(locale, 'appControl.staleOpenDetail')}</p>}
      <div className="actions">{onOpen ? <OpenAction app={app} onOpen={onOpen} busy={busy} stale={stale} /> : <Action label={t(locale, app.id === 'antena' ? 'app.openPanel' : 'common.open')} app={app} />}</div>
    </CollapsibleContent>
  </Collapsible>;
}

function InstalledPanel({ apps, connected, selectCatalog, installedStateKnown, onRefresh, onClose, onOpen, actionBusy, stale }: { apps: HubApp[]; connected: RegistryApp[]; selectCatalog: () => void; installedStateKnown: boolean; onRefresh?: () => void; onClose?: (id: string) => void; onOpen?: (id: string) => void; actionBusy: boolean; stale: boolean }) {
  const locale = useLocale();
  const ids = new Set(connected.map(entry => entry.app.id));
  const allInstalled = apps.filter(app => app.statusKnown !== false && app.installed);
  const installed = allInstalled.filter(app => !ids.has(app.id));
  const available = apps.filter(app => app.statusKnown !== false && !app.installed && !ids.has(app.id));
  const unknown = apps.filter(app => app.installationState === 'unknown' && !ids.has(app.id));
  const plural = new Intl.PluralRules(intlLocale(locale)).select(allInstalled.length);
  return <>
    {onRefresh && <Button variant="neutral" size="sm" onClick={onRefresh}>{t(locale, 'appControl.refresh')}</Button>}
    {connected.length > 0 && <section aria-labelledby="connected-title"><div className="section-label"><h2 id="connected-title">{t(locale, 'app.connectedPlural')}</h2><span>{formatNumber(locale, connected.length)}</span></div>
      {connected.map(app => <ConnectedRow key={app.app.id} app={app} official={apps.find(item => item.source === 'official' && item.id === app.app.id)} onClose={onClose} onOpen={onOpen} busy={actionBusy} />)}
    </section>}
    <div className="section-label"><h2>{t(locale, 'app.installed')}</h2>{installedStateKnown && <span>{t(locale, plural === 'one' ? 'app.appOne' : 'app.appOther', { count: formatNumber(locale, allInstalled.length) })}{allInstalled.some(app => app.source !== 'official') && ` · ${t(locale, 'common.sample')}`}</span>}</div>
    {installed.length ? installed.map(app => <AppRow key={app.id} app={app} onOpen={onOpen} busy={actionBusy} stale={stale} />) : <div className="empty-state"><p>{allInstalled.length ? t(locale, 'appControl.connectedAbove') : t(locale, installedStateKnown ? 'app.empty' : 'app.installationUnknown')}</p><Button variant="neutral" size="sm" onClick={selectCatalog}>{t(locale, 'app.viewCatalog')}</Button></div>}
    {available.length > 0 && <section className="catalog-preview" aria-labelledby="preview-title">
      <div className="section-label"><h2 id="preview-title">{t(locale, 'app.alsoCatalog')}</h2><span>{t(locale, 'app.notInstalled')}</span></div>
      {available.map(app => <div className="preview-row" key={app.id}><div className="app-info"><strong>{app.name}</strong><span className="secondary">{t(locale, 'common.officialCatalog')}</span></div><Action label={t(locale, 'common.install')} app={app} /></div>)}
    </section>}
    {unknown.length > 0 && <section aria-label={t(locale, 'appControl.installationUnknown')}><div className="section-label"><h2>{t(locale, 'appControl.installationUnknown')}</h2></div>
      {unknown.map(app => <div className="preview-row" key={app.id}><div className="app-info"><strong>{app.name}</strong><span className="secondary">{app.installationReason ? localizeAppReason(locale, app.installationReason) : t(locale, 'appControl.unknownInstallFallback')}</span></div></div>)}
    </section>}
    {available.some(app => app.id === 'pizarra') && <p className="news-line"><Badge tone="brand">{t(locale, 'app.new')}</Badge> {t(locale, 'app.pizarraNews')}</p>}
    <p className="foot">{t(locale, onRefresh ? 'appControl.closeWithoutPlugin' : installedStateKnown ? 'app.sampleFoot' : 'app.managementUnavailable')}</p>
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
  const { visibility, lastShow, error: visibilityError } = useFlyoutVisibility(finishNews);
  const refreshAppsRef = useRef(onAppsRefresh);
  refreshAppsRef.current = onAppsRefresh;
  useEffect(() => {
    if (visibility?.visible) refreshAppsRef.current?.();
  }, [visibility?.cycle, visibility?.visible]);
  const openedCycle = useRef(0);
  const visitedCycle = useRef(0);
  const viewed = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<{ items: NewsItem[]; at: string; stale: boolean } | null>(null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const [targetAppId, setTargetAppId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [hasBackdrop, setHasBackdrop] = useState(false);
  const [registry, setRegistry] = useState<RegistrySnapshot>({ revision: 0, apps: [] });
  const [registryFailed, setRegistryFailed] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ error: boolean; text: string; localize?: boolean; key?: 'appControl.quitAccepted' } | null>(null);
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
  const installed = apps.filter(app => app.statusKnown !== false && app.installed);
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
    if (isTauri()) void invoke('hide_flyout').catch(error => console.error('No se pudo ocultar el panel de Nexo.', error));
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
    const seen = new Set(store.getVisit()?.seenKeys ?? []);
    const unseen = news.filter(item => !seen.has(item.id)).slice(0, 10);
    if (!unseen.length) return;
    openedCycle.current = visibility.cycle;
    viewed.current.clear();
    const next = { items: unseen, at, stale: !!catalogState?.stale };
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

  const tones = derivePalette(shown.accent);
  const panelStyle = {
    '--hub-accent': shown.accent, '--hub-accent-light': tones[1], '--hub-accent-mid': tones[2],
    '--color-fg-brand-default': tones[0], '--color-fg-brand-raised': tones[1], '--color-fg-brand-hover': tones[2],
    '--color-border-brand': tones[2], '--color-action-primary-solid-bg': tones[0], '--color-action-primary-solid-bg-hover': tones[2],
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

  return <LocaleProvider locale={locale}><main className={hasBackdrop ? 'flyout has-native-backdrop' : 'flyout'} aria-labelledby="panel-title" style={panelStyle}>
    <header className="panel-head"><div className="heading"><img className="n-mark" src={nexoLogo} alt="" /><h1 id="panel-title">Nexo</h1>
      <p>· {installedStateKnown ? `${t(locale, plural === 'one' ? 'app.headerOne' : 'app.headerOther', { count: formatNumber(locale, installedCount) })}${sampleInstalled ? ` (${t(locale, 'common.sample')})` : ''}` : t(locale, 'app.headerUnknown')}</p>
      <div className="head-actions">
        {usable && !firstRun && !showSettings && <IconButton label={t(locale, 'common.settings')} title={t(locale, 'common.settings')} variant="secondary" icon={<Icon name="settings" />} onClick={() => setShowSettings(true)} />}
        <IconButton label={t(locale, 'app.closePanel')} title={t(locale, 'app.closePanel')} variant="secondary" icon={<Icon name="close" />} onClick={hidePanel} />
      </div>
    </div></header>
    {visibilityError && <div className="registry-notice" role="alert">{t(locale, 'app.visibilityError', { error: visibilityError })}</div>}
    {registryFailed && <div className="registry-notice" role="alert">{t(locale, 'app.registryError')}</div>}
    {actionMessage && <div className="registry-notice" role={actionMessage.error ? 'alert' : 'status'}>{actionMessage.key ? t(locale, actionMessage.key) : actionMessage.localize ? localizeAppReason(locale, actionMessage.text) : actionMessage.text}</div>}
    {registry.notice && <div className="registry-notice" role="alert"><p>{noticeText(locale, registry.notice)}</p>
      {registry.notice.hub_only_allowed && <Button variant="neutral" size="sm" onClick={() => void (async () => {
        if (await store.flush()) await exitHubOnly();
      })().catch(error => console.error('No se pudo cerrar solo Nexo.', error))}>{t(locale, 'app.hubOnly')}</Button>}
    </div>}
    {store.nativeError && <div className="settings__foot" role="alert">{t(locale, 'native.refreshError', { error: store.nativeError })} <Button variant="neutral" size="sm" onClick={store.retryNative}>{t(locale, 'native.refreshRetry')}</Button></div>}
    {store.error && <div className="settings__foot" role="alert" lang={errorLocale}>{t(errorLocale, store.error.key, { error: store.error.detailKey ? t(errorLocale, store.error.detailKey) : store.error.detail ?? '' })} <Button variant="neutral" size="sm" onClick={!usable ? store.reload : firstRun && store.error.key === 'settings.saveError' ? () => store.choose(previewLanguage) : store.retry}>{t(errorLocale, 'common.retry')}</Button></div>}
    {store.fileState === null ? <p role="status" className="settings__foot">{t(locale, 'app.loadingSettings')}</p> : !usable ? <div className="settings__foot">
      {!store.error && <p role="alert">{t(locale, store.fileState === 'future' ? 'app.futureSettings' : 'app.unreadableSettings')}</p>}
      {store.fileState !== 'future' && <Button variant="neutral" size="sm" onClick={store.recover}>{t(locale, 'app.recoverSettings')}</Button>}
      <Button variant="neutral" size="sm" onClick={store.reload}>{t(locale, 'app.retryRead')}</Button>
    </div> : firstRun ? <div className="area-scroll"><FirstRun onChoose={store.choose} onPreview={language => { setPreviewLanguage(language); store.previewChoice(language); }} /></div> : settings && showSettings ? <div className="area-scroll"><SettingsView settings={{ ...settings, language: store.languageDraft ?? settings.language }} languagePending={store.languageDraft !== null} sources={settings.sources} autostart={store.autostart} onChange={updateSettings} onClose={() => setShowSettings(false)} /></div> :
      <Tabs className="main-tabs" variant="segmented" label={t(locale, 'app.sections')} value={active} onValueChange={value => setActive(value as Tab)} items={[
        { value: 'apps', label: t(locale, 'app.myApps'), content: <InstalledPanel apps={apps} connected={registry.apps} installedStateKnown={installedStateKnown} onRefresh={onAppsRefresh} onClose={onAppsRefresh ? closeApp : undefined} onOpen={onAppsRefresh ? openApp : undefined} actionBusy={actionBusy} stale={catalogState?.stale === true || (!!catalogState && catalogState.status !== 'ready' && catalogState.status !== 'empty')} selectCatalog={() => setActive('catalog')} /> },
        { value: 'catalog', label: t(locale, 'common.catalog'), content: <CatalogView apps={apps} state={catalogState?.status} stale={catalogState?.stale} reason={catalogState?.reason} installationKnown={installedStateKnown} onRetry={onCatalogRetry} targetAppId={targetAppId} /> },
      ]} />}
    {settings && <NewsPopup items={snapshot?.items ?? []} open={usable && !firstRun && !!snapshot} onClose={finishNews} dontShow={!settings.showNewsOnOpen}
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
    void loadVersionedCatalog(OFFICIAL_CATALOG_V2_URL, OFFICIAL_CATALOG_URL, diskCacheV2, diskCache, webFetcher).then(result => {
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
    installed: item.state === 'installed', running: false, version: item.version ?? undefined,
  }]));
  const catalog = catalogState.catalog;
  const projected = catalog ? projectCatalog(catalog, known) : { apps: [] };
  const selection = catalog ? selectOfficialNews(catalog) : { items: [], validKeys: undefined };
  const apps = projected.apps.map(app => ({ ...app, installationState: byId.get(app.id)?.state ?? 'unknown' as const,
    installationReason: byId.get(app.id)?.reason, runningState: 'unknown' as const,
    canOpen: byId.get(app.id)?.canOpen === true, openReason: byId.get(app.id)?.openReason ?? undefined }));
  const installedStateKnown = installations !== null && apps.every(app => app.installationState !== 'unknown');
  return <FlyoutPanel {...props} apps={apps} news={selection.items} validNewsKeys={selection.validKeys} catalogState={catalogState} onCatalogRetry={retry} onAppsRefresh={refreshApps} installedStateKnown={installedStateKnown} />;
}
