import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { sampleApps } from './sample';
import type { HubApp } from './sample';
import { backdropAvailable, hideFlyout, resizeFlyout } from './window';
import './style.css';

type Tab = 'apps' | 'catalog' | 'news';
const tabs: { id: Tab; label: string }[] = [
  { id: 'apps', label: 'Mis apps' },
  { id: 'catalog', label: 'Catálogo' },
  { id: 'news', label: 'Novedades' },
];

// TODO #4/#5: connect these illustrative controls to real hub and catalog operations.
function sampleAction() {}

function Action({ label, app, primary = false }: { label: string; app: HubApp; primary?: boolean }) {
  return (
    <button className={primary ? 'action primary' : 'action'} type="button" aria-label={`${label} ${app.name}`} onClick={sampleAction}>
      {label}
    </button>
  );
}

function AppIcon({ app }: { app: HubApp }) {
  return <span aria-hidden="true" className={`app-icon ${app.id === 'antena' ? 'brand-icon' : ''}`}>{app.name[0]}</span>;
}

function StatusBadge({ app }: { app: HubApp }) {
  if (!app.installed) return <span className="secondary">No instalada · Catálogo oficial</span>;
  if (app.integration === 'local') return <span className="secondary">App local · Solo apertura</span>;
  if (!app.running) return <span className="secondary">Al día · No está abierta · Actualizaciones</span>;
  return (
    <span className="status-line">
      <span className="status-running"><span className="dot" aria-hidden="true" />En ejecución</span>
      {app.update && <> · <span className="status-warning">Actualización disponible</span></>}
    </span>
  );
}

function AppRow({ app }: { app: HubApp }) {
  const [expanded, setExpanded] = useState(app.id === 'antena');
  const detailId = `detail-${app.id}`;
  return (
    <article className="app-card">
      <div className="app-row">
        <button className="row-toggle" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>
          <AppIcon app={app} />
          <span className="app-info"><strong>{app.name}</strong>{' '}<StatusBadge app={app} /></span>
          <span className="chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
        {app.id !== 'antena' && <Action label={app.installed ? 'Abrir' : 'Instalar'} app={app} />}
      </div>
      <div id={detailId} className="detail" hidden={!expanded}>
        {expanded && <>
          {app.update && <div className="detail-grid">
            <div><div className="status-warning">Disponible: {app.update}</div><div className="version">Instalada: {app.version}</div></div>
            <Action label="Actualizar" app={app} primary />
          </div>}
          <p className="meta">{app.description}</p>
          <div className="actions">
            {app.installed ? <>
              <Action label={app.id === 'antena' ? 'Abrir panel' : 'Abrir'} app={app} />
              {app.running && app.integration === 'complete' && <Action label="Cerrar" app={app} />}
            </> : <Action label="Instalar" app={app} />}
          </div>
        </>}
      </div>
    </article>
  );
}

function Tabs({ active, select }: { active: Tab; select: (tab: Tab) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    select(tabs[next].id);
    refs.current[next]?.focus();
  }
  return <div className="tabs" role="tablist" aria-label="Secciones de Nexo">
    {tabs.map((tab, index) => <button key={tab.id} ref={node => { refs.current[index] = node; }}
      className="tab" type="button" role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.id}`}
      aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1}
      onClick={() => select(tab.id)} onKeyDown={event => navigate(event, index)}>{tab.label}</button>)}
  </div>;
}

function SectionLabel({ title, count }: { title: string; count: string }) {
  return <div className="section-label"><h2>{title}</h2><span>{count}</span></div>;
}

function InstalledPanel({ apps, select }: { apps: HubApp[]; select: (tab: Tab) => void }) {
  const installed = apps.filter(app => app.installed);
  const available = apps.filter(app => !app.installed);
  return <>
    <SectionLabel title="Instaladas" count={`${installed.length} ${installed.length === 1 ? 'aplicación' : 'aplicaciones'}`} />
    {installed.length ? installed.map(app => <AppRow key={app.id} app={app} />) : <div className="empty-state"><p>No hay aplicaciones instaladas.</p><button className="action" type="button" onClick={() => select('catalog')}>Ver catálogo</button></div>}
    {available.length > 0 && <section className="catalog-preview" aria-labelledby="preview-title">
      <div className="section-label"><h2 id="preview-title">También en el catálogo</h2><span>Sin instalar</span></div>
      {available.map(app => <div className="preview-row" key={app.id}><div className="app-info"><strong>{app.name}</strong><span className="secondary">Catálogo egdev</span></div><Action label="Instalar" app={app} /></div>)}
    </section>}
    {apps.some(app => app.id === 'pizarra' && app.news) && <p className="news-line"><span className="tag">Nuevo</span> Pizarra en Novedades</p>}
  </>;
}

function CatalogPanel({ apps }: { apps: HubApp[] }) {
  const available = apps.filter(app => !app.installed);
  return <><SectionLabel title="Catálogo egdev" count={`${available.length} sin instalar`} />
    {available.length ? available.map(app => <AppRow key={app.id} app={app} />) : <p className="empty-state">No hay aplicaciones en el catálogo.</p>}
  </>;
}

function NewsPanel({ apps }: { apps: HubApp[] }) {
  const news = apps.filter(app => app.news);
  return <><SectionLabel title="Novedades del catálogo" count="egdev" />
    {news.length ? news.map(app => <article className="app-card news-row" key={app.id}>
      <span className="tag">{app.news}</span><div className="app-info"><strong>{app.name}</strong><span className="secondary">{app.description}</span></div><Action label="Instalar" app={app} />
    </article>) : <p className="empty-state">No hay novedades por ahora.</p>}
  </>;
}

export function FlyoutPanel({ apps = sampleApps }: { apps?: HubApp[] }) {
  const [active, setActive] = useState<Tab>('apps');
  const [hasBackdrop, setHasBackdrop] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const installedCount = apps.filter(app => app.installed).length;

  useEffect(() => {
    let mounted = true;
    void backdropAvailable().then(available => { if (mounted) setHasBackdrop(available); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); void hideFlyout(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const content = contentRef.current;
    if (!header || !content || typeof ResizeObserver === 'undefined') return;
    const resize = () => { void resizeFlyout(Math.ceil(header.offsetHeight + content.offsetHeight + 2)); };
    const observer = new ResizeObserver(resize);
    observer.observe(header);
    observer.observe(content);
    resize();
    return () => observer.disconnect();
  }, [active, apps]);

  return <main className={hasBackdrop ? 'flyout has-native-backdrop' : 'flyout'} aria-labelledby="panel-title">
    <header className="panel-head" ref={headerRef}>
      <div className="heading"><span className="n-mark" aria-hidden="true">N</span><h1 id="panel-title">Nexo</h1>
        <p>· {installedCount} {installedCount === 1 ? 'instalada' : 'instaladas'}</p>
        <div className="head-actions"><button className="icon-button" type="button" aria-label="Ajustes (muestra)" title="Ajustes" onClick={sampleAction}>⚙</button>
          <button className="icon-button" type="button" aria-label="Cerrar panel" title="Cerrar panel" onClick={() => void hideFlyout()}>×</button></div>
      </div>
      <Tabs active={active} select={setActive} />
    </header>
    <div className="scroll" tabIndex={0} aria-label="Contenido de Nexo"><div className="scroll-content" ref={contentRef}>
      {tabs.map(tab => <section key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={active !== tab.id}>
        {active === tab.id && (tab.id === 'apps' ? <InstalledPanel apps={apps} select={setActive} /> : tab.id === 'catalog' ? <CatalogPanel apps={apps} /> : <NewsPanel apps={apps} />)}
      </section>)}
      <p className="foot">Muestra de diseño · las acciones de apps y ajustes son ilustrativas.</p>
    </div></div>
  </main>;
}

export default function App({ apps }: { apps?: HubApp[] }) {
  return <FlyoutPanel apps={apps} />;
}
