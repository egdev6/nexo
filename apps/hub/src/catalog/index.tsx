import { useEffect, useRef } from 'react';
import { Badge, Button, Icon, IconButton } from '@egdev/ui';
import type { CatalogViewProps, HubApp } from '../model';
import { formatNumber, t, type MessageKey } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import type { Catalog } from './format';
import type { CatalogInstalls } from './install/use-installs';
import { InstallAction } from './install/action';
import './catalog.css';

type Props = CatalogViewProps & { catalog?: Catalog; installs?: CatalogInstalls };

function CatalogCard({ app, focused = false, reason, installs }: { app: HubApp; focused?: boolean; reason?: MessageKey; installs?: CatalogInstalls }) {
  const locale = useLocale();
  const official = app.source === 'official';
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focused) ref.current?.focus({ preventScroll: false }); }, [focused]);
  return <article ref={ref} tabIndex={focused ? -1 : undefined} className="catalog-card" aria-label={app.name}>
    <div className="catalog-art" aria-hidden="true">
      {app.artUrl || app.iconUrl ? <img src={app.artUrl || app.iconUrl} alt="" /> :
        <div className="catalog-art-window"><span>{app.name.trim().charAt(0).toUpperCase()}</span><i /><i /><i /></div>}
    </div>
    <div className="catalog-card-body">
      {app.tags && app.tags.length > 0 && <div className="catalog-tags">{app.tags.map((tag, index) => <Badge tone="brand" key={`${tag}-${index}`}>{tag}</Badge>)}</div>}
      <h3>{app.name}</h3>
      <p>{app.tagline || app.description}</p>
      {app.version && <span className="catalog-version">{t(locale, 'catalog.version', { version: app.version })}</span>}
      {app.catalogVersion && <span className="catalog-version">{t(locale, 'catalog.publishedVersion', { version: app.catalogVersion })}</span>}
      <div className="catalog-actions">
        {official ? <InstallAction app={app} reason={reason} installs={installs} focused={focused} /> : app.statusKnown === false ? <span className="catalog-version">{t(locale, 'catalog.installUnavailable')}</span> :
          <Button type="button" size="sm" variant="primary" aria-label={t(locale, 'catalog.installSample', { name: app.name })} title={t(locale, 'catalog.installTitle')}>{t(locale, 'common.install')}</Button>}
        {app.links?.github && (official ? <a className="catalog-link" href={app.links.github} target="_blank" rel="noopener noreferrer" aria-label={t(locale, 'catalog.github', { name: app.name })}><Icon name="github" /></a> :
          <IconButton type="button" size="sm" variant="secondary" icon={<Icon name="github" />} label={t(locale, 'catalog.githubSample', { name: app.name })} title={t(locale, 'catalog.githubTitle')} />)}
        {app.links?.youtube && (official ? <a className="catalog-link" href={app.links.youtube} target="_blank" rel="noopener noreferrer" aria-label={t(locale, 'catalog.youtube', { name: app.name })}><Icon name="youtube" /></a> :
          <IconButton type="button" size="sm" variant="secondary" icon={<Icon name="youtube" />} label={t(locale, 'catalog.youtubeSample', { name: app.name })} title={t(locale, 'catalog.youtubeTitle')} />)}
      </div>
    </div>
  </article>;
}

function disabledReason(app: HubApp, state: Props['state'], stale: boolean, catalog?: Catalog, installs?: CatalogInstalls): MessageKey | undefined {
  if (app.statusKnown !== true || app.installationState === 'unknown' || !app.installationState) return 'install.unknown';
  if (app.installed || app.installationState === 'installed') return 'install.alreadyInstalled';
  if (stale || state !== 'ready') return 'install.offline';
  if (catalog?.schemaVersion !== 3) return 'install.v3Required';
  if (!catalog.apps.find(item => item.id === app.id)?.updaterPublicKey) return 'install.noKey';
  if (!installs || installs.connection !== 'ready') return 'install.progressUnavailable';
  return undefined;
}

export function CatalogView({ apps, state = 'ready', stale = false, reason, installationKnown = true, onRetry, targetAppId, catalog, installs }: Props) {
  const locale = useLocale();
  const target = targetAppId ? apps.find(app => app.id === targetAppId && app.source === 'official') : undefined;
  const available = apps.filter(app => {
    const current = app.source === 'official' ? installs?.entries.get(app.id) : undefined;
    const entry = current?.operation === 'install' ? current : undefined;
    return entry?.status !== 'installed' && (entry?.status === 'running' || (entry?.status === 'error' && (entry.cleanupFailed || entry.error.status === 'cleanupFailed')) || app === target || (app.integration === 'catalog' && (!app.installed || app.statusKnown === false)));
  });
  const failed = state === 'offline' || state === 'error';
  const unknown = available.some(app => app.statusKnown === false);
  return <section className="catalog-view" aria-label={t(locale, 'common.catalog')}>
    <div className="catalog-heading"><h2>{t(locale, 'common.officialCatalog')}</h2>{state !== 'loading' && (!failed || available.length > 0) && <span>{t(locale, unknown || !installationKnown ? 'catalog.countCatalog' : 'catalog.countUninstalled', { count: formatNumber(locale, available.length) })}</span>}</div>
    {state === 'loading' && <p role="status" className="catalog-empty">{t(locale, 'catalog.loading')}</p>}
    {failed && <div role="alert" className="catalog-notice">
      <p>{t(locale, state === 'offline' ? 'catalog.offline' : reason === 'unconfigured' ? 'catalog.unconfigured' : 'catalog.error')} {stale && t(locale, 'catalog.stale')}</p>
      {onRetry && <Button type="button" size="sm" variant="neutral" onClick={onRetry}>{t(locale, 'common.retry')}</Button>}
    </div>}
    {targetAppId && !target && <div role="alert" className="catalog-notice"><p>{t(locale, 'catalog.targetUnavailable')}</p>
      {onRetry && <Button type="button" size="sm" variant="neutral" onClick={onRetry}>{t(locale, 'catalog.retryCatalog')}</Button>}</div>}
    {available.length > 0 ? <div className="catalog-grid">{available.map(app => <CatalogCard key={app.id} app={app} focused={app === target} reason={app.source === 'official' ? disabledReason(app, state, stale, catalog, installs) : undefined} installs={installs} />)}</div> :
      !failed && state !== 'loading' && <p className="catalog-empty">{t(locale, 'catalog.empty')}</p>}
    {available.some(app => app.source !== 'official') && <p className="catalog-foot">{t(locale, 'catalog.sampleFoot')}</p>}
  </section>;
}
