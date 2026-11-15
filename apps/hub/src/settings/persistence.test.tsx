// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import HubApp from '../App';
import { sampleApps, sampleNews } from '../sample';

// Settings tests use explicit fixtures; the native App otherwise loads the official catalog.
const App = () => <HubApp apps={sampleApps} news={sampleNews} />;

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), tauri: true, onQuit: null as null | ((event?: { payload: string }) => Promise<void>) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => bridge.tauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide: vi.fn().mockResolvedValue(undefined) }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event?: { payload: string }) => Promise<void>) => {
  if (name !== 'quit-requested') return () => {};
  bridge.onQuit = callback; return () => { bridge.onQuit = null; };
}) }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));

const official = { id: 'official', label: 'Catálogo oficial egdev', kind: 'official' };
const initial = { language: 'es', startWithWindows: false, showNewsOnOpen: true, accent: '#ff0036', compact: false, opacity: 85, blur: 24, firstRunComplete: false, sources: [official] };
let stored: typeof initial;
let enabled: boolean;
let failSave: boolean;
let failRead: boolean;
let mismatch: boolean;
let load: Promise<unknown> | null;
let state: string;
let visible: boolean;

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
beforeEach(() => {
  stored = structuredClone(initial); enabled = false; failSave = false; failRead = false; mismatch = false; load = null; state = 'missing'; visible = false; bridge.onQuit = null;
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof initial> }) => {
    if (command === 'get_settings') return load ?? { settings: stored, state };
    if (command === 'local_apps_list') return [];
    if (command === 'local_catalog_refresh') return { sourceId: 'local-1', entries: [] };
    if (command === 'get_flyout_state') return { visible, sequence: visible ? 1 : 0, cycle: visible ? 1 : 0, at: Date.now() };
    if (command === 'save_settings') {
      if (failSave) throw new Error('disco lleno');
      stored = { ...stored, ...args?.patch };
      return stored;
    }
    if (command === 'recover_settings') { state = 'ready'; stored = structuredClone(initial); return stored; }
    if (command === 'plugin:autostart|is_enabled') { if (failRead) throw new Error('sistema no disponible'); return enabled; }
    if (command === 'plugin:autostart|enable') { if (!mismatch) enabled = true; return; }
    if (command === 'plugin:autostart|disable') { if (!mismatch) enabled = false; return; }
    if (command === 'backdrop_available') return false;
    if (command === 'apply_saved_language') return;
    if (command === 'quit_after_settings' || command === 'hub_only_exit') return;
    throw new Error(`unexpected command: ${command}`);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function tab(name: string) {
  const element = screen.getByRole('tab', { name });
  fireEvent.mouseDown(element, { button: 0 }); fireEvent.click(element);
}
async function openSettings() {
  const close = screen.queryByRole('button', { name: 'Cerrar novedades' });
  if (close) fireEvent.click(close);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
}

it('hydrates before onboarding or news can act', async () => {
  let resolve!: (value: unknown) => void;
  load = new Promise(done => { resolve = done; });
  render(<App />);
  expect(bridge.invoke).toHaveBeenCalledWith('get_settings');
  expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  resolve({ settings: stored, state: 'missing' });
  expect(await screen.findByRole('button', { name: 'Continuar' })).toBeTruthy();
});

it('completes onboarding only after the language and flag are saved, with retry on failure', async () => {
  failSave = true;
  render(<App />);
  fireEvent.click(await screen.findByRole('radio', { name: 'English' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/disco lleno/i);
  expect(screen.queryByText('Instaladas')).toBeNull();
  expect(stored.firstRunComplete).toBe(false);
  failSave = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Installed')).toBeTruthy();
  expect(stored.language).toBe('en');
  expect(stored.firstRunComplete).toBe(true);
});

it('restores appearance, skips onboarding and preserves configured sources', async () => {
  stored = { ...stored, firstRunComplete: true, showNewsOnOpen: false, accent: '#3b82f6', compact: true, opacity: 0, blur: 40,
    sources: [official, { id: 'local-1', label: 'Trabajo', kind: 'local' }] };
  render(<App />);
  expect(await screen.findByText('Instaladas')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  const main = screen.getByRole('main');
  expect(main.style.getPropertyValue('--hub-accent')).toBe('#3b82f6');
  expect(main.style.getPropertyValue('--hub-density')).toBe('0.8');
  expect(main.style.getPropertyValue('--hub-opacity')).toBe('0');
  expect(main.style.getPropertyValue('--hub-blur')).toBe('40px');
  await openSettings(); tab('Apps locales');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Añadir app' }).hasAttribute('disabled')).toBe(false));
  expect(screen.queryByText('Catálogo oficial egdev')).toBeNull();
  expect(screen.queryByText('Trabajo')).toBeNull();
  expect(stored.sources).toEqual([official, { id: 'local-1', label: 'Trabajo', kind: 'local' }]);
});

it('persists the popup opt-out and shares it with settings after a restart', async () => {
  stored.firstRunComplete = true; visible = true;
  const { unmount } = render(<App />);
  const dialog = await screen.findByRole('dialog', { name: 'Novedades al abrir' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'No mostrar al abrir' }));
  await waitFor(() => expect(stored.showNewsOnOpen).toBe(false));
  unmount(); render(<App />);
  expect(await screen.findByText('Instaladas')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  await openSettings();
  expect(screen.getByRole('switch', { name: 'Mostrar novedades al abrir' }).getAttribute('aria-checked')).toBe('false');
});

it('reports an unreadable configuration and requires explicit recovery', async () => {
  state = 'corrupt';
  render(<App />);
  expect((await screen.findByRole('alert')).textContent).toMatch(/ajustes/i);
  expect(bridge.invoke).not.toHaveBeenCalledWith('save_settings', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: /recuperar/i }));
  expect(await screen.findByRole('button', { name: 'Continuar' })).toBeTruthy();
  expect(bridge.invoke).toHaveBeenCalledWith('recover_settings');
});

it('confirms autostart from OS readback before persisting', async () => {
  stored.firstRunComplete = true; stored.showNewsOnOpen = false;
  render(<App />); await openSettings();
  const toggle = await screen.findByRole('switch', { name: 'Iniciar con Windows' });
  await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
  fireEvent.click(toggle);
  await waitFor(() => expect(stored.startWithWindows).toBe(true));
  expect(enabled).toBe(true);
  expect(bridge.invoke).toHaveBeenCalledWith('plugin:autostart|enable');
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'plugin:autostart|is_enabled').length).toBeGreaterThanOrEqual(2);
});

it('disables autostart and confirms the OS state before saving', async () => {
  stored.firstRunComplete = true; stored.showNewsOnOpen = false; stored.startWithWindows = true; enabled = true;
  render(<App />); await openSettings();
  const toggle = screen.getByRole('switch', { name: 'Iniciar con Windows' });
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(toggle);
  await waitFor(() => expect(stored.startWithWindows).toBe(false));
  expect(enabled).toBe(false);
  expect(bridge.invoke).toHaveBeenCalledWith('plugin:autostart|disable');
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'plugin:autostart|is_enabled').length).toBeGreaterThanOrEqual(2);
});

it('leaves autostart unknown when OS readback fails', async () => {
  stored.firstRunComplete = true; stored.showNewsOnOpen = false;
  const normalInvoke = bridge.invoke.getMockImplementation()!;
  let reads = 0;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof initial> }) => {
    if (command === 'plugin:autostart|is_enabled' && ++reads > 1) throw new Error('lectura fallida');
    return normalInvoke(command, args);
  });
  render(<App />); await openSettings();
  const toggle = screen.getByRole('switch', { name: 'Iniciar con Windows' });
  await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
  fireEvent.click(toggle);
  expect((await screen.findByRole('alert')).textContent).toMatch(/lectura fallida/i);
  expect(toggle.hasAttribute('disabled')).toBe(true);
  expect(stored.startWithWindows).toBe(false);
});

it('serializes rapid independent changes without restoring a stale snapshot', async () => {
  stored.firstRunComplete = true; stored.showNewsOnOpen = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const normalInvoke = bridge.invoke.getMockImplementation()!;
  let firstSave = true;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof initial> }) => {
    if (command === 'save_settings' && firstSave) { firstSave = false; await gate; }
    return normalInvoke(command, args);
  });
  render(<App />); await openSettings();
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(firstSave).toBe(false));
  fireEvent.click(screen.getByRole('switch', { name: 'Mostrar novedades al abrir' }));
  release();
  await waitFor(() => expect(stored).toMatchObject({ language: 'en', showNewsOnOpen: true }));
  expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe('true');
});

it('reconciles an external autostart change and allows retry after a failed read', async () => {
  stored.firstRunComplete = true; stored.showNewsOnOpen = false; stored.startWithWindows = true; failRead = true;
  render(<App />); await openSettings();
  expect((await screen.findByRole('alert')).textContent).toMatch(/inicio/i);
  expect(screen.getByRole('switch', { name: 'Iniciar con Windows' }).hasAttribute('disabled')).toBe(true);
  failRead = false;
  fireEvent.click(screen.getByRole('button', { name: /Reintentar inicio automático/i }));
  await waitFor(() => expect(stored.startWithWindows).toBe(false));
  enabled = true;
  fireEvent.focus(window);
  await waitFor(() => expect(stored.startWithWindows).toBe(true));
  expect(screen.getByRole('switch', { name: 'Iniciar con Windows' }).getAttribute('aria-checked')).toBe('true');
});

it('does not quit or lose the pending edit when its save fails', async () => {
  stored.firstRunComplete = true; stored.showNewsOnOpen = false;
  render(<App />); await openSettings();
  failSave = true;
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(bridge.onQuit).not.toBeNull());
  await act(async () => { await bridge.onQuit?.(); });
  expect(bridge.invoke).not.toHaveBeenCalledWith('quit_after_settings');
  expect(stored.language).toBe('es');
  expect((await screen.findByRole('alert')).textContent).toMatch(/no se pudieron guardar/i);
  failSave = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(stored.language).toBe('en'));
  await act(async () => { await bridge.onQuit?.(); });
  expect(bridge.invoke).toHaveBeenCalledWith('quit_after_settings');
});

it('flushes pending settings before a tray-requested hub-only exit', async () => {
  stored.firstRunComplete = true; stored.showNewsOnOpen = false;
  render(<App />); await openSettings();
  failSave = true;
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(bridge.onQuit).not.toBeNull());
  await act(async () => { await bridge.onQuit?.({ payload: 'hub-only' }); });
  expect(bridge.invoke).not.toHaveBeenCalledWith('hub_only_exit');
  expect(bridge.invoke).not.toHaveBeenCalledWith('quit_after_settings');
  expect(stored.language).toBe('es');
  failSave = false;
  await act(async () => { await bridge.onQuit?.({ payload: 'hub-only' }); });
  expect(stored.language).toBe('en');
  expect(bridge.invoke).toHaveBeenCalledWith('hub_only_exit');
});

it.each([
  ['es', 'Ajustes', 'English', 'Las fuentes locales deben cambiarse mediante la selección nativa.'],
  ['en', 'Settings', 'Español', 'Local sources must be changed using native selection.'],
])('localizes a rejected source change in %s without saving', async (language, settingsLabel, choice, message) => {
  stored.language = language; stored.firstRunComplete = true; stored.showNewsOnOpen = false;
  const normalInvoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof initial> }) => {
    if (command === 'save_settings') throw 'nexo.config.sourceSelectionRequired';
    return normalInvoke(command, args);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: settingsLabel }));
  fireEvent.click(screen.getByRole('radio', { name: choice }));
  expect((await screen.findByRole('alert')).textContent).toContain(message);
  expect(stored.language).toBe(language);
});

it('shows a retryable autostart error instead of confirming a mismatch', async () => {
  stored.firstRunComplete = true; stored.showNewsOnOpen = false; mismatch = true;
  render(<App />); await openSettings();
  const toggle = await screen.findByRole('switch', { name: 'Iniciar con Windows' });
  await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false));
  fireEvent.click(toggle);
  expect((await screen.findByRole('alert')).textContent).toMatch(/inicio|sistema/i);
  expect(stored.startWithWindows).toBe(false);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(screen.getByRole('button', { name: /reintentar/i })).toBeTruthy();
});
