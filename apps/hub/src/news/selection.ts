import type { Catalog, CatalogNews } from '../catalog/format';
import { projectCatalog } from '../catalog/mapping';
import type { NewsItem } from '../model';
import { t } from '../i18n';

const WINDOW_SECONDS = 30 * 24 * 60 * 60;
type Instant = { seconds: number; fraction: string };

// #5 accepts arbitrary fractional precision and leap seconds. Date.parse alone
// truncates fractions to milliseconds and rejects leap seconds.
function instant(value: string): Instant {
  const match = /^(.*T\d\d:\d\d:)(\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(value)!;
  const leap = match[2] === '60';
  const seconds = Date.parse(`${match[1]}${leap ? '59' : match[2]}${match[4]}`) / 1000 + (leap ? 1 : 0);
  return { seconds, fraction: (match[3] ?? '').replace(/0+$/, '') };
}
function compare(a: Instant, b: Instant): number {
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  const length = Math.max(a.fraction.length, b.fraction.length);
  const left = a.fraction.padEnd(length, '0'), right = b.fraction.padEnd(length, '0');
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Latest explicit catalog news, without the popup's age window or synthetic entries. */
export function latestCatalogNews(news: CatalogNews[]): CatalogNews | undefined {
  return news.reduce<CatalogNews | undefined>((latest, item) => {
    if (!latest) return item;
    const order = compare(instant(item.publishedAt), instant(latest.publishedAt));
    return order > 0 || (order === 0 && item.id < latest.id) ? item : latest;
  }, undefined);
}

/** Call only with a validated official catalog, never local sources. */
export function selectOfficialNews(catalog: Catalog, now = Date.now()): { items: NewsItem[]; validKeys: Set<string> } {
  const projected = projectCatalog(catalog);
  const mapped = new Map(projected.news.map(item => [item.id, item]));
  const validKeys = new Set<string>();
  const nowInstant = instant(new Date(now).toISOString());
  const cutoff = { ...nowInstant, seconds: nowInstant.seconds - WINDOW_SECONDS };
  const items: { item: NewsItem & { appName: string }; time: Instant }[] = [];
  for (const app of catalog.apps) {
    const appKey = `a:${app.id}`;
    validKeys.add(appKey);
    for (const news of app.news) validKeys.add(`n:${app.id}:${news.id}`);
    const release = instant(app.releasedAt);
    if (compare(release, nowInstant) > 0 || (!app.featured && compare(release, cutoff) < 0)) continue;
    // One entry per app: only its latest news inside the window, so two versions of the same app never repeat.
    const latest = latestCatalogNews(app.news.filter(news => {
      const time = instant(news.publishedAt);
      return compare(time, cutoff) >= 0 && compare(time, nowInstant) <= 0;
    }));
    if (latest) {
      const item = mapped.get(`${app.id}:${latest.id}`)!;
      items.push({ item: { ...item, id: `n:${app.id}:${latest.id}`, appName: app.name }, time: instant(latest.publishedAt) });
    } else items.push({
      item: { id: appKey, appId: app.id, appName: app.name, badge: t('es', app.featured ? 'news.featured' : 'news.new') as NewsItem['badge'], title: app.name,
        text: app.tagline || app.description, cta: t('es', 'news.viewCatalog'), publishedAt: app.releasedAt },
      time: release,
    });
  }
  items.sort((a, b) => compare(b.time, a.time) || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  return { items: items.map(entry => entry.item), validKeys };
}
