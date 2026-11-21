import { useEffect, useRef, useState } from 'react';
import { AppIcon, Button, Link, Notice } from '@egdev/ui';
import { openExternal } from '../apps/external';
import { AppSocialLinks, useExternalLinks } from '../apps/details';
import type { CatalogViewProps, HubApp } from '../model';
import { formatNumber, t, type MessageKey } from '../i18n';
import { useLocale } from '../i18n/use-locale';
import { isCatalogId, type Catalog } from './format';
import type { CatalogInstalls } from './install/use-installs';
import { InstallAction } from './install/action';
import './catalog.css';

type Props = CatalogViewProps & { catalog?: Catalog; installs?: CatalogInstalls };

const AUTHOR_PROFILE = 'https://github.com/egdev6';

export function catalogBannerUrl(id: string): string | undefined {
  return isCatalogId(id) ? `https://egdev6.github.io/nexo-catalog/banners/${id}.webp` : undefined;
}

function CatalogCard({ app, focused = false, reason, installs }: { app: HubApp; focused?: boolean; reason?: MessageKey; installs?: CatalogInstalls }) {
  const locale = useLocale();
  const official = app.source === 'official';
  const banner = catalogBannerUrl(app.id);
  const [bannerFailed, setBannerFailed] = useState(false);
  const { open, failed } = useExternalLinks();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (focused) ref.current?.focus({ preventScroll: false }); }, [focused]);
  return <article ref={ref} tabIndex={focused ? -1 : undefined} className="catalog-card" aria-label={app.name}>
    <div className="catalog-art" aria-hidden="true">
      {banner && !bannerFailed ? <img src={banner} alt="" onError={() => setBannerFailed(true)} /> :
        <AppIcon size="lg" monogram={app.name.trim().charAt(0).toUpperCase()} src={app.iconUrl} />}
    </div>
    <div className="catalog-card-body">
      <h3>{app.name}</h3>
      <p>{app.tagline || app.description}</p>
      {app.version && <span className="catalog-version">{t(locale, 'catalog.version', { version: app.version })}</span>}
      {app.catalogVersion && <span className="catalog-version">{t(locale, 'catalog.publishedVersion', { version: app.catalogVersion })}</span>}
      <AppSocialLinks app={app} onClick={open} />
      {failed && <Notice tone="danger" size="sm" summary={t(locale, 'app.externalError')} />}
      <div className="catalog-actions">
        {official ? <InstallAction app={app} reason={reason} warning={app.statusKnown !== true || app.installationState === 'unknown' || !app.installationState ? 'install.unknown' : undefined} installs={installs} focused={focused} /> : app.statusKnown === false ? <span className="catalog-version">{t(locale, 'catalog.installUnavailable')}</span> :
          <Button type="button" size="sm" variant="primary" aria-label={t(locale, 'catalog.installSample', { name: app.name })} title={t(locale, 'catalog.installTitle')}>{t(locale, 'common.install')}</Button>}
      </div>
    </div>
  </article>;
}

function disabledReason(app: HubApp, state: Props['state'], stale: boolean, catalog?: Catalog, installs?: CatalogInstalls): MessageKey | undefined {
  if (app.installed || app.installationState === 'installed') return 'install.alreadyInstalled';
  if (stale || state !== 'ready') return 'install.offline';
  if (catalog?.schemaVersion !== 4) return 'install.catalogUpdateRequired';
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
    <p className="catalog-star">{t(locale, 'catalog.starPrompt')} <Link href={AUTHOR_PROFILE} onClick={event => { event.preventDefault(); void openExternal(AUTHOR_PROFILE).catch(() => undefined); }}>{t(locale, 'catalog.starLink')}</Link> ⭐</p>
    {state === 'loading' && <p role="status" className="catalog-empty">{t(locale, 'catalog.loading')}</p>}
    {failed && <Notice tone="danger" summary={`${t(locale, state === 'offline' ? 'catalog.offline' : reason === 'unconfigured' ? 'catalog.unconfigured' : 'catalog.error')} ${stale ? t(locale, 'catalog.stale') : ''}`}
      actions={onRetry && <Button type="button" size="sm" variant="neutral" onClick={onRetry}>{t(locale, 'common.retry')}</Button>} />}
    {targetAppId && !target && <Notice tone="danger" summary={t(locale, 'catalog.targetUnavailable')}
      actions={onRetry && <Button type="button" size="sm" variant="neutral" onClick={onRetry}>{t(locale, 'catalog.retryCatalog')}</Button>} />}
    {available.length > 0 ? <div className="catalog-grid">{available.map(app => <CatalogCard key={app.id} app={app} focused={app === target} reason={app.source === 'official' ? disabledReason(app, state, stale, catalog, installs) : undefined} installs={installs} />)}</div> :
      !failed && state !== 'loading' && <p className="catalog-empty">{t(locale, 'catalog.empty')}</p>}
    {available.some(app => app.source !== 'official') && <p className="catalog-foot">{t(locale, 'catalog.sampleFoot')}</p>}
  </section>;
}
