import { Badge, Button, Icon, IconButton } from '@egdev/ui';
import type { CatalogViewProps, HubApp } from '../model';
import './catalog.css';

function CatalogCard({ app }: { app: HubApp }) {
  const official = app.source === 'official';
  return <article className="catalog-card" aria-label={app.name}>
    <div className="catalog-art" aria-hidden="true">
      {app.artUrl || app.iconUrl ? <img src={app.artUrl || app.iconUrl} alt="" /> :
        <div className="catalog-art-window"><span>{app.name.trim().charAt(0).toUpperCase()}</span><i /><i /><i /></div>}
    </div>
    <div className="catalog-card-body">
      {app.tags && app.tags.length > 0 && <div className="catalog-tags">{app.tags.map((tag, index) => <Badge tone="brand" key={`${tag}-${index}`}>{tag}</Badge>)}</div>}
      <h3>{app.name}</h3>
      <p>{app.tagline || app.description}</p>
      {app.version && <span className="catalog-version">Versión: {app.version}</span>}
      {app.catalogVersion && <span className="catalog-version">Versión publicada: {app.catalogVersion}</span>}
      <div className="catalog-actions">
        {official || app.statusKnown === false ? <span className="catalog-version">Instalación aún no disponible</span> :
          <Button type="button" size="sm" variant="primary" aria-label={`Instalar ${app.name} · muestra`} title="Instalación ilustrativa">Instalar</Button>}
        {app.links?.github && (official ? <a className="catalog-link" href={app.links.github} target="_blank" rel="noopener noreferrer" aria-label={`Código en GitHub de ${app.name}`}><Icon name="github" /></a> :
          <IconButton type="button" size="sm" variant="secondary" icon={<Icon name="github" />} label={`Código en GitHub de ${app.name} · muestra`} title="Código en GitHub · muestra" />)}
        {app.links?.youtube && (official ? <a className="catalog-link" href={app.links.youtube} target="_blank" rel="noopener noreferrer" aria-label={`Ver en YouTube: ${app.name}`}><Icon name="youtube" /></a> :
          <IconButton type="button" size="sm" variant="secondary" icon={<Icon name="youtube" />} label={`Ver en YouTube: ${app.name} · muestra`} title="Ver en YouTube · muestra" />)}
      </div>
    </div>
  </article>;
}

export function CatalogView({ apps, state = 'ready', stale = false, reason, installationKnown = true, onRetry }: CatalogViewProps) {
  const available = apps.filter(app => app.integration === 'catalog' && (!app.installed || app.statusKnown === false));
  const failed = state === 'offline' || state === 'error';
  const unknown = available.some(app => app.statusKnown === false);
  return <section className="catalog-view" aria-label="Catálogo">
    <div className="catalog-heading"><h2>Catálogo egdev</h2>{state !== 'loading' && (!failed || available.length > 0) && <span>{available.length} {unknown || !installationKnown ? 'en el catálogo' : 'sin instalar'}</span>}</div>
    {state === 'loading' && <p role="status" className="catalog-empty">Cargando catálogo…</p>}
    {failed && <div role="alert" className="catalog-notice">
      <p>{state === 'offline' ? 'Sin conexión con el catálogo o el servidor rechazó la solicitud.' : reason === 'unconfigured' ? 'La fuente oficial del catálogo aún no está configurada.' : 'Error al cargar o guardar el catálogo.'} {stale && 'Se muestra la copia guardada, que puede estar desactualizada.'}</p>
      {onRetry && <Button type="button" size="sm" variant="neutral" onClick={onRetry}>Reintentar</Button>}
    </div>}
    {available.length > 0 ? <div className="catalog-grid">{available.map(app => <CatalogCard key={app.id} app={app} />)}</div> :
      !failed && state !== 'loading' && <p className="catalog-empty">No hay aplicaciones disponibles en el catálogo.</p>}
    {available.some(app => app.source !== 'official') && <p className="catalog-foot">Muestra de diseño · acciones ilustrativas y enlaces de muestra.</p>}
  </section>;
}
