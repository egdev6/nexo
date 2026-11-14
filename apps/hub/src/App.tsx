import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, IconButton, Tabs } from '@egdev/ui';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { CatalogView } from './catalog';
import { diskCache, loadCatalog, OFFICIAL_CATALOG_URL, webFetcher, type CatalogState } from './catalog/loader';
import { projectCatalog } from './catalog/mapping';
import { FirstRun } from './first-run';
import type { HubApp, HubSettings, NewsItem } from './model';
import { NewsPopup } from './news';
import { selectOfficialNews } from './news/selection';
import { useFlyoutVisibility } from './news/use-flyout';
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

function AppIcon({ app }: { app: HubApp }) {
  return <span aria-hidden="true" className={`app-icon ${app.id === 'antena' ? 'brand-icon' : ''}`}>{app.name[0]}</span>;
}

function Status({ app }: { app: HubApp }) {
  if (app.integration === 'local') return <span className="secondary">{app.source === 'official' ? 'Catálogo egdev · Solo apertura' : 'App local · Estado desconocido'}</span>;
  return <span className="secondary">Estado desconocido{app.update && <> · <span className="status-warning">Actualización disponible (muestra)</span></>}</span>;
}

function ConnectedRow({ app }: { app: RegistryApp }) {
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
      {app.menu.length > 0 && <><p className="meta">Menú comunicado por la app</p><ul className="registry-menu">
        {app.menu.map((item, index) => <li key={`${item.id}-${index}`}>{item.label}{!item.enabled && ' · desactivada'}{item.checked === true && ' · marcada'}{item.checked === false && ' · desmarcada'}</li>)}
      </ul></>}
    </CollapsibleContent>
  </Collapsible>;
}

function AppRow({ app }: { app: HubApp }) {
  return <Collapsible className="app-card" defaultOpen={app.id === 'antena'}>
    <div className="app-row">
      <CollapsibleTrigger>
        <span className="row-label"><AppIcon app={app} /><span className="app-info"><strong>{app.name}</strong><Status app={app} /></span></span>
      </CollapsibleTrigger>
      {app.id !== 'antena' && <Action label="Abrir" app={app} />}
    </div>
    <CollapsibleContent>
      {app.update && <div className="detail-grid">
        <div><div className="status-warning">Disponible: {app.update}</div><div className="version">Instalada: {app.version}</div></div>
        <Action label="Actualizar" app={app} primary />
      </div>}
      <p className="meta">{app.description}</p>
      <div className="actions">
        <Action label={app.id === 'antena' ? 'Abrir panel' : 'Abrir'} app={app} />

      </div>
    </CollapsibleContent>
  </Collapsible>;
}

function InstalledPanel({ apps, connected, selectCatalog, installedStateKnown }: { apps: HubApp[]; connected: RegistryApp[]; selectCatalog: () => void; installedStateKnown: boolean }) {
  const ids = new Set(connected.map(entry => entry.app.id));
  const installed = apps.filter(app => app.statusKnown !== false && app.installed && !ids.has(app.id));
  const available = apps.filter(app => app.statusKnown !== false && !app.installed && !ids.has(app.id));
  return <>
    {connected.length > 0 && <section aria-labelledby="connected-title"><div className="section-label"><h2 id="connected-title">Conectadas</h2><span>{connected.length}</span></div>
      {connected.map(app => <ConnectedRow key={app.app.id} app={app} />)}
    </section>}
    <div className="section-label"><h2>Instaladas</h2>{installedStateKnown && <span>{installed.length} {installed.length === 1 ? 'aplicación' : 'aplicaciones'}{installed.some(app => app.source !== 'official') && ' · muestra'}</span>}</div>
    {installed.length ? installed.map(app => <AppRow key={app.id} app={app} />) : <div className="empty-state"><p>{installedStateKnown ? 'No hay aplicaciones instaladas.' : 'Estado de instalación no disponible todavía.'}</p><Button variant="neutral" size="sm" onClick={selectCatalog}>Ver catálogo</Button></div>}
    {available.length > 0 && <section className="catalog-preview" aria-labelledby="preview-title">
      <div className="section-label"><h2 id="preview-title">También en el catálogo</h2><span>Sin instalar</span></div>
      {available.map(app => <div className="preview-row" key={app.id}><div className="app-info"><strong>{app.name}</strong><span className="secondary">Catálogo egdev</span></div><Action label="Instalar" app={app} /></div>)}
    </section>}
    {available.some(app => app.id === 'pizarra') && <p className="news-line"><Badge tone="brand">Nuevo</Badge> Pizarra en Novedades</p>}
    <p className="foot">{installedStateKnown ? 'Muestra de diseño · las acciones de apps son ilustrativas.' : 'La gestión de aplicaciones aún no está disponible.'}</p>
  </>;
}

interface FlyoutProps {
  apps?: HubApp[];
  news?: NewsItem[];
  catalogState?: CatalogState;
  onCatalogRetry?: () => void;
  installedStateKnown?: boolean;
  validNewsKeys?: ReadonlySet<string>;
}

export function FlyoutPanel({ apps = sampleApps, news = sampleNews, catalogState, onCatalogRetry, installedStateKnown = true, validNewsKeys }: FlyoutProps) {
  const [active, setActive] = useState<Tab>('apps');
  const store = useSettings();
  const settings = store.settings;
  const shown = settings ?? defaultSettings;
  const firstRun = !settings?.firstRunComplete;
  const usable = store.fileState === 'ready' || store.fileState === 'missing';
  const { visibility, lastShow, error: visibilityError } = useFlyoutVisibility(finishNews);
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
        <IconButton label="Cerrar panel" title="Cerrar panel" variant="secondary" icon={<Icon name="close" />} onClick={hidePanel} />
      </div>
    </div></header>
    {visibilityError && <div className="registry-notice" role="alert">{visibilityError}</div>}
    {registryFailed && <div className="registry-notice" role="alert">No se pudo consultar el estado de las apps conectadas.</div>}
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
        { value: 'apps', label: 'Mis apps', content: <InstalledPanel apps={apps} connected={registry.apps} installedStateKnown={installedStateKnown} selectCatalog={() => setActive('catalog')} /> },
        { value: 'catalog', label: 'Catálogo', content: <CatalogView apps={apps} state={catalogState?.status} stale={catalogState?.stale} reason={catalogState?.reason} installationKnown={installedStateKnown} onRetry={onCatalogRetry} targetAppId={targetAppId} /> },
      ]} />}
    {settings && <NewsPopup items={snapshot?.items ?? []} open={usable && !firstRun && !!snapshot} onClose={finishNews} dontShow={!settings.showNewsOnOpen}
      stale={snapshot?.stale} onShown={item => viewed.current.add(item.id)}
      onCatalog={appId => { finishNews(); setShowSettings(false); setTargetAppId(appId); setActive('catalog'); }}
      onDontShowChange={dontShow => store.change({ showNewsOnOpen: !dontShow })} />}
  </main>;
}

export default function App(props: FlyoutProps) {
  const native = isTauri();
  const liveCatalog = native && props.apps === undefined;
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'loading' });
  const requestId = useRef(0);

  function retry() {
    const id = ++requestId.current;
    setCatalogState(current => ({ ...current, status: 'loading' }));
    void loadCatalog(OFFICIAL_CATALOG_URL, diskCache, webFetcher).then(result => {
      if (id === requestId.current) setCatalogState(result);
    });
  }
  useEffect(() => {
    if (liveCatalog) retry();
    return () => { requestId.current++; };
  }, [liveCatalog]);

  if (!liveCatalog) return <FlyoutPanel {...props} news={props.news ?? (native ? [] : sampleNews)} />;
  const catalog = catalogState.catalog;
  const projected = catalog ? projectCatalog(catalog) : { apps: [] };
  const selection = catalog ? selectOfficialNews(catalog) : { items: [], validKeys: undefined };
  return <FlyoutPanel {...props} apps={projected.apps} news={selection.items} validNewsKeys={selection.validKeys} catalogState={catalogState} onCatalogRetry={retry} installedStateKnown={false} />;
}
