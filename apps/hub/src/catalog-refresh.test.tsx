// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { defaultSettings } from './sample';
import v4 from '../../../crates/nexo-catalog/fixtures/v4.json';

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  fetch: vi.fn(),
  events: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
  bridge.events.set(name, callback);
  return () => { if (bridge.events.get(name) === callback) bridge.events.delete(name); };
}) }));
vi.mock('./shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('./window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./local-apps/view', () => ({ LocalAppsView: () => null }));

let now: number;
let sequence: number;
let cycle: number;
let stored: string | null;
const fiveMinutes = 5 * 60 * 1000;
function catalog(version: string) {
  return JSON.stringify({ schemaVersion: 4, apps: [{
    id: 'example-app', name: 'Example App', tagline: 'Example', description: 'Example application', tags: [],
    iconUrl: 'https://example.com/icon.png', integrationLevel: 'launch', featured: false, news: [],
    platforms: { 'windows-x86_64': { installerUrl: 'https://github.com/egdev6/example-app/releases/download/v1.0.0/example-app_x64-setup.exe',
      latestJsonUrl: 'https://github.com/egdev6/example-app/releases/download/v1.0.0/latest.json', releasedAt: '2025-01-02T03:04:05Z', version } },
  }] });
}
function response(url: string, version: string) {
  return { ok: true, redirected: false, url, text: async () => catalog(version) };
}
function visibility(visible: boolean) {
  sequence++; if (visible) cycle++;
  act(() => bridge.events.get('flyout-visibility')!({ payload: { visible, sequence, cycle, at: now } }));
}
function selectTab(name: 'Mis apps' | 'Catálogo') {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab);
}
function version() {
  return within(screen.getByRole('article', { name: 'Example App' })).getByText(/Versión publicada:/).textContent;
}
function scans() {
  return bridge.invoke.mock.calls.filter(([command]) => command === 'installed_apps').length;
}
async function start() {
  render(<App />);
  await screen.findByText('Instaladas');
  await waitFor(() => expect(bridge.events.has('flyout-visibility')).toBe(true));
  await waitFor(() => expect(stored).toBe(catalog('1.0.0')));
  visibility(true);
  selectTab('Catálogo');
  await waitFor(() => expect(version()).toContain('1.0.0'));
}

beforeEach(() => {
  now = 1_000_000; sequence = 0; cycle = 0; stored = null;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  bridge.events.clear(); bridge.invoke.mockReset(); bridge.fetch.mockReset();
  bridge.fetch.mockImplementation(async (url: string) => response(url, '1.0.0'));
  vi.stubGlobal('fetch', bridge.fetch);
  let settings = { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false };
  bridge.invoke.mockImplementation(async (command: string, args?: { input?: string; patch?: Partial<typeof settings> }) => {
    if (command === 'get_settings') return { state: 'ready', settings };
    if (command === 'save_settings') { settings = { ...settings, ...args?.patch }; return settings; }
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0, at: now };
    if (command === 'platform_key') return 'windows-x86_64';
    if (command === 'read_catalog_v4_cache') return stored;
    if (command === 'write_catalog_cache') { stored = args?.input ?? null; return null; }
    if (command === 'installed_apps') return [{ id: 'example-app', state: 'notInstalled', reason: 'No está instalada', version: null }];
    if (command === 'plugin:autostart|is_enabled') return false;
    return null;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('hides a Windows-only app and its news on Darwin throughout the live UI', async () => {
  const doc = structuredClone(v4);
  const timestamp = new Date(now).toISOString();
  doc.apps[0].news[0] = { id: 'darwin-news', title: 'Darwin news', text: 'Available', publishedAt: timestamp, kind: 'new' };
  doc.apps[0].platforms['darwin-aarch64']!.releasedAt = timestamp;
  doc.apps[1].platforms['windows-x86_64'].releasedAt = timestamp;
  (doc.apps[1].news as { id: string; title: string; text: string; publishedAt: string; kind: string }[]).push({ id: 'windows-news', title: 'Windows news', text: 'Windows only', publishedAt: timestamp, kind: 'new' });
  const text = JSON.stringify(doc);
  bridge.fetch.mockImplementation(async (url: string) => ({ ok: true, redirected: false, url, text: async () => text }));
  const original = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === 'platform_key') return 'darwin-aarch64';
    if (command === 'get_settings') return { state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: true } };
    if (command === 'installed_apps') return [{ id: 'windows-only', state: 'installed', version: '0.1.0' }, { id: 'example-app', state: 'notInstalled', version: null }];
    return original(command, args);
  });
  render(<App />);
  await screen.findByText('Instaladas');
  await waitFor(() => expect(stored).toBe(text));
  await waitFor(() => expect(bridge.events.has('flyout-visibility')).toBe(true));
  expect(screen.queryByText('Windows Only')).toBeNull();
  expect(screen.queryByRole('button', { name: /Actualizar a v/ })).toBeNull();
  visibility(true);
  const dialog = await screen.findByRole('dialog', { name: 'Novedades' });
  expect(within(dialog).getByText('Darwin news')).toBeTruthy();
  expect(within(dialog).queryByText('Windows news')).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar novedades' }));
  selectTab('Catálogo');
  expect(await screen.findByRole('article', { name: 'Example App' })).toBeTruthy();
  expect(screen.queryByRole('article', { name: 'Windows Only' })).toBeNull();
  selectTab('Mis apps');
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar apps' }));
  await waitFor(() => expect(bridge.fetch).toHaveBeenCalledTimes(2));
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'platform_key')).toHaveLength(1);
  expect(bridge.fetch.mock.calls.every(([url]) => url === 'https://egdev6.github.io/nexo-catalog/v4/catalog.json')).toBe(true);
});

it('fetches once on first open, throttles through five minutes, then refreshes in the background', async () => {
  await start();
  expect(bridge.fetch).toHaveBeenCalledTimes(1);
  visibility(false); now += fiveMinutes; visibility(true);
  expect(bridge.fetch).toHaveBeenCalledTimes(1);
  let finish!: () => void;
  bridge.fetch.mockImplementationOnce((url: string) => new Promise(resolve => { finish = () => resolve(response(url, '2.0.0')); }));
  visibility(false); now++; visibility(true);
  await waitFor(() => expect(bridge.fetch).toHaveBeenCalledTimes(2));
  expect(version()).toContain('1.0.0');
  expect(screen.queryByText('Cargando catálogo…')).toBeNull();
  visibility(false); now += fiveMinutes + 1; visibility(true);
  selectTab('Mis apps');
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar apps' }));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar apps' }));
  expect(bridge.fetch).toHaveBeenCalledTimes(2);
  selectTab('Catálogo');
  expect(version()).toContain('1.0.0');
  expect(screen.queryByText('Cargando catálogo…')).toBeNull();
  await act(async () => finish());
  await waitFor(() => expect(version()).toContain('2.0.0'));
  expect(stored).toBe(catalog('2.0.0'));
  visibility(false); now++; visibility(true);
  expect(bridge.fetch).toHaveBeenCalledTimes(2);
});

it('forces each manual refresh immediately and still rescans installations', async () => {
  await start();
  selectTab('Mis apps');
  const initialScans = scans();
  bridge.fetch.mockImplementationOnce(async (url: string) => response(url, '2.0.0'));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar apps' }));
  await waitFor(() => expect(bridge.fetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(scans()).toBeGreaterThan(initialScans));
  await waitFor(() => expect(stored).toBe(catalog('2.0.0')));
  selectTab('Catálogo');
  await waitFor(() => expect(version()).toContain('2.0.0'));
  selectTab('Mis apps');
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar apps' }));
  await waitFor(() => expect(bridge.fetch).toHaveBeenCalledTimes(3));
});

it('keeps the cached catalog visible on failure and retries the next open', async () => {
  await start();
  bridge.fetch.mockRejectedValueOnce(new Error('offline'));
  visibility(false); now += fiveMinutes + 1; visibility(true);
  await waitFor(() => expect(bridge.fetch).toHaveBeenCalledTimes(2));
  await screen.findByText(/Sin conexión con el catálogo/);
  expect(version()).toContain('1.0.0');
  expect(stored).toBe(catalog('1.0.0'));
  expect(screen.queryByText('Cargando catálogo…')).toBeNull();
  bridge.fetch.mockImplementationOnce(async (url: string) => response(url, '2.0.0'));
  visibility(false); now++; visibility(true);
  await waitFor(() => expect(version()).toContain('2.0.0'));
  expect(bridge.fetch).toHaveBeenCalledTimes(3);
});

it('retains the visible catalog if a failed refresh cannot read any cache', async () => {
  await start();
  stored = null;
  bridge.fetch.mockRejectedValue(new Error('offline'));
  visibility(false); now += fiveMinutes + 1; visibility(true);
  await screen.findByText(/Sin conexión con el catálogo/);
  expect(bridge.fetch).toHaveBeenCalledTimes(2);
  expect(version()).toContain('1.0.0');
  expect(stored).toBeNull();
  expect(screen.queryByText('Cargando catálogo…')).toBeNull();
});

it('deduplicates startup, reopen and manual requests while a fetch is pending, including StrictMode', async () => {
  let finish!: () => void;
  bridge.fetch.mockImplementationOnce((url: string) => new Promise(resolve => { finish = () => resolve(response(url, '1.0.0')); }));
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('Instaladas');
  await waitFor(() => expect(bridge.events.has('flyout-visibility') && typeof finish === 'function').toBe(true));
  visibility(true); visibility(false); now += fiveMinutes + 1; visibility(true);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar apps' }));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar apps' }));
  expect(bridge.fetch).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  selectTab('Catálogo');
  await waitFor(() => expect(version()).toContain('1.0.0'));
  expect(bridge.fetch).toHaveBeenCalledTimes(1);
});

it('preserves focus rescans and the catalog error retry action', async () => {
  await start();
  const initialScans = scans();
  fireEvent.focus(window);
  await waitFor(() => expect(scans()).toBe(initialScans + 1));
  expect(bridge.fetch).toHaveBeenCalledTimes(1);
  bridge.fetch.mockRejectedValueOnce(new Error('offline'));
  visibility(false); now += fiveMinutes + 1; visibility(true);
  const error = await screen.findByRole('alert');
  expect(error.textContent).toContain('Sin conexión con el catálogo');
  bridge.fetch.mockImplementationOnce(async (url: string) => response(url, '2.0.0'));
  fireEvent.click(within(error).getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(version()).toContain('2.0.0'));
  expect(bridge.fetch).toHaveBeenCalledTimes(3);
});
