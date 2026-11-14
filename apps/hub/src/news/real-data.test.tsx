// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import App, { FlyoutPanel } from '../App';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
  bridge.listeners.set(name, callback); return () => bridge.listeners.delete(name);
}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide: vi.fn() }) }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));

const today = '2026-05-31T12:00:00Z';
type Entry = { id: string; title: string; text: string; publishedAt: string; kind: 'new' | 'featured' | 'update' };
function entry(id: string, date: string, kind: Entry['kind'] = 'new'): Entry {
  return { id, title: id, text: `Texto ${id}`, publishedAt: date, kind };
}
function app(id: string, releasedAt: string, featured = false, news: Entry[] = []) {
  return { id, name: id, tagline: `Tag ${id}`, description: `Descripción ${id}`, tags: [], iconUrl: 'https://example.com/icon.png',
    installerUrl: 'https://example.com/setup.exe', latestJsonUrl: 'https://example.com/latest.json', integrationLevel: 'launch', releasedAt, featured, news };
}
function catalog(apps: ReturnType<typeof app>[]) { return JSON.stringify({ schemaVersion: 1, apps }); }
const official = { id: 'official', label: 'Catálogo oficial egdev', kind: 'official' };
let stored: Record<string, unknown>;
let cache: string | null;
let failSave: boolean;
let sequence: number;
let cycle: number;

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
beforeEach(() => {
  vi.setSystemTime(new Date(today));
  stored = { language: 'es', startWithWindows: false, showNewsOnOpen: true, accent: '#ff0036', compact: false, opacity: 85, blur: 24,
    firstRunComplete: true, sources: [official, { id: 'local', label: 'Local', kind: 'local' }] };
  cache = null; failSave = false; sequence = 0; cycle = 0; bridge.listeners.clear(); bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Record<string, unknown> }) => {
    if (command === 'get_settings') return { state: 'ready', settings: structuredClone(stored) };
    if (command === 'save_settings') {
      if (failSave) throw new Error('disco lleno');
      stored = { ...stored, ...args?.patch }; return structuredClone(stored);
    }
    if (command === 'read_catalog_cache') return cache;
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0 };
    if (command === 'plugin:autostart|is_enabled' || command === 'backdrop_available') return false;
    return null;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function start() {
  render(<App />);
  await screen.findByText('Instaladas');
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('read_catalog_cache'));
}
function visibility(visible: boolean) {
  sequence++; if (visible) cycle++;
  act(() => bridge.listeners.get('flyout-visibility')?.({ payload: { visible, sequence, cycle, at: today } }));
}
async function open() { visibility(true); return screen.findByRole('dialog', { name: 'Novedades al abrir' }); }
function titles(dialog: HTMLElement) { return Array.from(dialog.querySelectorAll('.news-slide h3'), node => node.textContent); }
function close() { fireEvent.click(screen.getByRole('button', { name: 'Cerrar novedades' })); }

it('selects only qualifying official events, inclusive boundaries, feature fallbacks and true chronological order', async () => {
  cache = catalog([
    app('recent', '2026-05-01T12:00:00Z', false, [entry('release', '2026-05-02T00:00:00Z'), entry('update', '2026-05-31T13:00:00+02:00', 'update'), entry('future', '2026-06-01T00:00:00Z')]),
    app('old', '2025-01-01T00:00:00Z', false, [entry('old-update', today, 'update')]),
    app('featured', '2025-01-01T00:00:00Z', true, [entry('feature-update', '2026-05-30T00:00:00Z', 'update')]),
    app('outside', '2026-05-01T11:59:59Z'), app('future-app', '2026-06-01T00:00:00Z', true),
    app('synthetic', '2026-05-30T01:00:00Z'),
  ]);
  await start(); const dialog = await open();
  expect(titles(dialog)).toEqual(['update', 'synthetic', 'feature-update', 'release', 'featured']);
  expect(within(dialog).getAllByText('Actualización').length).toBeGreaterThan(0);
  expect(within(dialog).getAllByText('Sin ver')).toHaveLength(4);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  expect(within(dialog).getAllByText('Sin ver')).toHaveLength(3);
  expect(dialog.textContent).not.toMatch(/old-update|future-app|future|outside/);
  expect(dialog.textContent).toMatch(/copia guardada|desactualizada/i);
});

it('starts only on an actual show, freezes the snapshot, and records only slides presented', async () => {
  cache = catalog([app('one', '2026-05-30T00:00:00Z', false, [entry('first', today), entry('second', '2026-05-30T00:00:00Z', 'update'), entry('third', '2026-05-29T00:00:00Z', 'update')])]);
  await start();
  expect(screen.queryByRole('dialog')).toBeNull();
  const dialog = await open(); expect(titles(dialog)).toEqual(['first', 'second', 'third']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  close();
  await waitFor(() => expect(stored).toMatchObject({ newsVisit: { lastVisitAt: today, seenKeys: ['n:one:first', 'n:one:second'] } }));
  fireEvent.focus(window); expect(screen.queryByRole('dialog')).toBeNull();
  visibility(false); const again = await open();
  expect(titles(again)).toEqual(['third']);
});

it('records an actual show that ended before settings finished hydrating', async () => {
  let resolve!: (value: unknown) => void;
  const deferred = new Promise<unknown>(done => { resolve = done; });
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: unknown) => command === 'get_settings' ? deferred : normal(command, args));
  render(<App />);
  await waitFor(() => expect(bridge.listeners.has('flyout-visibility')).toBe(true));
  visibility(true); visibility(false);
  await act(async () => { resolve({ state: 'ready', settings: structuredClone(stored) }); });
  await screen.findByText('Instaladas');
  await waitFor(() => expect(stored.newsVisit).toMatchObject({ lastVisitAt: today, seenKeys: [] }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('recovers the last show time from the native snapshot when subscription started after hide', async () => {
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: unknown) => command === 'get_flyout_state'
    ? { visible: false, sequence: 2, cycle: 1, at: Date.parse(today) + 1000, shownAt: today } : normal(command, args));
  render(<App />); await screen.findByText('Instaladas');
  await waitFor(() => expect(stored.newsVisit).toMatchObject({ lastVisitAt: today, seenKeys: [] }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('records the current slide when hide and the next show arrive in the same React batch', async () => {
  cache = catalog([app('one', '2026-05-30T00:00:00Z', false, [entry('first', today), entry('second', '2026-05-30T00:00:00Z', 'update')])]);
  await start(); await open();
  act(() => {
    bridge.listeners.get('flyout-visibility')?.({ payload: { visible: false, sequence: 2, cycle: 1, at: today } });
    bridge.listeners.get('flyout-visibility')?.({ payload: { visible: true, sequence: 3, cycle: 2, at: today } });
  });
  const dialog = await screen.findByRole('dialog', { name: 'Novedades al abrir' });
  expect(titles(dialog)).toEqual(['second']);
  await waitFor(() => expect((stored.newsVisit as { seenKeys: string[] }).seenKeys).toEqual(['n:one:first']));
});

it('caps each show at ten unseen items without consuming the overflow', async () => {
  cache = catalog(Array.from({ length: 12 }, (_, index) => app(`app-${String(index).padStart(2, '0')}`, today)));
  await start(); const dialog = await open();
  expect(titles(dialog)).toHaveLength(10);
  expect(titles(dialog)[0]).toBe('app-00');
  for (let index = 1; index < 10; index++) fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  close(); await waitFor(() => expect((stored.newsVisit as { seenKeys: string[] }).seenKeys).toHaveLength(10));
  visibility(false); const again = await open(); expect(titles(again)).toEqual(['app-10', 'app-11']);
});

it('keeps the last confirmed marker on save failure and retries the seen keys together with settings', async () => {
  cache = catalog([app('one', today)]); failSave = true;
  await start(); const dialog = await open();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'No mostrar al abrir' })); close();
  expect((await screen.findByRole('alert')).textContent).toMatch(/disco lleno/);
  expect(stored.newsVisit).toBeUndefined(); expect(stored.showNewsOnOpen).toBe(true);
  failSave = false; fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(stored).toMatchObject({ showNewsOnOpen: false, newsVisit: { lastVisitAt: today, seenKeys: ['a:one'] } }));
});

it('opens late cached data only while visible and does not reopen after dismissal on the same show', async () => {
  let resolve!: (value: string) => void;
  const deferred = new Promise<string>(done => { resolve = done; });
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: unknown) => command === 'read_catalog_cache' ? deferred : normal(command, args));
  await start(); visibility(true); expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => { resolve(catalog([app('late', today)])); });
  await screen.findByRole('dialog', { name: 'Novedades al abrir' }); close();
  fireEvent.focus(window); expect(screen.queryByRole('dialog')).toBeNull();
});

it('orders equal instants by typed key and keeps sub-millisecond instants distinct', async () => {
  cache = catalog([app('one', '2026-05-30T00:00:00Z', false, [
    entry('tie-b', '2026-05-31T13:59:00+02:00', 'update'),
    entry('tie-a', '2026-05-31T11:59:00Z'),
    entry('earlier', '2026-05-31T11:59:00.1230001Z', 'update'),
    entry('later', '2026-05-31T11:59:00.1230002Z', 'update'),
  ])]);
  await start(); expect(titles(await open())).toEqual(['later', 'earlier', 'tie-a', 'tie-b']);
});

it('does not consume unseen news while opted out and opens it on a later show after opting in', async () => {
  stored.showNewsOnOpen = false; cache = catalog([app('one', today)]);
  await start(); visibility(true);
  await waitFor(() => expect(stored.newsVisit).toMatchObject({ seenKeys: [] }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Mostrar novedades al abrir' }));
  await waitFor(() => expect(stored.showNewsOnOpen).toBe(true));
  visibility(false); const dialog = await open();
  expect(titles(dialog)).toEqual(['one']);
});

it('keeps a stale cache from pruning keys absent from it', async () => {
  stored.newsVisit = { lastVisitAt: '2026-05-01T00:00:00Z', seenKeys: ['a:removed', 'n:removed:old'] };
  cache = catalog([app('one', today)]);
  await start(); await open(); close();
  await waitFor(() => expect((stored.newsVisit as { seenKeys: string[] }).seenKeys).toEqual(['a:removed', 'n:removed:old', 'a:one']));
});

it('prunes removed keys only after receiving a fresh official catalog and retains synthetic keys for surviving apps', async () => {
  stored.newsVisit = { lastVisitAt: '2026-05-01T00:00:00Z', seenKeys: ['a:one', 'n:one:removed', 'a:removed', 'n:removed:old'] };
  render(<FlyoutPanel apps={[]} news={[]} catalogState={{ status: 'ready' }} validNewsKeys={new Set(['a:one', 'n:one:current'])} />);
  await screen.findByText('Instaladas'); visibility(true);
  await waitFor(() => expect(stored.newsVisit).toMatchObject({ lastVisitAt: today, seenKeys: ['a:one'] }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('navigates from the current slide to the matching catalog card without simulating installation', async () => {
  cache = catalog([app('one', today, false, [entry('first', today), entry('second', today, 'update')])]);
  await start(); const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Ver en el catálogo: second/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('tab', { name: 'Catálogo' }).getAttribute('aria-selected')).toBe('true');
  const target = screen.getByRole('article', { name: 'one' });
  expect(document.activeElement).toBe(target);
  expect(within(target).queryByRole('button', { name: /Instalar/ })).toBeNull();
  expect(within(target).queryByText('Sin ver')).toBeNull();
});

it('focuses an installed official target and reports a disappeared target without substituting a local app', async () => {
  const news = [{ id: 'n:one:first', appId: 'one', badge: 'Nuevo' as const, title: 'first', text: 'Texto', cta: 'Ver en el catálogo' }];
  const installed = { id: 'one', name: 'one', source: 'official' as const, integration: 'local' as const, installed: true, running: false, description: 'Oficial' };
  const view = render(<App apps={[installed]} news={news} />);
  await screen.findByText('Instaladas');
  let dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: /Ver en el catálogo/ }));
  const target = screen.getByRole('article', { name: 'one' });
  expect(document.activeElement).toBe(target);
  expect(within(target).queryByRole('button', { name: /Instalar/ })).toBeNull();
  view.unmount();

  bridge.listeners.clear(); sequence = 0; cycle = 0; stored.newsVisit = null;
  const next = render(<App apps={[installed]} news={news} />);
  await screen.findByText('Instaladas'); dialog = await open();
  next.rerender(<App apps={[{ ...installed, source: 'local', name: 'Otra app' }]} news={news} />);
  fireEvent.click(within(dialog).getByRole('button', { name: /Ver en el catálogo/ }));
  expect(screen.getByRole('alert').textContent).toMatch(/ya no está disponible/);
  expect(screen.queryByRole('article', { name: 'Otra app' })).toBeNull();
});
