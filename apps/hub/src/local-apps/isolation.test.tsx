// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import full from '../../../../crates/nexo-catalog/fixtures/full.json';
import App from '../App';
import { parseCatalogV4, projectCatalogV4 } from '../catalog/format';
import { windowsCatalog } from '../test-helpers/catalog-v4';
import { projectCatalog } from '../catalog/mapping';
import { selectOfficialNews } from '../news/selection';
import { listLocalApps } from './index';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide: vi.fn() }) }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('../news/selection', async importOriginal => {
  const original = await importOriginal<typeof import('../news/selection')>();
  return { ...original, selectOfficialNews: vi.fn(original.selectOfficialNews) };
});

const official = windowsCatalog(full.apps);
const officialProjected = projectCatalogV4(parseCatalogV4(official), 'windows-x86_64');
const officialText = JSON.stringify(official);
const secrets = ['PRIVATE_APP_NAME', 'C:\\Secret\\Work.exe', 'C:\\Secret\\private.json', 'icon-private.png', 'PRIVATE_NEWS_TITLE', 'https://private.example/icon.png'];
const localDocument = { ...official, apps: [{ ...official.apps[0], name: secrets[0], iconUrl: secrets[5], news: [{ ...official.apps[0].news[0], title: secrets[4] }] }] };
let officialCache: string | null;
let previousLanguage: string;

beforeEach(() => {
  previousLanguage = document.documentElement.lang;
  vi.clearAllMocks();
  officialCache = null;
  bridge.invoke.mockImplementation(async (command: string, args?: { input?: string }) => {
    if (command === 'get_settings') return { state: 'ready', settings: {
      language: 'en', startWithWindows: false, showNewsOnOpen: true, accent: '#ff0036', compact: false,
      opacity: 85, blur: 24, firstRunComplete: true, newsVisit: null,
      sources: [{ id: 'official', label: 'Official', kind: 'official' }, { id: 'private', label: secrets[0], kind: 'local', location: secrets[2] }],
      localApps: [{ id: 'manual', name: secrets[0], executable: secrets[1], icon: secrets[3] }],
      localBindings: [{ sourceId: 'private', appId: 'example-app', executable: secrets[1] }],
    } };
    if (command === 'platform_key') return 'windows-x86_64';
    if (command === 'read_catalog_v4_cache') return null;
    if (command === 'write_catalog_cache') { officialCache = args?.input ?? null; return; }
    if (command === 'installed_apps') return [];
    if (command === 'local_apps_list') return [
      { id: 'local:manual:31', source: 'local', name: secrets[0], state: 'ready', origin: { kind: 'manual', id: 'manual' }, iconPath: secrets[3] },
    ];
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0 };
    if (command === 'plugin:autostart|is_enabled' || command === 'backdrop_available') return false;
    return null;
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); document.documentElement.lang = previousLanguage; vi.unstubAllGlobals(); });

it('leaves the official projection byte-identical when there are no local rows', async () => {
  const before = JSON.stringify(projectCatalog(officialProjected));
  bridge.invoke.mockResolvedValueOnce([]);
  expect(await listLocalApps()).toEqual([]);
  expect(JSON.stringify(projectCatalog(officialProjected))).toBe(before);
});

it('keeps manual records and legacy metadata out of News inputs, requests and official cache writes', async () => {
  const fetcher = vi.fn(async (url: string, _options: unknown) => ({ ok: true, redirected: false, url, text: async () => officialText }));
  vi.stubGlobal('fetch', fetcher);
  expect(await listLocalApps()).toHaveLength(1);
  render(<App />);
  await waitFor(() => expect(officialCache).toBe(officialText));
  await waitFor(() => expect(selectOfficialNews).toHaveBeenCalled());

  for (const [input] of vi.mocked(selectOfficialNews).mock.calls) {
    expect(input).toEqual(officialProjected);
    expect(input).not.toEqual(localDocument);
  }
  const projected = projectCatalog(officialProjected);
  expect(JSON.stringify(projected)).not.toContain(secrets[0]);
  // Only the v4 endpoint is requested, with redirects refused and no local data.
  const officialEndpoints = ['https://egdev6.github.io/nexo-catalog/v4/catalog.json'];
  expect(fetcher).toHaveBeenCalled();
  for (const [url, options] of fetcher.mock.calls) {
    expect(officialEndpoints).toContain(url);
    expect(options).toMatchObject({ redirect: 'error' });
  }
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(officialEndpoints);
  expect(officialCache).toBe(officialText);
  const outbound = JSON.stringify({ requests: fetcher.mock.calls, ipc: bridge.invoke.mock.calls, newsInputs: vi.mocked(selectOfficialNews).mock.calls, cache: officialCache });
  for (const secret of secrets) expect(outbound).not.toContain(JSON.stringify(secret).slice(1, -1));
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'write_catalog_cache')).toEqual([['write_catalog_cache', { input: officialText }]]);
});
