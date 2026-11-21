// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import App, { FlyoutPanel } from '../App';
import { parseCatalogV4, projectCatalogV4 } from '../catalog/format';
import { windowsCatalog } from '../test-helpers/catalog-v4';
import { selectOfficialNews } from './selection';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
  bridge.listeners.set(name, callback); return () => bridge.listeners.delete(name);
}) }));
// These tests exercise the unconfigured-endpoint and cache paths without network access;
// fetching from configured endpoints is covered by catalog/loader.test.ts with an injected fetcher.
vi.mock('../catalog/loader', async importOriginal => ({
  ...(await importOriginal<typeof import('../catalog/loader')>()),
  OFFICIAL_CATALOG_URL: undefined,
}));
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
function catalog(apps: ReturnType<typeof app>[]) { return JSON.stringify(windowsCatalog(apps)); }
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
    if (command === 'platform_key') return 'windows-x86_64';
    if (command === 'read_catalog_v4_cache') return cache;
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0 };
    if (command === 'plugin:autostart|is_enabled' || command === 'backdrop_available') return false;
    if (command === 'local_apps_list') return [];
    return null;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function start() {
  render(<App />);
  await screen.findByText('Instaladas');
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('read_catalog_v4_cache'));
}
function visibility(visible: boolean) {
  sequence++; if (visible) cycle++;
  act(() => bridge.listeners.get('flyout-visibility')?.({ payload: { visible, sequence, cycle, at: today } }));
}
async function open() { visibility(true); return screen.findByRole('dialog', { name: 'Novedades' }); }
function titles(dialog: HTMLElement) { return Array.from(dialog.querySelectorAll('.news-slide h3'), node => node.textContent); }
function close() { fireEvent.click(screen.getByRole('button', { name: 'Cerrar novedades' })); }

it('opens the real-shaped v4 updates newest first and navigates both detected and unknown apps', async () => {
  const timestamp = '2026-11-16T12:00:00Z';
  vi.setSystemTime(new Date(timestamp));
  const catalogApp = (id: string, name: string, version: string, date: string, featured: boolean) => ({
    id, name, tagline: `Tag ${name}`, description: `Descripción ${name}`, tags: [],
    iconUrl: `https://egdev6.github.io/nexo-catalog/icons/${id}.png`,
    installerUrl: `https://github.com/egdev6/${id}/releases/download/v${version}/setup.exe`,
    latestJsonUrl: `https://github.com/egdev6/${id}/releases/download/v${version}/latest.json`,
    integrationLevel: 'update', releasedAt: date, featured, version,
    news: [{ id: `v${version.replaceAll('.', '-')}`, title: `${name} ${version}`, text: `A new ${name} release is available.`, publishedAt: date, kind: 'update' }],
  });
  cache = JSON.stringify(windowsCatalog([
    { ...catalogApp('antena', 'Antena', '0.15.0', '2026-11-14T08:48:36Z', true), detection: { windows: { displayName: 'antena', publisher: 'EGDEV', executableRelativePath: 'antena.exe' } } },
    catalogApp('quorb', 'Quorb', '0.8.0', '2026-10-28T14:55:56Z', false),
  ]));
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: unknown) => command === 'installed_apps' ? [
    { id: 'antena', state: 'installed', version: '0.15.0', reason: 'Instalación detectada', canOpen: true },
    { id: 'quorb', state: 'unknown', version: null, reason: 'Sin datos de detección en el catálogo' },
  ] : invoke(command, args));
  render(<App />);
  await screen.findByRole('button', { name: 'Abrir Antena' });
  expect(bridge.invoke).toHaveBeenCalledWith('installed_apps');
  expect(screen.queryByRole('button', { name: 'Abrir Quorb' })).toBeNull();
  act(() => bridge.listeners.get('flyout-visibility')?.({ payload: { visible: true, sequence: 1, cycle: 1, at: timestamp } }));
  const dialog = await screen.findByRole('dialog', { name: 'Novedades' });
  const region = within(dialog).getByRole('region', { name: 'Últimas novedades' });
  const groups = within(region).getAllByRole('group', { hidden: true }).filter(group => group.getAttribute('aria-roledescription') === 'diapositiva');
  expect(groups).toHaveLength(2);
  function visible(index: number) {
    const title = index ? 'Quorb 0.8.0' : 'Antena 0.15.0';
    expect(groups[index].getAttribute('aria-current')).toBe('true');
    expect(groups[index].querySelector('article')!.hasAttribute('inert')).toBe(false);
    expect(groups[1 - index].querySelector('article')!.getAttribute('aria-hidden')).toBe('true');
    expect(groups[1 - index].querySelector('article')!.hasAttribute('inert')).toBe(true);
    expect(within(dialog).getByRole('group', { name: `${index + 1} de 2: ${title}` })).toBe(groups[index]);
    expect(within(groups[index]).getByRole('heading', { name: title })).toBeTruthy();
    expect(dialog.textContent).toContain(index ? '02 / 02' : '01 / 02');
    expect(within(dialog).getByRole('button', { name: /Ver en el catálogo:/ }).getAttribute('data-app-id')).toBe(index ? 'quorb' : 'antena');
  }
  visible(0);
  const next = within(dialog).getByRole('button', { name: 'Diapositiva siguiente' });
  next.focus(); fireEvent.click(next); visible(1);
  const previous = within(dialog).getByRole('button', { name: 'Diapositiva anterior' });
  previous.focus(); fireEvent.click(previous); visible(0);
  fireEvent.keyDown(region, { key: 'End' }); visible(1);
  fireEvent.keyDown(region, { key: 'Home' }); visible(0);
  groups[0].focus(); fireEvent.keyDown(groups[0], { key: 'ArrowRight' }); visible(1);
  fireEvent.keyDown(groups[1], { key: 'ArrowLeft' }); visible(0);
});

it('selects only qualifying official events, inclusive boundaries, feature fallbacks and true chronological order', async () => {
  cache = catalog([
    app('recent', '2026-05-01T12:00:00Z', false, [entry('previous', '2026-05-02T00:00:00Z'), entry('update', '2026-05-31T13:00:00+02:00', 'update'), entry('future', '2026-06-01T00:00:00Z')]),
    app('release-app', '2026-05-01T12:00:00Z', false, [entry('release', '2026-05-02T00:00:00Z')]),
    app('old', '2025-01-01T00:00:00Z', false, [entry('old-update', today, 'update')]),
    app('featured', '2025-01-01T00:00:00Z', true, [entry('feature-update', '2026-05-30T00:00:00Z', 'update')]),
    app('outside', '2026-05-01T11:59:59Z'), app('future-app', '2026-06-01T00:00:00Z', true),
    app('synthetic', '2026-05-30T01:00:00Z'),
  ]);
  await start(); const dialog = await open();
  expect(titles(dialog)).toEqual(['update', 'synthetic', 'feature-update', 'release']);
  expect(within(dialog).getAllByText('Actualización').length).toBeGreaterThan(0);
  expect(within(dialog).getAllByText('Sin ver')).toHaveLength(3);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  expect(within(dialog).getAllByText('Sin ver')).toHaveLength(2);
  expect(dialog.textContent).not.toMatch(/previous|old-update|future-app|future|outside/);
  expect(dialog.textContent).toMatch(/copia guardada|desactualizada/i);
});

it('shows the two real updates of two apps without adding synthetic release slides', async () => {
  cache = catalog([
    { ...app('alpha', '2026-05-29T00:00:00Z', false, [entry('alpha-update', '2026-05-31T11:00:00Z', 'update')]), name: 'Álfa' },
    { ...app('beta', '2026-05-29T00:00:00Z', true, [entry('beta-update', '2026-05-30T11:00:00Z', 'update')]), name: 'Beta' },
  ]);
  await start(); const dialog = await open();
  expect(titles(dialog)).toEqual(['alpha-update', 'beta-update']);
  expect(dialog.textContent).toContain('01 / 02');
  expect(within(dialog).queryByRole('button', { name: /^Ir a / })).toBeNull();
  expect(within(dialog).getByRole('progressbar', { hidden: true }).getAttribute('aria-valuenow')).toBe('50');
  const first = within(dialog).getByRole('group', { name: '1 de 2: alpha-update' });
  const hero = first.querySelector('.news-hero')!;
  const image = hero.querySelector('img');
  expect(image?.getAttribute('src')).toBe('https://egdev6.github.io/nexo-catalog/banners/alpha.webp');
  fireEvent.error(image!);
  expect(hero.textContent).toBe('Á');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  expect(dialog.textContent).toContain('02 / 02');
  expect(within(dialog).getByRole('progressbar', { hidden: true }).getAttribute('aria-valuenow')).toBe('100');
  close();
  await waitFor(() => expect((stored.newsVisit as { seenKeys: string[] }).seenKeys).toEqual(['n:alpha:alpha-update', 'n:beta:beta-update']));
});

it('starts only on an actual show, freezes the snapshot, and records only slides presented', async () => {
  cache = catalog([
    app('one', '2026-05-30T00:00:00Z', false, [entry('first', today)]),
    app('two', '2026-05-30T00:00:00Z', false, [entry('second', '2026-05-30T00:00:00Z', 'update')]),
    app('three', '2026-05-30T00:00:00Z', false, [entry('third', '2026-05-29T00:00:00Z', 'update')]),
  ]);
  await start();
  expect(screen.queryByRole('dialog')).toBeNull();
  const dialog = await open(); expect(titles(dialog)).toEqual(['first', 'second', 'third']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  close();
  await waitFor(() => expect(stored).toMatchObject({ newsVisit: { lastVisitAt: today, seenKeys: ['n:one:first', 'n:two:second'] } }));
  fireEvent.focus(window); expect(screen.queryByRole('dialog')).toBeNull();
  visibility(false); const again = await open();
  expect(titles(again)).toEqual(['first', 'second', 'third']);
  expect(within(again).getAllByText('Sin ver')).toHaveLength(1);
});

it.each(['scrim', 'Escape', 'close', 'catalog'] as const)('clears background blur and records viewed news on %s', async method => {
  cache = catalog([
    app('one', '2026-05-30T00:00:00Z', false, [entry('first', today)]),
    app('two', '2026-05-30T00:00:00Z', false, [entry('second', '2026-05-30T00:00:00Z', 'update')]),
    app('three', '2026-05-30T00:00:00Z', false, [entry('third', '2026-05-29T00:00:00Z', 'update')]),
  ]);
  await start();
  const panel = screen.getByRole('main');
  expect(panel.hasAttribute('data-news-open')).toBe(false);
  const dialog = await open();
  expect(panel.hasAttribute('data-news-open')).toBe(true);
  expect(titles(dialog)).toEqual(['first', 'second', 'third']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  if (method === 'scrim') {
    const scrim = dialog.closest('.eg-dialog-backdrop');
    expect(scrim).toBeTruthy();
    await new Promise(resolve => setTimeout(resolve, 0));
    fireEvent.pointerDown(scrim!, { button: 0, pointerType: 'mouse' });
    fireEvent.click(scrim!);
  } else if (method === 'Escape') {
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' });
    expect(bridge.invoke).not.toHaveBeenCalledWith('hide_flyout');
  } else if (method === 'catalog') {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ver en el catálogo: second' }));
  } else close();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(panel.hasAttribute('data-news-open')).toBe(false);
  await waitFor(() => expect(stored.newsVisit).toMatchObject({ lastVisitAt: today, seenKeys: ['n:one:first', 'n:two:second'] }));
  if (method === 'Escape') {
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(bridge.invoke).toHaveBeenCalledWith('hide_flyout');
  }
});

it('freezes the selected catalog news until the next show when the selection changes', async () => {
  const first = entry('first', '2026-05-31T11:00:00Z');
  const second = app('two', '2026-05-30T00:00:00Z', false, [entry('second', '2026-05-30T00:00:00Z', 'update')]);
  const select = (apps: ReturnType<typeof app>[]) => selectOfficialNews(projectCatalogV4(parseCatalogV4(JSON.parse(catalog(apps))), 'windows-x86_64'), Date.parse(today)).items;
  const initial = select([app('one', '2026-05-30T00:00:00Z', false, [first]), second]);
  const changed = select([
    app('one', '2026-05-30T00:00:00Z', false, [first, entry('replacement', '2026-05-31T11:30:00Z', 'update')]),
    second,
    app('three', '2026-05-30T00:00:00Z', false, [entry('third', '2026-05-31T10:00:00Z')]),
  ]);
  const view = render(<FlyoutPanel apps={[]} news={initial} />);
  await screen.findByText('Instaladas');
  await waitFor(() => expect(bridge.listeners.has('flyout-visibility')).toBe(true));
  const dialog = await open();
  expect(titles(dialog)).toEqual(['first', 'second']);
  view.rerender(<FlyoutPanel apps={[]} news={changed} />);
  expect(titles(dialog)).toEqual(['first', 'second']);
  visibility(false);
  await waitFor(() => expect((stored.newsVisit as { seenKeys: string[] }).seenKeys).toEqual(['n:one:first']));
  expect(titles(await open())).toEqual(['replacement', 'third', 'second']);
});

it('reopens already-seen news on each native show, not on focus or dismissal', async () => {
  stored.newsVisit = { lastVisitAt: '2026-05-30T00:00:00Z', seenKeys: ['a:one'] };
  cache = catalog([app('one', today)]);
  await start();
  const first = await open();
  expect(titles(first)).toEqual(['one']);
  expect(within(first).queryByText('Sin ver')).toBeNull();
  close(); fireEvent.focus(window);
  expect(screen.queryByRole('dialog')).toBeNull();
  visibility(false);
  expect(titles(await open())).toEqual(['one']);
  close();
  await waitFor(() => expect((stored.newsVisit as { seenKeys: string[] }).seenKeys).toEqual(['a:one']));
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
  cache = catalog([
    app('one', '2026-05-30T00:00:00Z', false, [entry('first', today)]),
    app('two', '2026-05-30T00:00:00Z', false, [entry('second', '2026-05-30T00:00:00Z', 'update')]),
  ]);
  await start(); await open();
  act(() => {
    bridge.listeners.get('flyout-visibility')?.({ payload: { visible: false, sequence: 2, cycle: 1, at: today } });
    bridge.listeners.get('flyout-visibility')?.({ payload: { visible: true, sequence: 3, cycle: 2, at: today } });
  });
  const dialog = await screen.findByRole('dialog', { name: 'Novedades' });
  expect(titles(dialog)).toEqual(['first', 'second']);
  expect(within(dialog).getAllByText('Sin ver')).toHaveLength(1);
  await waitFor(() => expect((stored.newsVisit as { seenKeys: string[] }).seenKeys).toEqual(['n:one:first']));
});

it('caps each show at the same four latest items and does not consume overflow', async () => {
  cache = catalog(Array.from({ length: 12 }, (_, index) => app(`app-${String(index).padStart(2, '0')}`, today)));
  await start(); const dialog = await open();
  expect(titles(dialog)).toEqual(['app-00', 'app-01', 'app-02', 'app-03']);
  for (let index = 1; index < 4; index++) fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  close(); await waitFor(() => expect((stored.newsVisit as { seenKeys: string[] }).seenKeys).toEqual(['a:app-00', 'a:app-01', 'a:app-02', 'a:app-03']));
  visibility(false); const again = await open(); expect(titles(again)).toEqual(['app-00', 'app-01', 'app-02', 'app-03']);
  expect(within(again).queryByText('Sin ver')).toBeNull();
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
  bridge.invoke.mockImplementation(async (command: string, args?: unknown) => command === 'read_catalog_v4_cache' ? deferred : normal(command, args));
  await start(); visibility(true); expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => { resolve(catalog([app('late', today)])); });
  await screen.findByRole('dialog', { name: 'Novedades' }); close();
  fireEvent.focus(window); expect(screen.queryByRole('dialog')).toBeNull();
});

it('orders equal instants by typed key and keeps sub-millisecond instants distinct', async () => {
  cache = catalog([
    app('tie-b-app', '2026-05-30T00:00:00Z', false, [entry('tie-b', '2026-05-31T13:59:00+02:00', 'update')]),
    app('tie-a-app', '2026-05-30T00:00:00Z', false, [entry('tie-a', '2026-05-31T11:59:00Z')]),
    app('earlier-app', '2026-05-30T00:00:00Z', false, [entry('earlier', '2026-05-31T11:59:00.1230001Z', 'update')]),
    app('later-app', '2026-05-30T00:00:00Z', false, [entry('later', '2026-05-31T11:59:00.1230002Z', 'update')]),
  ]);
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
  cache = catalog([
    app('one', today, false, [entry('first', today)]),
    app('two', today, false, [entry('second', today, 'update')]),
  ]);
  await start(); const dialog = await open();
  expect(titles(dialog)).toEqual(['first', 'second']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  const cta = within(dialog).getByRole('button', { name: /Ver en el catálogo: second/ });
  expect(cta.getAttribute('data-app-id')).toBe('two');
  fireEvent.click(cta);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('tab', { name: 'Catálogo' }).getAttribute('aria-selected')).toBe('true');
  const target = screen.getByRole('article', { name: 'two' });
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
