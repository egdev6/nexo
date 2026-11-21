import { describe, expect, it } from 'vitest';
import full from '../../../../crates/nexo-catalog/fixtures/full.json';
import minimal from '../../../../crates/nexo-catalog/fixtures/minimal.json';
import parity from '../../../../crates/nexo-catalog/fixtures/parity.json';
import v4 from '../../../../crates/nexo-catalog/fixtures/v4.json';
import parityV4 from '../../../../crates/nexo-catalog/fixtures/parity-v4.json';
import { parseCatalog, parseCatalogV4, projectCatalogV4 } from './format';
import { projectCatalog } from './mapping';

const copy = () => structuredClone(full);

describe('catalog format v1', () => {
  it('accepts the shared minimal, full and empty fixtures', () => {
    expect(parseCatalog(minimal).apps).toHaveLength(1);
    expect(parseCatalog(full).apps).toHaveLength(1);
    expect(parseCatalog({ schemaVersion: 1, apps: [] }).apps).toEqual([]);
    expect(parseCatalog(JSON.parse('{"schemaVersion":1.0,"apps":[]}')).apps).toEqual([]);
  });
  it('rejects v1 detection before validating individual app fields', () => {
    const doc = copy();
    const second = structuredClone(doc.apps[0]);
    second.id = 'second-app';
    Object.assign(second, { detection: { windows: { displayName: 'A', publisher: 'P', executableRelativePath: 'A.exe' } } });
    Object.defineProperty(doc.apps[0], 'id', { enumerable: true, get: () => { throw new Error('ID read before v1 detection rejection'); } });
    doc.apps.push(second);
    expect(() => parseCatalog(doc)).toThrow('Invalid catalog');
  });
  it('rejects invalid and duplicate app and news IDs', () => {
    for (const id of ['', 'UPPER', 'a_b', '../app', 'good\n']) { const doc = copy(); doc.apps[0].id = id; expect(() => parseCatalog(doc)).toThrow(); }
    const duplicate = copy(); duplicate.apps.push(structuredClone(duplicate.apps[0])); expect(() => parseCatalog(duplicate)).toThrow();
    const news = copy(); news.apps[0].news.push(structuredClone(news.apps[0].news[0])); expect(() => parseCatalog(news)).toThrow();
    const badNews = copy(); badNews.apps[0].news[0].id = 'Bad_id'; expect(() => parseCatalog(badNews)).toThrow();
  });
  it('rejects insecure, malformed and credential-bearing URLs for every URL field', () => {
    for (const field of ['iconUrl', 'artUrl', 'installerUrl', 'latestJsonUrl'] as const) {
      for (const url of ['http://example.com/file', 'relative/file', 'https://', 'https://user:pass@example.com', 'https://@example.com', 'https:///example.com', 'https://example.com/%ZZ']) {
        const doc = copy(); doc.apps[0][field] = url; expect(() => parseCatalog(doc)).toThrow();
      }
    }
    for (const field of ['github', 'youtube'] as const) { const doc = copy(); doc.apps[0].links[field] = 'http://example.com'; expect(() => parseCatalog(doc)).toThrow(); }
  });
  it('validates SemVer and real timestamps for apps and news', () => {
    for (const version of ['1.2', 'v1.2.3', '01.2.3', '1.2.3-01', '1.2.3+', '1.2.3\n']) { const doc = copy(); doc.apps[0].version = version; expect(() => parseCatalog(doc)).toThrow(); }
    for (const date of ['2025-02-29T00:00:00Z', '2025-01-01', '2025-13-01T00:00:00Z', '2025-01-01T00:00:00Z\n']) {
      const doc = copy(); doc.apps[0].releasedAt = date; expect(() => parseCatalog(doc)).toThrow();
      const news = copy(); news.apps[0].news[0].publishedAt = date; expect(() => parseCatalog(news)).toThrow();
    }
  });
  it('rejects unknown integration and news kinds, fields, missing data and versions', () => {
    for (const mutate of [
      (d: ReturnType<typeof copy>) => { d.apps[0].integrationLevel = 'unknown'; },
      (d: ReturnType<typeof copy>) => { d.apps[0].news[0].kind = 'unknown'; },
      (d: ReturnType<typeof copy>) => { Object.assign(d.apps[0], { unexpected: true }); },
      (d: ReturnType<typeof copy>) => { delete (d.apps[0] as Partial<typeof d.apps[0]>).name; },
      (d: ReturnType<typeof copy>) => { d.schemaVersion = 4; },
    ]) { const doc = copy(); mutate(doc); expect(() => parseCatalog(doc)).toThrow(); }
    expect(() => parseCatalog(null)).toThrow();
  });
  it('rejects empty text and requires an icon or artwork', () => {
    for (const field of ['name', 'tagline', 'description'] as const) { const doc = copy(); doc.apps[0][field] = '  '; expect(() => parseCatalog(doc)).toThrow(); }
    const blank = copy(); blank.apps[0].news[0].text = ' '; expect(() => parseCatalog(blank)).toThrow();
    const noArt = copy(); delete (noArt.apps[0] as Partial<typeof noArt.apps[0]>).iconUrl; delete (noArt.apps[0] as Partial<typeof noArt.apps[0]>).artUrl; expect(() => parseCatalog(noArt)).toThrow();
    const artOnly = copy(); delete (artOnly.apps[0] as Partial<typeof artOnly.apps[0]>).iconUrl; expect(() => parseCatalog(artOnly)).not.toThrow();
  });
});

type ParityCase = { name: string; base: string; valid: boolean; patches?: { op: string; path: string; value?: unknown }[] };
function parityDocument(test: ParityCase, base?: unknown): unknown {
  const document = structuredClone(base ?? (test.base === 'full' ? full : test.base === 'minimal' ? minimal : { schemaVersion: 1, apps: [] })) as Record<string, unknown>;
  for (const patch of test.patches ?? []) {
    const keys = patch.path.split('/').slice(1);
    const parent = keys.slice(0, -1).reduce((value, key) => (value as Record<string, unknown>)[key], document as unknown) as Record<string, unknown>;
    const key = keys[keys.length - 1];
    if (patch.op === 'remove') delete parent[key];
    else if (patch.op === 'duplicate') {
      const items = parent[key] as unknown[];
      items.push(structuredClone(items[0]));
    } else parent[key] = structuredClone(patch.value);
  }
  return document;
}

it.each(parity.cases as ParityCase[])('matches shared Rust validation and catalog fields: $name', test => {
  const document = parityDocument(test);
  if (test.valid) expect(parseCatalog(document)).toEqual(document);
  else expect(() => parseCatalog(document)).toThrow();
});

it.each(parityV4.cases)('v4 shared validation: $name', test => {
  const document = parityDocument({ ...test, base: 'v4' }, v4);
  if (test.valid) expect(parseCatalogV4(document)).toEqual(document);
  else expect(() => parseCatalogV4(document)).toThrow('Invalid catalog');
});

it.each(Object.entries(parityV4.projections))('v4 shared projection for %s', (platform, expected) => {
  expect(projectCatalogV4(parseCatalogV4(v4), platform)).toEqual(expected);
});

it('v4 shared projection hides all apps for an unsupported platform', () => {
  expect(projectCatalogV4(parseCatalogV4(v4), null)).toEqual({ schemaVersion: 4, apps: [] });
});

it('v4 applies common and detection validation to every platform', () => {
  for (const patch of [
    { op: 'add', path: '/unknown', value: true },
    { op: 'add', path: '/apps/0/detection', value: {} },
    { op: 'add', path: '/apps/0/platforms/windows-x86_64/detection/extra', value: true },
    { op: 'set', path: '/apps/0/platforms/windows-x86_64/detection/executableRelativePath', value: '../escape.exe' },
    { op: 'duplicate', path: '/apps/0/news' },
    { op: 'set', path: '/apps/0/news/0/publishedAt', value: '2025-02-29T00:00:00Z' },
    { op: 'add', path: '/apps/0/platforms/windows-x86_64\n', value: v4.apps[0].platforms['windows-x86_64'] },
  ]) expect(() => parseCatalogV4(parityDocument({ name: patch.path, base: 'v4', valid: false, patches: [patch] }, v4)), patch.path).toThrow('Invalid catalog');
});

it('accepts only Tauri-encoded minisign public keys in v3', () => {
  const doc = copy(); doc.schemaVersion = 3;
  doc.apps[0].installerUrl = 'https://github.com/egdev6/example/releases/download/v1/setup.exe';
  doc.apps[0].latestJsonUrl = 'https://github.com/egdev6/example/releases/download/v1/latest.json';
  const key = btoa(`untrusted comment: minisign public key: 0000000000000000\n${btoa('Ed' + '\x00'.repeat(40))}\n`);
  Object.assign(doc.apps[0], { updaterPublicKey: key });
  expect(parseCatalog(doc).apps[0]).toMatchObject({ updaterPublicKey: key });
  for (const invalid of ['', ' ', 'not-a-key', 'dGVzdA==']) {
    Object.assign(doc.apps[0], { updaterPublicKey: invalid });
    expect(() => parseCatalog(doc)).toThrow();
  }
});

it('matches the shared Rust reference projection for official metadata and news', () => {
  expect(projectCatalog(parseCatalog(full))).toMatchObject(parity.projectedFull);
});

it('maps only official metadata, separates unknown install state and projects news with scoped IDs', () => {
  const { apps, news } = projectCatalog(parseCatalog(full));
  expect(apps).toHaveLength(1);
  expect(apps[0]).toMatchObject({ id: 'example-app', name: 'Example App', source: 'official', statusKnown: false, integration: 'catalog', catalogIntegration: 'full', iconUrl: 'https://example.com/icon.png', artUrl: 'https://example.com/art.png', releasedAt: '2025-01-02T03:04:05Z', featured: true, catalogVersion: '1.2.3-beta.1+build.5' });
  expect(apps[0].version).toBeUndefined();
  expect(news).toEqual([{ id: 'example-app:release', appId: 'example-app', badge: 'Nuevo', title: 'Example release', text: 'A fictional release announcement.', cta: 'Ver en el catálogo', publishedAt: '2025-01-02T03:04:05Z' }]);
});

it('uses only observed installation data and maps installed capabilities independently of official source', () => {
  for (const [capability, integration] of [['full', 'complete'], ['update', 'updates'], ['launch', 'local']] as const) {
    const doc = copy(); doc.apps[0].integrationLevel = capability;
    const result = projectCatalog(parseCatalog(doc), { 'example-app': { installed: true, running: false, version: '9.0.0' } });
    expect(result.apps[0]).toMatchObject({ source: 'official', statusKnown: true, installed: true, running: false, integration, version: '9.0.0', catalogVersion: '1.2.3-beta.1+build.5' });
  }
  const available = projectCatalog(parseCatalog(full), { 'example-app': { installed: false, running: false } });
  expect(available.apps[0]).toMatchObject({ source: 'official', statusKnown: true, installed: false, integration: 'catalog' });
  const inherited = copy(); inherited.apps[0].id = 'constructor';
  expect(projectCatalog(parseCatalog(inherited)).apps[0].statusKnown).toBe(false);
});

it('leaves the NSIS installer rule to native selection, like Rust, so one entry cannot reject the whole v4 catalog', () => {
  const doc = structuredClone(v4) as typeof v4;
  doc.apps[0].platforms['windows-x86_64'].installerUrl = 'https://github.com/egdev6/example/releases/download/v1.2.3/example.msi';
  expect(projectCatalogV4(parseCatalogV4(doc), 'windows-x86_64').apps[0].installerUrl).toMatch(/example\.msi$/);
});
