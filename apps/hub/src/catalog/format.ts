export type CatalogIntegration = 'full' | 'update' | 'launch';
export type CatalogNewsKind = 'new' | 'featured' | 'update';

export interface CatalogNews {
  id: string;
  title: string;
  text: string;
  publishedAt: string;
  kind: CatalogNewsKind;
}

export interface CatalogApp {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tags: string[];
  iconUrl?: string;
  artUrl?: string;
  installerUrl: string;
  latestJsonUrl: string;
  integrationLevel: CatalogIntegration;
  releasedAt: string;
  featured: boolean;
  version?: string;
  links?: { github?: string; youtube?: string };
  news: CatalogNews[];
}

export interface Catalog { schemaVersion: 1; apps: CatalogApp[] }

function fail(): never { throw new Error('Invalid catalog'); }
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  const object = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(object, key)) || Object.keys(object).some(key => !required.includes(key) && !optional.includes(key))) return fail();
  return object;
}
function text(value: unknown): void { if (typeof value !== 'string' || !/[^\s\u0085]/u.test(value)) fail(); }
function id(value: unknown): void { if (typeof value !== 'string' || !value || /[^a-z0-9-]/.test(value)) fail(); }
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('https://') || /[\s\u0000-\u001f\u007f-\u009f]/u.test(value) || /%(?![0-9a-f]{2})/i.test(value)) return false;
  const authority = value.slice(8).split(/[/?#]/, 1)[0];
  if (!authority || /[@\\]/.test(authority)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch { return false; }
}
function https(value: unknown): void { if (!isHttpsUrl(value)) fail(); }
function semver(value: unknown): void {
  if (typeof value !== 'string') return fail();
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match || match[0] !== value || match.slice(1, 4).some(n => BigInt(n) > 18446744073709551615n) || match[4]?.split('.').some(part => /^0[0-9]+$/.test(part))) fail();
}
function timestamp(value: unknown): void {
  if (typeof value !== 'string') return fail();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value) return fail();
  const [, y, mo, d, h, mi, s, , , oh, om] = match;
  const year = Number(y), month = Number(mo), day = Number(d), hour = Number(h), minute = Number(mi), second = Number(s);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 60 || (second === 60 && minute !== 59) || (oh && Number(oh) > 23) || (om && Number(om) > 59)) fail();
}

/** Validate untrusted parsed JSON; no input becomes official UI data without this check. */
export function parseCatalog(value: unknown): Catalog {
  const root = record(value, ['schemaVersion', 'apps']);
  if (root.schemaVersion !== 1 || !Array.isArray(root.apps)) return fail();
  const ids = new Set<string>();
  for (const entry of root.apps) {
    const app = record(entry, ['id', 'name', 'tagline', 'description', 'tags', 'installerUrl', 'latestJsonUrl', 'integrationLevel', 'releasedAt', 'featured', 'news'], ['iconUrl', 'artUrl', 'version', 'links']);
    id(app.id);
    if (ids.has(app.id as string)) fail();
    ids.add(app.id as string);
    [app.name, app.tagline, app.description].forEach(text);
    if (!Array.isArray(app.tags)) return fail();
    app.tags.forEach(text);
    if (!Object.hasOwn(app, 'iconUrl') && !Object.hasOwn(app, 'artUrl')) fail();
    for (const field of ['iconUrl', 'artUrl', 'installerUrl', 'latestJsonUrl']) if (Object.hasOwn(app, field)) https(app[field]);
    if (Object.hasOwn(app, 'links')) {
      const links = record(app.links, [], ['github', 'youtube']);
      for (const field of ['github', 'youtube']) if (Object.hasOwn(links, field)) https(links[field]);
    }
    if (Object.hasOwn(app, 'version')) semver(app.version);
    if (!['full', 'update', 'launch'].includes(app.integrationLevel as string)) fail();
    if (typeof app.featured !== 'boolean') fail();
    timestamp(app.releasedAt);
    if (!Array.isArray(app.news)) return fail();
    const newsIds = new Set<string>();
    for (const entry of app.news) {
      const item = record(entry, ['id', 'title', 'text', 'publishedAt', 'kind']);
      id(item.id);
      if (newsIds.has(item.id as string)) fail();
      newsIds.add(item.id as string);
      text(item.title); text(item.text); timestamp(item.publishedAt);
      if (!['new', 'featured', 'update'].includes(item.kind as string)) fail();
    }
  }
  return value as Catalog;
}
