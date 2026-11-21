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
  updaterPublicKey?: string;
  integrationLevel: CatalogIntegration;
  releasedAt: string;
  featured: boolean;
  version?: string;
  links?: { github?: string; youtube?: string };
  detection?: { windows: { displayName: string; publisher: string; executableRelativePath: string } };
  news: CatalogNews[];
}

export interface Catalog {
  schemaVersion: 1 | 2 | 3 | 4;
  apps: CatalogApp[];
}

export interface CatalogPlatform {
  installerUrl: string;
  latestJsonUrl: string;
  version: string;
  releasedAt: string;
  updaterPublicKey?: string;
  detection?: NonNullable<CatalogApp['detection']>['windows'];
}
export interface CatalogV4 {
  schemaVersion: 4;
  apps: (Omit<CatalogApp, 'installerUrl' | 'latestJsonUrl' | 'version' | 'releasedAt' | 'updaterPublicKey' | 'detection'> & {
    platforms: Record<string, CatalogPlatform>;
  })[];
}

function fail(): never {
  throw new Error('Invalid catalog');
}
function record(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  const object = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(object, key)) || Object.keys(object).some((key) => !required.includes(key) && !optional.includes(key)))
    return fail();
  return object;
}
function text(value: unknown): void {
  if (typeof value !== 'string' || !/[^\s\u0085]/u.test(value)) fail();
}
export function isCatalogId(value: unknown): value is string {
  return typeof value === 'string' && !!value && !/[^a-z0-9-]/.test(value);
}
function id(value: unknown): void {
  if (!isCatalogId(value)) fail();
}
export function isHttpsUrl(value: unknown): value is string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Untrusted URLs must reject control characters before URL parsing.
  if (typeof value !== 'string' || !value.startsWith('https://') || /[\s\u0000-\u001f\u007f-\u009f]/u.test(value) || /%(?![0-9a-f]{2})/i.test(value))
    return false;
  const authority = value.slice(8).split(/[/?#]/, 1)[0];
  if (!authority || /[@\\]/.test(authority)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
function https(value: unknown): void {
  if (!isHttpsUrl(value)) fail();
}
function releaseAsset(value: unknown): void {
  if (!isHttpsUrl(value)) fail();
  const parsed = new URL(value);
  const slash = value.indexOf('/', 8);
  const rawPath = slash < 0 ? '' : value.slice(slash);
  if (parsed.hostname !== 'github.com' || parsed.port || parsed.search || parsed.hash || rawPath !== parsed.pathname) fail();
  for (const match of rawPath.matchAll(/%([0-9a-f]{2})/gi)) {
    const byte = Number.parseInt(match[1], 16);
    if (byte < 32 || byte === 127 || [0x2f, 0x5c, 0x2e, 0x25].includes(byte)) fail();
  }
  const parts = rawPath.slice(1).split('/');
  if (
    parts.length !== 6 ||
    parts[0] !== 'egdev6' ||
    parts[2] !== 'releases' ||
    parts[3] !== 'download' ||
    parts.some((part) => !part || part === '.' || part === '..')
  )
    fail();
}
function updaterKey(value: unknown): void {
  if (typeof value !== 'string') fail();
  try {
    const decoded = atob(value);
    if (btoa(decoded) !== value) fail();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(decoded, (byte) => byte.charCodeAt(0)));
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')) fail();
    const key = atob(lines[1]);
    if (btoa(key) !== lines[1] || key.length !== 42 || !key.startsWith('Ed')) fail();
  } catch {
    fail();
  }
}
function parseSemver(value: unknown): RegExpExecArray | null {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
    value,
  );
  return !match ||
    match[0] !== value ||
    match.slice(1, 4).some((n) => BigInt(n) > 18446744073709551615n) ||
    match[4]?.split('.').some((part) => /^0[0-9]+$/.test(part))
    ? null
    : match;
}
function semver(value: unknown): void {
  if (!parseSemver(value)) fail();
}

/** SemVer precedence, using the same strict validation as the catalog and native service. */
export function compareSemver(left: unknown, right: unknown): number | undefined {
  const a = parseSemver(left),
    b = parseSemver(right);
  if (!a || !b) return undefined;
  for (let i = 1; i <= 3; i++) {
    const x = BigInt(a[i]),
      y = BigInt(b[i]);
    if (x !== y) return x < y ? -1 : 1;
  }
  if (!a[4] || !b[4]) return a[4] === b[4] ? 0 : a[4] ? -1 : 1;
  const x = a[4].split('.'),
    y = b[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined || y[i] === undefined) return x[i] === undefined ? -1 : 1;
    if (x[i] === y[i]) continue;
    const nx = /^[0-9]+$/.test(x[i]),
      ny = /^[0-9]+$/.test(y[i]);
    if (nx && ny) return x[i].length !== y[i].length ? (x[i].length < y[i].length ? -1 : 1) : x[i] < y[i] ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}
function timestamp(value: unknown): void {
  if (typeof value !== 'string') fail();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value) fail();
  const [, y, mo, d, h, mi, s, , , oh, om] = match;
  const year = Number(y),
    month = Number(mo),
    day = Number(d),
    hour = Number(h),
    minute = Number(mi),
    second = Number(s);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    (second === 60 && minute !== 59) ||
    (oh && Number(oh) > 23) ||
    (om && Number(om) > 59)
  )
    fail();
}

function executableRelativePath(value: unknown): void {
  if (
    typeof value !== 'string' ||
    !/\.exe$/i.test(value) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Executable paths must reject control characters as invalid Windows path input.
    /[<>:"|?*\u0000-\u001f\u007f-\u009f]/u.test(value) ||
    value.split(/[\\/]/).some((part) => !part || part === '.' || part === '..' || /[ .]$/.test(part))
  )
    fail();
}

/** Validate untrusted parsed JSON; no input becomes official UI data without this check. */
export function parseCatalog(value: unknown): Catalog {
  const root = record(value, ['schemaVersion', 'apps']);
  if ((root.schemaVersion !== 1 && root.schemaVersion !== 2 && root.schemaVersion !== 3) || !Array.isArray(root.apps)) return fail();
  if (root.schemaVersion === 1 && root.apps.some((entry) => typeof entry === 'object' && entry !== null && Object.hasOwn(entry, 'detection'))) fail();
  const ids = new Set<string>();
  for (const entry of root.apps) {
    const app = record(
      entry,
      ['id', 'name', 'tagline', 'description', 'tags', 'installerUrl', 'latestJsonUrl', 'integrationLevel', 'releasedAt', 'featured', 'news'],
      ['iconUrl', 'artUrl', 'version', 'links', ...(root.schemaVersion !== 1 ? ['detection'] : []), ...(root.schemaVersion === 3 ? ['updaterPublicKey'] : [])],
    );
    if (root.schemaVersion === 3) {
      releaseAsset(app.installerUrl);
      releaseAsset(app.latestJsonUrl);
      if (Object.hasOwn(app, 'updaterPublicKey')) updaterKey(app.updaterPublicKey);
    }
    if (Object.hasOwn(app, 'detection')) {
      const detection = record(app.detection, ['windows']);
      const windows = record(detection.windows, ['displayName', 'publisher', 'executableRelativePath']);
      text(windows.displayName);
      text(windows.publisher);
      executableRelativePath(windows.executableRelativePath);
    }
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
      text(item.title);
      text(item.text);
      timestamp(item.publishedAt);
      if (!['new', 'featured', 'update'].includes(item.kind as string)) fail();
    }
  }
  return value as Catalog;
}

/** Validate every v4 platform before projecting or caching the wire document. */
export function parseCatalogV4(value: unknown): CatalogV4 {
  const root = record(value, ['schemaVersion', 'apps']);
  if (root.schemaVersion !== 4 || !Array.isArray(root.apps)) return fail();
  const ids = new Set<string>();
  for (const entry of root.apps) {
    const app = record(
      entry,
      ['id', 'name', 'tagline', 'description', 'tags', 'integrationLevel', 'featured', 'news', 'platforms'],
      ['iconUrl', 'artUrl', 'links'],
    );
    if (ids.has(app.id as string)) fail();
    ids.add(app.id as string);
    const { platforms, ...common } = app;
    if (typeof platforms !== 'object' || platforms === null || Array.isArray(platforms)) return fail();
    const entries = Object.entries(platforms);
    if (!entries.length) fail();
    for (const [key, value] of entries) {
      const match = /^(windows|darwin|linux)-(x86_64|aarch64|i686|armv7)$/.exec(key);
      if (!match || match[0] !== key) fail();
      const platform = record(value, ['installerUrl', 'latestJsonUrl', 'version', 'releasedAt'], ['updaterPublicKey', 'detection']);
      if (Object.hasOwn(platform, 'detection') && !key.startsWith('windows-')) fail();
      const { detection, ...fields } = platform;
      const flat = { ...common, ...fields, ...(Object.hasOwn(platform, 'detection') ? { detection: { windows: detection } } : {}) };
      // Reuse the existing release-asset, key, timestamp, detection and common-field rules.
      parseCatalog({ schemaVersion: 3, apps: [flat] });
    }
  }
  return value as CatalogV4;
}

/** Project only the selected platform into the flat catalog consumed by the hub. */
export function projectCatalogV4(catalog: CatalogV4, platformKey: string | null): Catalog {
  const apps: CatalogApp[] = [];
  if (platformKey !== null)
    for (const { platforms, ...common } of catalog.apps) {
      if (!Object.hasOwn(platforms, platformKey)) continue;
      const { detection, ...fields } = platforms[platformKey];
      apps.push({ ...common, ...fields, ...(detection === undefined ? {} : { detection: { windows: detection } }) });
    }
  return { schemaVersion: 4, apps };
}
