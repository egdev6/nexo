import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, IconButton, Tabs } from '@egdev/ui';
import { CatalogView } from './catalog';
import { FirstRun } from './first-run';
import type { HubApp, HubSettings, NewsItem } from './model';
import { NewsPopup } from './news';
import { defaultSettings, sampleApps, sampleNews } from './sample';
import { SettingsView } from './settings';
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
  if (app.integration === 'local') return <span className="secondary">App local · Estado desconocido</span>;
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

function InstalledPanel({ apps, connected, selectCatalog }: { apps: HubApp[]; connected: RegistryApp[]; selectCatalog: () => void }) {
  const ids = new Set(connected.map(entry => entry.app.id));
  const installed = apps.filter(app => app.installed && !ids.has(app.id));
  const available = apps.filter(app => !app.installed && !ids.has(app.id));
  return <>
    {connected.length > 0 && <section aria-labelledby="connected-title"><div className="section-label"><h2 id="connected-title">Conectadas</h2><span>{connected.length}</span></div>
      {connected.map(app => <ConnectedRow key={app.app.id} app={app} />)}
    </section>}
    <div className="section-label"><h2>Instaladas</h2><span>{installed.length} {installed.length === 1 ? 'aplicación' : 'aplicaciones'} · muestra</span></div>
    {installed.length ? installed.map(app => <AppRow key={app.id} app={app} />) : <div className="empty-state"><p>No hay aplicaciones instaladas.</p><Button variant="neutral" size="sm" onClick={selectCatalog}>Ver catálogo</Button></div>}
    {available.length > 0 && <section className="catalog-preview" aria-labelledby="preview-title">
      <div className="section-label"><h2 id="preview-title">También en el catálogo</h2><span>Sin instalar</span></div>
      {available.map(app => <div className="preview-row" key={app.id}><div className="app-info"><strong>{app.name}</strong><span className="secondary">Catálogo egdev</span></div><Action label="Instalar" app={app} /></div>)}
    </section>}
    {available.some(app => app.id === 'pizarra') && <p className="news-line"><Badge tone="brand">Nuevo</Badge> Pizarra en Novedades</p>}
    <p className="foot">Muestra de diseño · las acciones de apps son ilustrativas.</p>
  </>;
}

interface FlyoutProps {
  apps?: HubApp[];
  news?: NewsItem[];
}

export function FlyoutPanel({ apps = sampleApps, news = sampleNews }: FlyoutProps) {
  const [active, setActive] = useState<Tab>('apps');
  const [settings, setSettings] = useState<HubSettings>(defaultSettings);
  const [firstRun, setFirstRun] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [hasBackdrop, setHasBackdrop] = useState(false);
  const [registry, setRegistry] = useState<RegistrySnapshot>({ revision: 0, apps: [] });
  const [registryFailed, setRegistryFailed] = useState(false);
  const installedCount = apps.filter(app => app.installed).length;

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

  // A tray reopen focuses the same webview rather than remounting the React tree.
  useEffect(() => {
    function onFocus() {
      if (!firstRun && settings.showNewsOnOpen && news.length > 0) setNewsOpen(true);
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [firstRun, settings.showNewsOnOpen, news.length]);

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

  const panelStyle = {
    '--hub-accent': settings.accent,
    '--hub-density': settings.compact ? '0.8' : '1',
    '--hub-opacity': String(settings.opacity / 100),
    '--hub-blur': `${settings.blur}px`,
  } as CSSProperties;

  return <main className={hasBackdrop ? 'flyout has-native-backdrop' : 'flyout'} aria-labelledby="panel-title" style={panelStyle}>
    <header className="panel-head"><div className="heading"><span className="n-mark" aria-hidden="true">N</span><h1 id="panel-title">Nexo</h1>
      <p>· {installedCount} {installedCount === 1 ? 'instalada' : 'instaladas'} (muestra)</p>
      <div className="head-actions">
        {!firstRun && !showSettings && <IconButton label="Ajustes" title="Ajustes" variant="secondary" icon={<Icon name="settings" />} onClick={() => setShowSettings(true)} />}
        <IconButton label="Cerrar panel" title="Cerrar panel" variant="secondary" icon={<Icon name="close" />} onClick={() => void hideFlyout()} />
      </div>
    </div></header>
    {registryFailed && <div className="registry-notice" role="alert">No se pudo consultar el estado de las apps conectadas.</div>}
    {registry.notice && <div className="registry-notice" role="alert"><p>{registry.notice.message}</p>
      {registry.notice.hub_only_allowed && <Button variant="neutral" size="sm" onClick={() => void exitHubOnly().catch(error => console.error('No se pudo cerrar solo Nexo.', error))}>Salir solo de Nexo</Button>}
    </div>}
    {firstRun ? <div className="area-scroll"><FirstRun onChoose={language => {
      setSettings(current => ({ ...current, language }));
      setFirstRun(false);
      setNewsOpen(settings.showNewsOnOpen && news.length > 0);
    }} /></div> : showSettings ? <div className="area-scroll"><SettingsView settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} /></div> :
      <Tabs className="main-tabs" variant="segmented" label="Secciones de Nexo" value={active} onValueChange={value => setActive(value as Tab)} items={[
        { value: 'apps', label: 'Mis apps', content: <InstalledPanel apps={apps} connected={registry.apps} selectCatalog={() => setActive('catalog')} /> },
        { value: 'catalog', label: 'Catálogo', content: <CatalogView apps={apps} /> },
      ]} />}
    <NewsPopup items={news} open={!firstRun && newsOpen} onClose={() => setNewsOpen(false)} dontShow={!settings.showNewsOnOpen}
      onDontShowChange={dontShow => setSettings(current => ({ ...current, showNewsOnOpen: !dontShow }))} />
  </main>;
}

export default function App(props: FlyoutProps) {
  return <FlyoutPanel {...props} />;
}
