// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CatalogViewProps, FirstRunProps, NewsPopupProps, SettingsViewProps } from './model';
import { backdropAvailable, hideFlyout } from './window';
import { exitHubOnly, subscribeRegistry } from './shell/registry';
import type { RegistrySnapshot } from './shell/registry';
import { defaultSettings } from './sample';

// Test the shell's public wiring independently of the other area writers.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn().mockResolvedValue(null),
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
    if (command === 'save_settings') { saved = { ...saved, ...args?.patch }; return Promise.resolve(saved); }
    return Promise.resolve(null);
  }) as typeof invoke);
  render(<App />);
  await waitFor(() => expect(publish).toBeTypeOf('function'));
  act(() => publish!({ revision: 1, apps: [{ app: { id: 'external', name: 'App conectada', version: '1.0.0' }, capabilities: [], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  expect(await screen.findByText('App conectada')).toBeTruthy();
  expect(screen.getByRole('main').style.getPropertyValue('--hub-accent')).toBe('#123456');
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
  await act(async () => { resolveCache(JSON.stringify({ schemaVersion: 1, apps: [{ id: 'minimal', name: 'Minimal', tagline: 'Prueba', description: 'Una app', tags: [], iconUrl: 'https://example.com/icon.png', installerUrl: 'https://example.com/app.exe', latestJsonUrl: 'https://example.com/latest.json', integrationLevel: 'launch', releasedAt: '2025-01-01T00:00:00Z', featured: false, news: [{ id: 'release', title: 'Novedad de catálogo', text: 'Disponible', publishedAt: '2025-01-01T00:00:00Z', kind: 'new' }] }] })); });
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
  expect(screen.getByText('Instaladas')).toBeTruthy();
  closeNews();
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
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
  expect(screen.getByRole('dialog', { name: 'Novedades' })).toBeTruthy();
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

it('preserves expandable rows, statuses and illustrative actions', () => {
  render(<App />); enter(); closeNews();
  expect(screen.getAllByText(/Estado desconocido/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Actualización disponible/)).toBeTruthy();
  expect(screen.getByText(/App local.*Estado desconocido/)).toBeTruthy();
  const row = screen.getByRole('button', { name: /Antena.*Estado desconocido/ });
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect((screen.getByRole('button', { name: 'Actualizar Antena' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar Antena' }));
  expect(screen.getByText('Instalada: 1.4.0')).toBeTruthy();
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Instalada: 1.4.0')).toBeNull();
  fireEvent.click(row);
  expect(screen.getByText('Disponible: 1.5.0')).toBeTruthy();
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
