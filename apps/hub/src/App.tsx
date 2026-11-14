import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, IconButton, Tabs } from '@egdev/ui';
import { isTauri } from '@tauri-apps/api/core';
import { closeConnectedApp, openOfficialApp, scanInstallations, type InstallationObservation } from './apps';
import { CatalogView } from './catalog';
import { diskCache, diskCacheV2, loadVersionedCatalog, OFFICIAL_CATALOG_URL, OFFICIAL_CATALOG_V2_URL, webFetcher, type CatalogState } from './catalog/loader';
import { projectCatalog } from './catalog/mapping';
import { FirstRun } from './first-run';
import type { HubApp, HubSettings, NewsItem } from './model';
import { NewsPopup } from './news';
import { defaultSettings, sampleApps, sampleNews } from './sample';
import { SettingsView } from './settings';
import { derivePalette } from './settings/palette';
import { useSettings } from './settings/use-settings';
import { exitHubOnly, subscribeRegistry } from './shell/registry';
import type { RegistryApp, RegistrySnapshot } from './shell/registry';
import { backdropAvailable, hideFlyout } from './window';
import './style.css';

type Tab = 'apps' | 'catalog';

// Catalog actions remain illustrative until their own roadmap issues implement them.
function Action({ label, app, primary = false }: { label: string; app: HubApp; primary?: boolean }) {
  return <Button variant={primary ? 'primary' : 'neutral'} size="sm" type="button" aria-label={`${label} ${app.name}`} title="Acción ilustrativa no disponible" disabled>{label}</Button>;
}

function OpenAction({ app, onOpen, busy, stale }: { app: HubApp; onOpen?: (id: string) => void; busy: boolean; stale: boolean }) {
  const enabled = !!onOpen && app.source === 'official' && app.installationState === 'installed' && app.canOpen === true && !busy && !stale;
  return <Button variant="neutral" size="sm" type="button" aria-label={`Abrir ${app.name}`} title={stale ? 'El catálogo puede estar desactualizado' : app.openReason ?? (enabled ? 'Solicitar apertura' : 'Apertura no disponible')} disabled={!enabled} onClick={() => onOpen?.(app.id)}>Abrir</Button>;
}

function AppIcon({ app }: { app: HubApp }) {
  return <span aria-hidden="true" className={`app-icon ${app.id === 'antena' ? 'brand-icon' : ''}`}>{app.name[0]}</span>;
}

function Status({ app }: { app: HubApp }) {
  if (app.installationState === 'installed') return <span className="secondary"><span>Instalada: {app.version ?? 'versión no disponible'}</span> · Estado de ejecución desconocido</span>;
  if (app.integration === 'local') return <span className="secondary">{app.source === 'official' ? 'Catálogo egdev · Solo apertura' : 'App local · Estado desconocido'}</span>;
  return <span className="secondary">Estado desconocido{app.update && <> · <span className="status-warning">Actualización disponible (muestra)</span></>}</span>;
}

function ConnectedRow({ app, official, onClose, onOpen, busy }: { app: RegistryApp; official?: HubApp; onClose?: (id: string) => void; onOpen?: (id: string) => void; busy: boolean }) {
  return <Collapsible className="app-card" defaultOpen>
    <div className="app-row"><CollapsibleTrigger>
      <span className="row-label"><span aria-hidden="true" className="app-icon">{app.app.name[0]}</span>
        <span className="app-info"><strong>{app.app.name}</strong>
          {app.responsive ? <span className="status-running">Conectada</span> : <span className="secondary">Sin respuesta · estado desconocido</span>}
        </span>
      </span>
    </CollapsibleTrigger></div>
    <CollapsibleContent>
      <p className="meta">Versión comunicada: {app.app.version} · {app.unified ? 'Bandeja unificada' : 'Icono propio'}</p>
      {official && <p className="meta">{official.installationState === 'installed' ? `Instalada: ${official.version ?? 'versión no disponible'}` : official.installationState === 'notInstalled' ? 'No instalada' : `Instalación desconocida: ${official.installationReason ?? 'sin comprobar'}`}</p>}
      {onOpen && official && <Button type="button" size="sm" variant="neutral" aria-label={`Abrir ${app.app.name}`} title={!app.responsive || !app.capabilities.includes('show') ? 'La app no responde o no admite mostrar la ventana' : 'Solicitar apertura'} disabled={busy || !app.responsive || !app.capabilities.includes('show')} onClick={() => onOpen(app.app.id)}>Abrir</Button>}
      {onClose && (app.responsive && app.capabilities.includes('quit') ?
        <Button type="button" size="sm" variant="neutral" aria-label={`Cerrar ${app.app.name}`} disabled={busy} onClick={() => onClose(app.app.id)}>Cerrar</Button> :
        <p className="meta">No se puede solicitar el cierre; cierra la app desde la propia app.</p>)}
      {app.menu.length > 0 && <><p className="meta">Menú comunicado por la app</p><ul className="registry-menu">
        {app.menu.map((item, index) => <li key={`${item.id}-${index}`}>{item.label}{!item.enabled && ' · desactivada'}{item.checked === true && ' · marcada'}{item.checked === false && ' · desmarcada'}</li>)}
      </ul></>}
    </CollapsibleContent>
  </Collapsible>;
}

function AppRow({ app, onOpen, busy, stale }: { app: HubApp; onOpen?: (id: string) => void; busy: boolean; stale: boolean }) {
  return <Collapsible className="app-card" defaultOpen={app.id === 'antena'}>
    <div className="app-row">
      <CollapsibleTrigger>
        <span className="row-label"><AppIcon app={app} /><span className="app-info"><strong>{app.name}</strong><Status app={app} /></span></span>
      </CollapsibleTrigger>
      {app.id !== 'antena' && (onOpen ? <OpenAction app={app} onOpen={onOpen} busy={busy} stale={stale} /> : <Action label="Abrir" app={app} />)}
    </div>
    <CollapsibleContent>
      {app.update && <div className="detail-grid">
        <div><div className="status-warning">Disponible: {app.update}</div><div className="version">Instalada: {app.version}</div></div>
        <Action label="Actualizar" app={app} primary />
      </div>}
      <p className="meta">{app.description}</p>
      {onOpen && !app.canOpen && <p className="meta">Apertura no disponible: {app.openReason ?? 'no se pudo comprobar el ejecutable'}.</p>}
      {onOpen && stale && <p className="meta">El catálogo puede estar desactualizado; actualízalo antes de abrir.</p>}
      <div className="actions">
        {onOpen ? <OpenAction app={app} onOpen={onOpen} busy={busy} stale={stale} /> : <Action label={app.id === 'antena' ? 'Abrir panel' : 'Abrir'} app={app} />}

      </div>
    </CollapsibleContent>
  </Collapsible>;
}

function InstalledPanel({ apps, connected, selectCatalog, installedStateKnown, onRefresh, onClose, onOpen, actionBusy, stale }: { apps: HubApp[]; connected: RegistryApp[]; selectCatalog: () => void; installedStateKnown: boolean; onRefresh?: () => void; onClose?: (id: string) => void; onOpen?: (id: string) => void; actionBusy: boolean; stale: boolean }) {
  const ids = new Set(connected.map(entry => entry.app.id));
  const allInstalled = apps.filter(app => app.statusKnown !== false && app.installed);
  const installed = allInstalled.filter(app => !ids.has(app.id));
  const available = apps.filter(app => app.statusKnown !== false && !app.installed && !ids.has(app.id));
  const unknown = apps.filter(app => app.installationState === 'unknown' && !ids.has(app.id));
  return <>
    {onRefresh && <Button variant="neutral" size="sm" onClick={onRefresh}>Actualizar apps</Button>}
    {connected.length > 0 && <section aria-labelledby="connected-title"><div className="section-label"><h2 id="connected-title">Conectadas</h2><span>{connected.length}</span></div>
      {connected.map(app => <ConnectedRow key={app.app.id} app={app} official={apps.find(item => item.source === 'official' && item.id === app.app.id)} onClose={onClose} onOpen={onOpen} busy={actionBusy} />)}
    </section>}
    <div className="section-label"><h2>Instaladas</h2>{installedStateKnown && <span>{allInstalled.length} {allInstalled.length === 1 ? 'aplicación' : 'aplicaciones'}{allInstalled.some(app => app.source !== 'official') && ' · muestra'}</span>}</div>
    {installed.length ? installed.map(app => <AppRow key={app.id} app={app} onOpen={onOpen} busy={actionBusy} stale={stale} />) : <div className="empty-state"><p>{allInstalled.length ? 'Las apps instaladas conectadas aparecen arriba.' : installedStateKnown ? 'No hay aplicaciones instaladas.' : 'Estado de instalación no disponible todavía.'}</p><Button variant="neutral" size="sm" onClick={selectCatalog}>Ver catálogo</Button></div>}
    {available.length > 0 && <section className="catalog-preview" aria-labelledby="preview-title">
      <div className="section-label"><h2 id="preview-title">También en el catálogo</h2><span>Sin instalar</span></div>
      {available.map(app => <div className="preview-row" key={app.id}><div className="app-info"><strong>{app.name}</strong><span className="secondary">Catálogo egdev</span></div><Action label="Instalar" app={app} /></div>)}
    </section>}
    {unknown.length > 0 && <section aria-label="Instalación desconocida"><div className="section-label"><h2>Instalación desconocida</h2></div>
      {unknown.map(app => <div className="preview-row" key={app.id}><div className="app-info"><strong>{app.name}</strong><span className="secondary">{app.installationReason ?? 'No se pudo comprobar la instalación'}</span></div></div>)}
    </section>}
    {available.some(app => app.id === 'pizarra') && <p className="news-line"><Badge tone="brand">Nuevo</Badge> Pizarra en Novedades</p>}
    <p className="foot">{onRefresh ? 'Para cerrar una app sin plugin, hazlo desde la propia app.' : installedStateKnown ? 'Muestra de diseño · las acciones de apps son ilustrativas.' : 'La gestión de aplicaciones aún no está disponible.'}</p>
  </>;
}

interface FlyoutProps {
  apps?: HubApp[];
  news?: NewsItem[];
  catalogState?: CatalogState;
  onCatalogRetry?: () => void;
  installedStateKnown?: boolean;
  onAppsRefresh?: () => void;
}

export function FlyoutPanel({ apps = sampleApps, news = sampleNews, catalogState, onCatalogRetry, installedStateKnown = true, onAppsRefresh }: FlyoutProps) {
  const [active, setActive] = useState<Tab>('apps');
  const store = useSettings();
  const settings = store.settings;
  const shown = settings ?? defaultSettings;
  const firstRun = !settings?.firstRunComplete;
  const usable = store.fileState === 'ready' || store.fileState === 'missing';
  const openedInitialNews = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [hasBackdrop, setHasBackdrop] = useState(false);
  const [registry, setRegistry] = useState<RegistrySnapshot>({ revision: 0, apps: [] });
  const [registryFailed, setRegistryFailed] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ error: boolean; text: string } | null>(null);
  function openApp(id: string) {
    setActionBusy(true); setActionMessage(null);
    void openOfficialApp(id).then(text => setActionMessage({ error: false, text }))
      .catch(error => setActionMessage({ error: true, text: String(error) }))
      .finally(() => { setActionBusy(false); onAppsRefresh?.(); });
  }
  function closeApp(id: string) {
    setActionBusy(true); setActionMessage(null);
    void closeConnectedApp(id).then(() => setActionMessage({ error: false, text: 'Solicitud de cierre aceptada; la salida no está confirmada.' }))
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

  useEffect(() => {
    if (usable && settings?.firstRunComplete && !openedInitialNews.current && news.length > 0) {
      openedInitialNews.current = true;
      if (settings.showNewsOnOpen) setNewsOpen(true);
    }
  }, [usable, settings?.firstRunComplete, settings?.showNewsOnOpen, news.length]);

  // A tray reopen focuses the same webview rather than remounting the React tree.
  useEffect(() => {
    function onFocus() {
      if (usable && settings?.firstRunComplete && settings.showNewsOnOpen && news.length > 0) setNewsOpen(true);
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [usable, settings?.firstRunComplete, settings?.showNewsOnOpen, news.length]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented && !newsOpen) {
        event.preventDefault();
        void hideFlyout();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [newsOpen]);

  const tones = derivePalette(shown.accent);
  const panelStyle = {
    '--hub-accent': shown.accent,
    '--hub-accent-light': tones[1],
    '--hub-accent-mid': tones[2],
    '--color-fg-brand-default': tones[0],
    '--color-fg-brand-raised': tones[1],
    '--color-fg-brand-hover': tones[2],
    '--color-border-brand': tones[2],
    '--color-action-primary-solid-bg': tones[0],
    '--color-action-primary-solid-bg-hover': tones[2],
    '--hub-density': shown.compact ? '0.8' : '1',
    '--hub-opacity': String(shown.opacity / 100),
    '--hub-blur': `${shown.blur}px`,
  } as CSSProperties;

  function updateSettings(next: HubSettings) {
    if (!settings) return;
    const patch = Object.fromEntries((Object.keys(next) as (keyof HubSettings)[])
      .filter(key => key !== 'startWithWindows' && next[key] !== settings[key])
      .map(key => [key, next[key]]));
    store.change(patch);
  }

  return <main className={hasBackdrop ? 'flyout has-native-backdrop' : 'flyout'} aria-labelledby="panel-title" style={panelStyle}>
    <header className="panel-head"><div className="heading"><span className="n-mark" aria-hidden="true">N</span><h1 id="panel-title">Nexo</h1>
      <p>· {installedStateKnown ? `${installedCount} ${installedCount === 1 ? 'instalada' : 'instaladas'}${sampleInstalled ? ' (muestra)' : ''}` : 'instalación sin comprobar'}</p>
      <div className="head-actions">
        {usable && !firstRun && !showSettings && <IconButton label="Ajustes" title="Ajustes" variant="secondary" icon={<Icon name="settings" />} onClick={() => setShowSettings(true)} />}
        <IconButton label="Cerrar panel" title="Cerrar panel" variant="secondary" icon={<Icon name="close" />} onClick={() => void hideFlyout()} />
      </div>
    </div></header>
    {registryFailed && <div className="registry-notice" role="alert">No se pudo consultar el estado de las apps conectadas.</div>}
    {actionMessage && <div className="registry-notice" role={actionMessage.error ? 'alert' : 'status'}>{actionMessage.text}</div>}
    {registry.notice && <div className="registry-notice" role="alert"><p>{registry.notice.message}</p>
      {registry.notice.hub_only_allowed && <Button variant="neutral" size="sm" onClick={() => void (async () => {
        if (await store.flush()) await exitHubOnly();
      })().catch(error => console.error('No se pudo cerrar solo Nexo.', error))}>Salir solo de Nexo</Button>}
    </div>}
    {store.error && <div className="settings__foot" role="alert">{store.error} <Button variant="neutral" size="sm" onClick={usable ? store.retry : store.reload}>Reintentar</Button></div>}
    {store.fileState === null ? <p role="status" className="settings__foot">Cargando ajustes…</p> : !usable ? <div className="settings__foot">
      {!store.error && <p role="alert">{store.fileState === 'future' ? 'Estos ajustes pertenecen a una versión más reciente y son de solo lectura.' : 'No se pudieron leer los ajustes. El archivo original no se ha modificado.'}</p>}
      {store.fileState !== 'future' && <Button variant="neutral" size="sm" onClick={store.recover}>Recuperar ajustes con copia de seguridad</Button>}
      <Button variant="neutral" size="sm" onClick={store.reload}>Reintentar lectura</Button>
    </div> : firstRun ? <div className="area-scroll"><FirstRun onChoose={store.choose} /></div> : settings && showSettings ? <div className="area-scroll"><SettingsView settings={settings} sources={settings.sources} autostart={store.autostart} onChange={updateSettings} onClose={() => setShowSettings(false)} /></div> :
      <Tabs className="main-tabs" variant="segmented" label="Secciones de Nexo" value={active} onValueChange={value => setActive(value as Tab)} items={[
        { value: 'apps', label: 'Mis apps', content: <InstalledPanel apps={apps} connected={registry.apps} installedStateKnown={installedStateKnown} onRefresh={onAppsRefresh} onClose={onAppsRefresh ? closeApp : undefined} onOpen={onAppsRefresh ? openApp : undefined} actionBusy={actionBusy} stale={catalogState?.stale === true || (!!catalogState && catalogState.status !== 'ready' && catalogState.status !== 'empty')} selectCatalog={() => setActive('catalog')} /> },
        { value: 'catalog', label: 'Catálogo', content: <CatalogView apps={apps} state={catalogState?.status} stale={catalogState?.stale} reason={catalogState?.reason} installationKnown={installedStateKnown} onRetry={onCatalogRetry} /> },
      ]} />}
    {settings && <NewsPopup items={news} open={usable && !firstRun && newsOpen} onClose={() => setNewsOpen(false)} dontShow={!settings.showNewsOnOpen}
      onDontShowChange={dontShow => store.change({ showNewsOnOpen: !dontShow })} />}
  </main>;
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
  const projected = catalogState.catalog ? projectCatalog(catalogState.catalog, known) : { apps: [], news: [] };
  const apps = projected.apps.map(app => ({ ...app, installationState: byId.get(app.id)?.state ?? 'unknown' as const,
    installationReason: byId.get(app.id)?.reason, runningState: 'unknown' as const,
    canOpen: byId.get(app.id)?.canOpen === true, openReason: byId.get(app.id)?.openReason ?? undefined }));
  const installedStateKnown = installations !== null && apps.every(app => app.installationState !== 'unknown');
  return <FlyoutPanel {...props} apps={apps} news={projected.news} catalogState={catalogState} onCatalogRetry={retry} onAppsRefresh={refreshApps} installedStateKnown={installedStateKnown} />;
}
