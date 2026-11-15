import type { HubApp } from '../model';
import { latestCatalogNews } from '../news/selection';
import { compareSemver, type Catalog } from './format';

/** Catalog is already validated by the official loader; installed version comes only from detection. */
export function availableUpdate(app: HubApp, catalog?: Catalog) {
  if (app.source !== 'official' || app.statusKnown !== true || !app.installed || app.installationState !== 'installed' || !catalog) return undefined;
  const item = catalog.apps.find(candidate => candidate.id === app.id);
  if (!item?.version || compareSemver(app.version, item.version) !== -1) return undefined;
  const status = catalog.schemaVersion === 3 && item.updaterPublicKey ? 'available' as const : 'unverifiable' as const;
  return { status, version: item.version, notes: latestCatalogNews(item.news) };
}
