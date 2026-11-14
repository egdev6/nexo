import { Badge, Button, Icon, IconButton } from '@egdev/ui';
import type { CatalogViewProps, HubApp } from '../model';
import './catalog.css';

// TODO #5: replace illustrative actions and provide catalog offline/error states from real data.
function CatalogCard({ app }: { app: HubApp }) {
  return <article className="catalog-card" aria-label={app.name}>
    <div className="catalog-art" aria-hidden="true">
      <div className="catalog-art-window"><span>{app.name.trim().charAt(0).toUpperCase()}</span><i /><i /><i /></div>
    </div>
    <div className="catalog-card-body">
      {app.tags && app.tags.length > 0 && <div className="catalog-tags">{app.tags.map(tag => <Badge tone="brand" key={tag}>{tag}</Badge>)}</div>}
      <h3>{app.name}</h3>
      <p>{app.tagline || app.description}</p>
      {app.version && <span className="catalog-version">Versión: {app.version}</span>}
      <div className="catalog-actions">
        <Button type="button" size="sm" variant="primary" aria-label={`Instalar ${app.name} · muestra`} title="Instalación ilustrativa">Instalar</Button>
        {app.links?.github && <IconButton type="button" size="sm" variant="secondary" icon={<Icon name="github" />}
          label={`Código en GitHub de ${app.name} · muestra`} title="Código en GitHub · muestra" />}
        {app.links?.youtube && <IconButton type="button" size="sm" variant="secondary" icon={<Icon name="youtube" />}
          label={`Ver en YouTube: ${app.name} · muestra`} title="Ver en YouTube · muestra" />}
      </div>
    </div>
  </article>;
}

export function CatalogView({ apps }: CatalogViewProps) {
  const available = apps.filter(app => app.integration === 'catalog' && !app.installed);
  return <section className="catalog-view" aria-label="Catálogo">
    <div className="catalog-heading"><h2>Catálogo egdev</h2><span>{available.length} sin instalar</span></div>
    {available.length > 0 ? <div className="catalog-grid">{available.map(app => <CatalogCard key={app.id} app={app} />)}</div> :
      <p className="catalog-empty">No hay aplicaciones disponibles en el catálogo.</p>}
    <p className="catalog-foot">Muestra de diseño · acciones ilustrativas y enlaces de muestra.</p>
  </section>;
}
