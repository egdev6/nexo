import type { HubApp, NewsItem } from '../model';
import type { Catalog } from './format';
import { t } from '../i18n';

/** Installation observations must come from the app-management owner, not catalog metadata. */
export interface OfficialInstallation {
  installed: boolean;
  running: boolean;
  version?: string;
  update?: string;
}

/** Call only with a validated official catalog; callers explicitly associate any observations by ID. */
export function projectCatalog(catalog: Catalog, installations: Readonly<Record<string, OfficialInstallation>> = {}): { apps: HubApp[]; news: NewsItem[] } {
  const integrations = { full: 'complete', update: 'updates', launch: 'local' } as const;
  const apps: HubApp[] = catalog.apps.map(app => {
    const observed = Object.hasOwn(installations, app.id) ? installations[app.id] : undefined;
    return {
      id: app.id, name: app.name, description: app.description, tagline: app.tagline, tags: app.tags,
      links: app.links, iconUrl: app.iconUrl, artUrl: app.artUrl,
      source: 'official', catalogIntegration: app.integrationLevel, catalogVersion: app.version,
      releasedAt: app.releasedAt, featured: app.featured,
      // Required legacy booleans are placeholders when there is no observation.
      installed: observed?.installed ?? false, running: observed?.running ?? false, statusKnown: observed !== undefined,
      integration: observed?.installed ? integrations[app.integrationLevel] : 'catalog',
      version: observed?.installed ? observed.version : undefined, update: observed?.installed ? observed.update : undefined,
    };
  });
  const badges = { new: 'news.new', featured: 'news.featured', update: 'news.update' } as const;
  const news: NewsItem[] = catalog.apps.flatMap(app => app.news.map(item => ({
    id: `${app.id}:${item.id}`, appId: app.id, title: item.title, text: item.text,
    badge: t('es', badges[item.kind]) as NewsItem['badge'], cta: t('es', 'news.viewCatalog'), publishedAt: item.publishedAt,
  })));
  return { apps, news };
}
