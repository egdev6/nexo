import { expect, it } from 'vitest';
import { parseCatalog } from '../catalog/format';
import { selectOfficialNews } from './selection';

const now = Date.parse('2026-11-17T12:00:00Z');
const update = (version: string, publishedAt: string) => ({ id: `v${version.replaceAll('.', '-')}`, title: `Antena ${version}`, text: `Antena ${version} is out.`, publishedAt, kind: 'update' });
const app = (id: string, name: string, news: ReturnType<typeof update>[]) => ({
  id, name, tagline: `Tag ${name}`, description: `About ${name}`, tags: [], iconUrl: 'https://example.com/icon.png',
  installerUrl: 'https://example.com/setup.exe', latestJsonUrl: 'https://example.com/latest.json', integrationLevel: 'launch',
  releasedAt: '2026-11-10T00:00:00Z', featured: false, news,
});

it('shows only the latest news item of each app, newest first, and keeps every news key valid', () => {
  const catalog = parseCatalog({ schemaVersion: 1, apps: [
    app('antena', 'Antena', [update('0.15.0', '2026-11-14T09:00:00Z'), update('0.16.0', '2026-11-17T00:20:00Z')]),
    app('quorb', 'Quorb', [update('0.8.0', '2026-11-12T00:00:00Z')]),
  ] });
  const { items, validKeys } = selectOfficialNews(catalog, now);
  expect(items.map(item => item.id)).toEqual(['n:antena:v0-16-0', 'n:quorb:v0-8-0']);
  expect(items.filter(item => item.appId === 'antena')).toHaveLength(1);
  expect(validKeys.has('n:antena:v0-15-0')).toBe(true);
  expect(validKeys.has('n:antena:v0-16-0')).toBe(true);
});

it('selects within the inclusive window before considering future news and preserves synthetic fallbacks', () => {
  const catalog = parseCatalog({ schemaVersion: 1, apps: [
    app('window', 'Window', [
      update('0.1.0', '2026-11-11T00:00:00Z'),
      update('0.2.0', '2026-11-17T12:00:00Z'),
      update('0.3.0', '2026-11-17T12:00:00.0000001Z'),
    ]),
    app('cutoff', 'Cutoff', [update('0.0.1', '2026-10-18T11:59:59.9999999Z'), update('0.0.2', '2026-10-18T12:00:00Z')]),
    app('fallback', 'Fallback', [update('0.0.1', '2026-10-18T11:59:59Z'), update('0.0.2', '2026-11-18T00:00:00Z')]),
    { ...app('featured', 'Featured', [update('0.0.1', '2026-10-01T00:00:00Z')]), releasedAt: '2025-01-01T00:00:00Z', featured: true },
  ] });
  const { items, validKeys } = selectOfficialNews(catalog, now);
  expect(items.map(item => item.id)).toEqual(['n:window:v0-2-0', 'a:fallback', 'n:cutoff:v0-0-2', 'a:featured']);
  expect(items.map(item => item.appId)).toEqual(['window', 'fallback', 'cutoff', 'featured']);
  expect(items.find(item => item.appId === 'fallback')?.badge).toBe('Nuevo');
  expect(items.find(item => item.appId === 'featured')?.badge).toBe('Destacada');
  expect([...validKeys].sort()).toEqual([
    'a:window', 'n:window:v0-1-0', 'n:window:v0-2-0', 'n:window:v0-3-0',
    'a:cutoff', 'n:cutoff:v0-0-1', 'n:cutoff:v0-0-2',
    'a:fallback', 'n:fallback:v0-0-1', 'n:fallback:v0-0-2',
    'a:featured', 'n:featured:v0-0-1',
  ].sort());
});

it('breaks same-app ties by news ID and equal-instant app ties by typed key', () => {
  const timestamp = '2026-11-17T11:00:00Z';
  const catalog = parseCatalog({ schemaVersion: 1, apps: [
    app('beta', 'Beta', [update('0.2.0', timestamp), update('0.1.0', timestamp)]),
    app('alpha', 'Alpha', [update('0.1.0', timestamp)]),
    { ...app('zeta', 'Zeta', []), releasedAt: timestamp },
  ] });
  const { items, validKeys } = selectOfficialNews(catalog, now);
  expect(items.map(item => item.id)).toEqual(['a:zeta', 'n:alpha:v0-1-0', 'n:beta:v0-1-0']);
  expect(validKeys.has('n:beta:v0-2-0')).toBe(true);
});
