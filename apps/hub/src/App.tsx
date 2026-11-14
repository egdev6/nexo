import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Icon, IconButton, StatusDot, Tabs } from '@egdev/ui';
import { CatalogView } from './catalog';
import { FirstRun } from './first-run';
import type { HubApp, HubSettings, NewsItem } from './model';
import { NewsPopup } from './news';
import { defaultSettings, sampleApps, sampleNews } from './sample';
import { SettingsView } from './settings';
import { backdropAvailable, hideFlyout } from './window';
import './style.css';

type Tab = 'apps' | 'catalog';

// TODO #4/#5: these controls illustrate actions; they do not change installed apps.
function sampleAction() {}

function Action({ label, app, primary = false }: { label: string; app: HubApp; primary?: boolean }) {
  return <Button variant={primary ? 'primary' : 'neutral'} size="sm" type="button" aria-label={`${label} ${app.name}`} onClick={sampleAction}>{label}</Button>;
}

function AppIcon({ app }: { app: HubApp }) {
  return <span aria-hidden="true" className={`app-icon ${app.id === 'antena' ? 'brand-icon' : ''}`}>{app.name[0]}</span>;
}

function Status({ app }: { app: HubApp }) {
  if (app.integration === 'local') return <span className="secondary">App local · Solo apertura</span>;
  if (!app.running) return <span className="secondary">Al día · No está abierta · Actualizaciones</span>;
  return <span className="status-line"><span className="status-running"><StatusDot state="running" /> En ejecución</span>
    {app.update && <> · <span className="status-warning">Actualización disponible</span></>}
  </span>;
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
        {app.running && app.integration === 'complete' && <Action label="Cerrar" app={app} />}
      </div>
    </CollapsibleContent>
  </Collapsible>;
}

function InstalledPanel({ apps, selectCatalog }: { apps: HubApp[]; selectCatalog: () => void }) {
  const installed = apps.filter(app => app.installed);
  const available = apps.filter(app => !app.installed);
  return <>
    <div className="section-label"><h2>Instaladas</h2><span>{installed.length} {installed.length === 1 ? 'aplicación' : 'aplicaciones'}</span></div>
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
  const installedCount = apps.filter(app => app.installed).length;

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
      <p>· {installedCount} {installedCount === 1 ? 'instalada' : 'instaladas'}</p>
      <div className="head-actions">
        {!firstRun && !showSettings && <IconButton label="Ajustes" title="Ajustes" variant="secondary" icon={<Icon name="settings" />} onClick={() => setShowSettings(true)} />}
        <IconButton label="Cerrar panel" title="Cerrar panel" variant="secondary" icon={<Icon name="close" />} onClick={() => void hideFlyout()} />
      </div>
    </div></header>
    {firstRun ? <div className="area-scroll"><FirstRun onChoose={language => {
      setSettings(current => ({ ...current, language }));
      setFirstRun(false);
      setNewsOpen(settings.showNewsOnOpen && news.length > 0);
    }} /></div> : showSettings ? <div className="area-scroll"><SettingsView settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} /></div> :
      <Tabs className="main-tabs" variant="segmented" label="Secciones de Nexo" value={active} onValueChange={value => setActive(value as Tab)} items={[
        { value: 'apps', label: 'Mis apps', content: <InstalledPanel apps={apps} selectCatalog={() => setActive('catalog')} /> },
        { value: 'catalog', label: 'Catálogo', content: <CatalogView apps={apps} /> },
      ]} />}
    <NewsPopup items={news} open={!firstRun && newsOpen} onClose={() => setNewsOpen(false)} dontShow={!settings.showNewsOnOpen}
      onDontShowChange={dontShow => setSettings(current => ({ ...current, showNewsOnOpen: !dontShow }))} />
  </main>;
}

export default function App(props: FlyoutProps) {
  return <FlyoutPanel {...props} />;
}
