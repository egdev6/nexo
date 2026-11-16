// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import nexoLogo from '../src-tauri/app-icon.svg';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CatalogViewProps, FirstRunProps, NewsPopupProps, SettingsViewProps } from './model';
import { backdropAvailable, hideFlyout } from './window';
import { exitHubOnly, subscribeRegistry } from './shell/registry';
import type { RegistrySnapshot } from './shell/registry';
import { defaultSettings } from './sample';
import fullCatalog from '../../../crates/nexo-catalog/fixtures/full.json';

// Test the shell's public wiring independently of the other area writers.
vi.mock('./local-apps/view', () => ({ LocalAppsView: () => null }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn().mockResolvedValue(null),
}));
// These tests exercise the unconfigured-endpoint and cache paths without network access;
// fetching from configured endpoints is covered by catalog/loader.test.ts with an injected fetcher.
vi.mock('./catalog/loader', async importOriginal => ({
  ...(await importOriginal<typeof import('./catalog/loader')>()),
  OFFICIAL_CATALOG_URL: undefined,
  OFFICIAL_CATALOG_V2_URL: undefined,
  OFFICIAL_CATALOG_V3_URL: undefined,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('./catalog', () => ({
  CatalogView: ({ apps, state, onRetry }: CatalogViewProps) => <div>Catálogo de prueba: {apps.map(app => app.name).join(', ')}{state && <span>Estado catálogo: {state}</span>}{onRetry && <button onClick={onRetry}>Reintentar catálogo</button>}</div>,
}));
vi.mock('./first-run', () => ({
  FirstRun: ({ onChoose }: FirstRunProps) => <section aria-label="Idioma"><button onClick={() => onChoose('es')}>Español</button><button onClick={() => onChoose('en')}>English</button></section>,
}));
vi.mock('./news', () => ({
  NewsPopup: ({ items, open, onClose, dontShow, onDontShowChange }: NewsPopupProps) => open ? <div role="dialog" aria-label="Novedades">
    <p>{items.map(item => item.title).join(' / ')}</p>
    <label><input type="checkbox" checked={dontShow} onChange={event => onDontShowChange(event.target.checked)} />No mostrar al abrir</label>
    <button onClick={onClose}>Cerrar novedades</button>
  </div> : null,
}));
vi.mock('./settings', () => ({
  SettingsView: ({ settings, onChange, onClose }: SettingsViewProps) => <section aria-label="Ajustes">
    <p>Idioma: {settings.language}</p>
    <button onClick={() => onChange({ ...settings, accent: '#3b82f6', compact: true, opacity: 63, blur: 12 })}>Cambiar apariencia</button>
    <button onClick={() => onChange({ ...settings, showNewsOnOpen: !settings.showNewsOnOpen })}>Alternar novedades</button>
    <button onClick={onClose}>Volver</button>
  </section>,
}));
vi.mock('./shell/registry', () => ({
  subscribeRegistry: vi.fn().mockResolvedValue(() => {}),
  exitHubOnly: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./window', () => ({
  backdropAvailable: vi.fn().mockResolvedValue(false),
  hideFlyout: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(false);
  let saved = { ...defaultSettings, firstRunComplete: false,
    sources: [{ id: 'official', label: 'Catálogo oficial egdev', kind: 'official' }] };
  vi.mocked(invoke).mockImplementation(((command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'missing', settings: saved });
    if (command === 'save_settings') { saved = { ...saved, ...args?.patch }; return Promise.resolve(saved); }
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    return Promise.resolve(null);
  }) as typeof invoke);
  vi.mocked(subscribeRegistry).mockResolvedValue(() => {});
  vi.mocked(exitHubOnly).mockResolvedValue(undefined);
});

function enter(language: 'Español' | 'English' = 'Español') {
  const choice = screen.queryByRole('button', { name: language });
  if (choice) fireEvent.click(choice);
}
function closeNews() {
  const close = screen.queryByRole('button', { name: 'Cerrar novedades' });
  if (close) fireEvent.click(close);
}
function expandRow(name: string) {
  const card = screen.getByText(name).closest('.app-card') as HTMLElement;
  const trigger = within(card).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!;
  if (trigger.getAttribute('aria-expanded') === 'false') fireEvent.click(trigger);
  return trigger;
}

it('renders the Nexo logo in the flyout header without changing its controls', () => {
  render(<App news={[]} />);
  const heading = screen.getByRole('heading', { name: 'Nexo' });
  const header = heading.closest('header')!;
  const mark = header.querySelector('img');
  expect(mark?.getAttribute('src')).toBe(nexoLogo);
  expect(mark?.getAttribute('alt')).toBe('');
  expect(within(header).getByRole('button', { name: 'Cerrar panel' })).toBeTruthy();
});

it('loads the native catalog without treating samples or unknown installation as real', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Español' }));
  expect(await screen.findByText('Estado de instalación no disponible todavía.')).toBeTruthy();
  expect(screen.queryByText('Antena')).toBeNull();
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ver catálogo' }));
  await waitFor(() => expect(screen.getByText('Estado catálogo: error')).toBeTruthy());
  expect(invoke).toHaveBeenCalledWith('read_catalog_cache');
});

it('shows actual installed and absent observations with a registry version and unknown running state', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const first = { ...fullCatalog.apps[0], detection: { windows: { displayName: 'Example App', publisher: 'Example Publisher', executableRelativePath: 'Example.exe' } } };
  const second = { ...first, id: 'other-app', name: 'Other App' };
  const catalog = JSON.stringify({ schemaVersion: 2, apps: [first, second] });
  vi.mocked(invoke).mockImplementation(((command: string) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, sources: [] } });
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    if (command === 'read_catalog_v2_cache') return Promise.resolve(catalog);
    if (command === 'installed_apps') return Promise.resolve([
      { id: 'example-app', state: 'installed', version: '9.1.0', reason: 'Instalación detectada' },
      { id: 'other-app', state: 'notInstalled', version: null, reason: 'Sin coincidencias' },
    ]);
    return Promise.resolve(null);
  }) as typeof invoke);
  render(<App />);
  await screen.findByText('Example App');
  expandRow('Example App');
  expect(screen.getByText('9.1.0')).toBeTruthy();
  expect(screen.queryByText('Other App')).toBeNull();
  expect(screen.getByText(/Estado de ejecución desconocido/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cerrar Example App' })).toBeNull();
  expect(screen.getByText(/1 instalada/)).toBeTruthy();
  const scans = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'installed_apps').length;
  fireEvent.focus(window);
  await waitFor(() => expect(scans()).toBe(2));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar apps' }));
  await waitFor(() => expect(scans()).toBe(3));
});

it('ignores an older installation scan that resolves after a newer refresh', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const app = { ...fullCatalog.apps[0], detection: { windows: { displayName: 'Example App', publisher: 'Example Publisher', executableRelativePath: 'Example.exe' } } };
  let finishFirst!: (result: unknown) => void;
  let scans = 0;
  vi.mocked(invoke).mockImplementation(((command: string) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, sources: [] } });
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    if (command === 'read_catalog_v2_cache') return Promise.resolve(JSON.stringify({ schemaVersion: 2, apps: [app] }));
    if (command === 'installed_apps') {
      if (++scans === 1) return new Promise<unknown>(resolve => { finishFirst = resolve; });
      return Promise.resolve([{ id: 'example-app', state: 'installed', version: '9.1.0', reason: 'Instalación detectada' }]);
    }
    return Promise.resolve(null);
  }) as typeof invoke);
  render(<App />);
  await waitFor(() => expect(finishFirst).toBeTypeOf('function'));
  fireEvent.focus(window);
  await screen.findByText('Example App');
  expandRow('Example App');
  expect(screen.getByText('9.1.0')).toBeTruthy();
  await act(async () => finishFirst([{ id: 'example-app', state: 'notInstalled', version: null, reason: 'Sin coincidencias' }]));
  expect(screen.getByText('9.1.0')).toBeTruthy();
});

it('routes a connected plugin close through IPC, reports refusal, and refreshes without claiming exit', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  let publish!: (snapshot: RegistrySnapshot) => void;
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return () => {}; });
  const app = { ...fullCatalog.apps[0], detection: { windows: { displayName: 'Example App', publisher: 'Example Publisher', executableRelativePath: 'Example.exe' } } };
  vi.mocked(invoke).mockImplementation(((command: string) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, sources: [] } });
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    if (command === 'read_catalog_v2_cache') return Promise.resolve(JSON.stringify({ schemaVersion: 2, apps: [app] }));
    if (command === 'installed_apps') return Promise.resolve([{ id: 'example-app', state: 'installed', version: '9.1.0', reason: 'Instalación detectada' }]);
    if (command === 'close_connected_app') return Promise.reject('Cambios sin guardar');
    return Promise.resolve(null);
  }) as typeof invoke);
  render(<App />);
  await screen.findByText('Example App');
  act(() => publish({ revision: 1, apps: [{ app: { id: 'example-app', name: 'Example App', version: '2.0.0' }, capabilities: ['show', 'quit'], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  expandRow('Example App');
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar Example App' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Cambios sin guardar');
  expect(invoke).toHaveBeenCalledWith('close_connected_app', { id: 'example-app' });
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'installed_apps').length).toBe(2));
  expect(screen.getByText('Conectada')).toBeTruthy();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => /kill|terminate/i.test(command))).toBe(false);
});

it('opens only a resolved official installed app by ID, reports the request, and refreshes', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const refresh = vi.fn();
  vi.mocked(invoke).mockImplementation(((command: string) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, sources: [] } });
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    if (command === 'open_official_app') return Promise.resolve('Inicio solicitado; no hay confirmación de ejecución');
    return Promise.resolve(null);
  }) as typeof invoke);
  const app = { id: 'example-app', name: 'Example App', installed: true, running: false, integration: 'local' as const, source: 'official' as const, statusKnown: true, installationState: 'installed' as const, runningState: 'unknown' as const, canOpen: true, description: 'Example' };
  render(<App apps={[app]} news={[]} catalogState={{ status: 'ready' }} onAppsRefresh={refresh} />);
  const open = await screen.findByRole('button', { name: 'Abrir Example App' });
  expect((open as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(open);
  expect(await screen.findByText('Inicio solicitado; no hay confirmación de ejecución')).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith('open_official_app', { id: 'example-app' });
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.getByText(/Estado de ejecución desconocido/)).toBeTruthy();
});

it('keeps installation unknown on scan failure instead of claiming absence', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  const app = { ...fullCatalog.apps[0], detection: { windows: { displayName: 'Example App', publisher: 'Example Publisher', executableRelativePath: 'Example.exe' } } };
  vi.mocked(invoke).mockImplementation(((command: string) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, sources: [] } });
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    if (command === 'read_catalog_v2_cache') return Promise.resolve(JSON.stringify({ schemaVersion: 2, apps: [app] }));
    if (command === 'installed_apps') return Promise.reject('denied');
    return Promise.resolve(null);
  }) as typeof invoke);
  render(<App />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('installed_apps'));
  expect(await screen.findByText('Estado de instalación no disponible todavía.')).toBeTruthy();
  expect(screen.queryByText('Example App')).toBeNull();
  expect(screen.queryByText('No hay aplicaciones instaladas.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Abrir Example App' })).toBeNull();
});

it('disables plugin show without capability and sends only an ID when supported', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  let publish!: (snapshot: RegistrySnapshot) => void;
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return () => {}; });
  const app = { ...fullCatalog.apps[0], detection: { windows: { displayName: 'Example App', publisher: 'Example Publisher', executableRelativePath: 'Example.exe' } } };
  vi.mocked(invoke).mockImplementation(((command: string) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, sources: [] } });
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    if (command === 'read_catalog_v2_cache') return Promise.resolve(JSON.stringify({ schemaVersion: 2, apps: [app] }));
    if (command === 'installed_apps') return Promise.resolve([{ id: 'example-app', state: 'installed', version: '9.1.0', reason: 'Instalación detectada' }]);
    if (command === 'open_official_app') return Promise.resolve('Solicitud enviada; no hay confirmación de la ventana');
    return Promise.resolve(null);
  }) as typeof invoke);
  render(<App />);
  await screen.findByText('Example App');
  const entry = { app: { id: 'example-app', name: 'Example App', version: '2.0.0' }, capabilities: [] as string[], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] };
  act(() => publish({ revision: 1, apps: [entry] }));
  expect((screen.getByRole('button', { name: 'Abrir Example App' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => publish({ revision: 2, apps: [{ ...entry, capabilities: ['show'] }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Abrir Example App' }));
  expect(await screen.findByText('Solicitud enviada; no hay confirmación de la ventana')).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith('open_official_app', { id: 'example-app' });
});

it('keeps settings, live IPC and late-arriving catalog news together', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  let publish: ((snapshot: RegistrySnapshot) => void) | undefined;
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return () => {}; });
  let resolveCache!: (text: string) => void;
  const cache = new Promise<string>(resolve => { resolveCache = resolve; });
  let saved = { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: true, accent: '#123456',
    sources: [{ id: 'official', label: 'Catálogo oficial egdev', kind: 'official' }] };
  vi.mocked(invoke).mockImplementation(((command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'ready', settings: saved });
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    if (command === 'read_catalog_cache') return cache;
    if (command === 'get_flyout_state') return Promise.resolve({ visible: true, sequence: 1, cycle: 1, at: Date.now() });
    if (command === 'save_settings') { saved = { ...saved, ...args?.patch }; return Promise.resolve(saved); }
    return Promise.resolve(null);
  }) as typeof invoke);
  render(<App />);
  await waitFor(() => expect(publish).toBeTypeOf('function'));
  act(() => publish!({ revision: 1, apps: [{ app: { id: 'external', name: 'App conectada', version: '1.0.0' }, capabilities: [], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  expect(await screen.findByText('App conectada')).toBeTruthy();
  expect(screen.getByRole('main').style.getPropertyValue('--hub-accent')).toBe('#123456');
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
  const now = new Date().toISOString();
  await act(async () => { resolveCache(JSON.stringify({ schemaVersion: 1, apps: [{ id: 'minimal', name: 'Minimal', tagline: 'Prueba', description: 'Una app', tags: [], iconUrl: 'https://example.com/icon.png', installerUrl: 'https://example.com/app.exe', latestJsonUrl: 'https://example.com/latest.json', integrationLevel: 'launch', releasedAt: now, featured: false, news: [{ id: 'release', title: 'Novedad de catálogo', text: 'Disponible', publishedAt: now, kind: 'new' }] }] })); });
  expect(await screen.findByRole('dialog', { name: 'Novedades' })).toBeTruthy();
  expect(screen.getByText('Novedad de catálogo')).toBeTruthy();
  closeNews();
  expect(screen.getByText('App conectada')).toBeTruthy();
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  fireEvent.mouseDown(catalog, { button: 0 }); fireEvent.click(catalog);
  expect(screen.getByText(/Catálogo de prueba: Minimal/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar apariencia' }));
  await waitFor(() => expect(saved.accent).toBe('#3b82f6'));
  expect(screen.getByRole('main').style.getPropertyValue('--hub-blur')).toBe('12px');
});

it('does not exit only the hub while a pending settings save fails', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  let publish: ((snapshot: RegistrySnapshot) => void) | undefined;
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return () => {}; });
  let failSave = true;
  let saved = { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false,
    sources: [{ id: 'official', label: 'Catálogo oficial egdev', kind: 'official' }] };
  vi.mocked(invoke).mockImplementation(((command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'get_settings') return Promise.resolve({ state: 'ready', settings: saved });
    if (command === 'plugin:autostart|is_enabled') return Promise.resolve(false);
    if (command === 'read_catalog_cache') return Promise.resolve(null);
    if (command === 'save_settings') {
      if (failSave) return Promise.reject(new Error('disco lleno'));
      saved = { ...saved, ...args?.patch }; return Promise.resolve(saved);
    }
    return Promise.resolve(null);
  }) as typeof invoke);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar apariencia' }));
  await waitFor(() => expect(publish).toBeTypeOf('function'));
  act(() => publish!({ revision: 1, apps: [], notice: { message: 'Cierre bloqueado', hub_only_allowed: true } }));
  fireEvent.click(screen.getByRole('button', { name: 'Salir solo de Nexo' }));
  expect(exitHubOnly).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByText(/disco lleno/)).toBeTruthy());
  expect(saved.accent).toBe(defaultSettings.accent);
  failSave = false;
  fireEvent.click(screen.getByRole('button', { name: 'Salir solo de Nexo' }));
  await waitFor(() => expect(exitHubOnly).toHaveBeenCalledOnce());
  expect(saved.accent).toBe('#3b82f6');
});

it('starts with language choice and then shows the installed list, retaining the choice', () => {
  render(<App />);
  expect(screen.getByRole('region', { name: 'Idioma' })).toBeTruthy();
  expect(screen.queryByText('Instaladas')).toBeNull();
  enter('English');
  expect(screen.getByText('Installed')).toBeTruthy();
  closeNews();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByText('Idioma: en')).toBeTruthy();
});

it('uses only two tabs, associates panels and passes apps to CatalogView', () => {
  render(<App />); enter(); closeNews();
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map(tab => tab.textContent)).toEqual(['Mis apps', 'Catálogo']);
  expect(screen.queryByRole('tab', { name: 'Novedades' })).toBeNull();
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  fireEvent.mouseDown(catalog, { button: 0 });
  fireEvent.click(catalog);
  expect(catalog.getAttribute('aria-selected')).toBe('true');
  const panel = screen.getByRole('tabpanel');
  expect(panel.getAttribute('aria-labelledby')).toBe(catalog.id);
  expect(within(panel).getByText(/Catálogo de prueba: Antena, Quorb, OBS Studio, Pizarra, Cadencia/)).toBeTruthy();
});

it('preserves keyboard selection and wraparound for the two tabs', async () => {
  render(<App />); enter(); closeNews();
  const apps = screen.getByRole('tab', { name: 'Mis apps' });
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  apps.focus(); fireEvent.keyDown(apps, { key: 'ArrowLeft' });
  await waitFor(() => expect(document.activeElement).toBe(catalog));
  expect(catalog.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(catalog, { key: 'Home' });
  await waitFor(() => expect(document.activeElement).toBe(apps));
});

it('opens settings with the gear and returns to the selected tab', () => {
  render(<App />); enter(); closeNews();
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  fireEvent.mouseDown(catalog, { button: 0 });
  fireEvent.click(catalog);
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  expect(screen.getByRole('region', { name: 'Ajustes' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getByRole('tab', { name: 'Catálogo' }).getAttribute('aria-selected')).toBe('true');
});

it('shows sample news in the panel on opening and honours the opt-out on reopening', () => {
  render(<App />); enter();
  const main = screen.getByRole('main');
  expect(within(main).getByRole('dialog', { name: 'Novedades' })).toBeTruthy();
  expect(screen.getByText(/Pizarra.*Cadencia/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'No mostrar al abrir' }));
  closeNews();
  fireEvent.focus(window);
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Alternar novedades' }));
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  fireEvent.focus(window);
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
});

it('does not open news when the list is empty', () => {
  render(<App news={[]} />); enter();
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
  fireEvent.focus(window);
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
});

it('applies live appearance settings to the panel root', () => {
  render(<App />); enter(); closeNews();
  const main = screen.getByRole('main');
  expect(main.style.getPropertyValue('--hub-accent')).toBe('#ff0036');
  expect(main.style.getPropertyValue('--hub-density')).toBe('1');
  expect(main.style.getPropertyValue('--hub-opacity')).toBe('0.85');
  expect(main.style.getPropertyValue('--hub-blur')).toBe('24px');
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar apariencia' }));
  expect(main.style.getPropertyValue('--hub-accent')).toBe('#3b82f6');
  expect(main.style.getPropertyValue('--hub-density')).toBe('0.8');
  expect(main.style.getPropertyValue('--hub-opacity')).toBe('0.63');
  expect(main.style.getPropertyValue('--hub-blur')).toBe('12px');
});

it('labels an installed official launch-only app as official and disables illustrative actions', () => {
  render(<App apps={[{ id: 'example', name: 'Example', installed: true, running: false, integration: 'local', source: 'official', statusKnown: true, description: 'Example' }]} news={[]} />); enter();
  expect(screen.getByText(/Catálogo egdev.*Solo apertura/)).toBeTruthy();
  expect(screen.queryByText(/App local.*Solo apertura/)).toBeNull();
  expect((screen.getByRole('button', { name: 'Abrir Example' }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps live registry updates and unknown installation state through catalog error and retry', async () => {
  vi.mocked(isTauri).mockReturnValue(true);
  let publish: ((snapshot: RegistrySnapshot) => void) | undefined;
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return () => {}; });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Español' }));
  await screen.findByText('Estado de instalación no disponible todavía.');
  await waitFor(() => expect(publish).toBeTypeOf('function'));
  act(() => publish!({ revision: 1, apps: [{
    app: { id: 'external', name: 'App conectada', version: '1.0.0' }, capabilities: [],
    unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [],
  }] }));
  expect(screen.getByText('App conectada')).toBeTruthy();
  expect(screen.getByText('Estado de instalación no disponible todavía.')).toBeTruthy();
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  fireEvent.mouseDown(catalog, { button: 0 }); fireEvent.click(catalog);
  await waitFor(() => expect(screen.getByText('Estado catálogo: error')).toBeTruthy());
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'read_catalog_cache')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar catálogo' }));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'read_catalog_cache')).toHaveLength(2));
  const apps = screen.getByRole('tab', { name: 'Mis apps' });
  fireEvent.mouseDown(apps, { button: 0 }); fireEvent.click(apps);
  expect(screen.getByText('App conectada')).toBeTruthy();
  expect(screen.queryByText('No hay aplicaciones instaladas.')).toBeNull();
});

it('renders live connections and menus without duplicating sample identities', async () => {
  let publish: ((snapshot: RegistrySnapshot) => void) | undefined;
  const unsubscribe = vi.fn();
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return unsubscribe; });
  const { unmount } = render(<App news={[]} />); enter();
  await waitFor(() => expect(publish).toBeTypeOf('function'));
  act(() => publish!({ revision: 2, apps: [{
    app: { id: 'antena', name: 'Antena', version: '2.0.0' },
    capabilities: ['show', 'menu'], unified: false, responsive: true, generation: 1, menu_revision: 1,
    menu: [{ id: 'pause', label: 'Pausar', enabled: false, checked: true }],
  }, {
    app: { id: 'external', name: 'Nueva app', version: '1.0.0' },
    capabilities: [], unified: true, responsive: false, generation: 2, menu_revision: 0, menu: [],
  }] }));
  expect(screen.getAllByText('Antena')).toHaveLength(1);
  expect(screen.getByText('Nueva app')).toBeTruthy();
  expect(screen.getByText('Conectada')).toBeTruthy();
  expect(screen.getByText(/Sin respuesta.*estado desconocido/i)).toBeTruthy();
  expandRow('Antena');
  expect(screen.getByText(/Pausar.*desactivada.*marcada/i)).toBeTruthy();
  expect(screen.queryByText(/No está abierta/)).toBeNull();
  act(() => publish!({ revision: 1, apps: [] }));
  expect(screen.getByText('Nueva app')).toBeTruthy();
  unmount();
  await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
});

it('unsubscribes even if the asynchronous subscription resolves after unmount', async () => {
  let resolveSubscription: ((stop: () => void) => void) | undefined;
  const stop = vi.fn();
  vi.mocked(subscribeRegistry).mockReturnValueOnce(new Promise(resolve => { resolveSubscription = resolve; }));
  const { unmount } = render(<App news={[]} />);
  unmount();
  await act(async () => { resolveSubscription!(stop); });
  expect(stop).toHaveBeenCalledOnce();
});

it('explains a blocked hub exit and requires an explicit hub-only choice', async () => {
  let publish: ((snapshot: RegistrySnapshot) => void) | undefined;
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return () => {}; });
  render(<App news={[]} />); enter();
  await waitFor(() => expect(publish).toBeTypeOf('function'));
  act(() => publish!({ revision: 3, apps: [], notice: { message: 'Antena: cambios sin guardar', hub_only_allowed: true } }));
  expect(screen.getByRole('alert').textContent).toContain('Antena: cambios sin guardar');
  expect(exitHubOnly).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Salir solo de Nexo' }));
  await waitFor(() => expect(exitHubOnly).toHaveBeenCalledOnce());
});

it('preserves expandable sample rows and unknown statuses without inventing an update', () => {
  render(<App />); enter(); closeNews();
  expect(screen.getAllByText(/Estado desconocido/).length).toBeGreaterThan(0);
  expect(screen.getByText(/App local.*Estado desconocido/)).toBeTruthy();
  const row = screen.getByRole('button', { name: /Antena.*Estado desconocido/ });
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: /Actualizar a v/ })).toBeNull();
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('1.4.0')).toBeTruthy();
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('1.4.0')).toBeNull();
  expect(screen.getByText(/acciones.*ilustrativas/i)).toBeTruthy();
});

it('preserves the empty installed state and catalog navigation', () => {
  render(<App apps={[]} news={[]} />); enter();
  expect(screen.getByText('No hay aplicaciones instaladas.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ver catálogo' }));
  expect(screen.getByRole('tab', { name: 'Catálogo' }).getAttribute('aria-selected')).toBe('true');
});

it('hides on close and Escape, except while the news dialog owns Escape', () => {
  render(<App />); enter();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(hideFlyout).not.toHaveBeenCalled();
  closeNews();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  expect(hideFlyout).toHaveBeenCalledTimes(2);
});

it('detects native backdrop availability without requiring it for the panel', async () => {
  vi.mocked(backdropAvailable).mockResolvedValueOnce(true);
  const { unmount } = render(<App />);
  const panel = screen.getByRole('main');
  expect(panel.classList.contains('has-native-backdrop')).toBe(false);
  await waitFor(() => expect(panel.classList.contains('has-native-backdrop')).toBe(true));
  unmount();
  vi.mocked(backdropAvailable).mockResolvedValueOnce(false);
  render(<App />);
  await waitFor(() => expect(backdropAvailable).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('main').classList.contains('has-native-backdrop')).toBe(false);
});
