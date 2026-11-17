// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { FlyoutPanel } from '../App';
import type { HubApp } from '../model';
import { defaultSettings } from '../sample';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));

const official: HubApp = { id: 'official', name: 'Official', description: 'Official app', source: 'official', integration: 'complete', installed: true, running: false, installationState: 'installed', canOpen: true };
const available: HubApp = { ...official, id: 'available', name: 'Available', integration: 'catalog', installed: false, installationState: 'notInstalled' };
const initial = { ...defaultSettings, hideLocalApps: false, firstRunComplete: true, showNewsOnOpen: false, sources: [] };
let stored: typeof initial;
let apps: { id: string; name: string; executable: string; icon: null }[];

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
beforeEach(() => {
  stored = structuredClone(initial);
  apps = [{ id: 'one', name: 'Editor', executable: 'C:\\Editor.exe', icon: null }];
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof initial>; id?: string; name?: string }) => {
    if (command === 'get_settings') return { state: 'ready', settings: structuredClone(stored) };
    if (command === 'save_settings') { stored = { ...stored, ...args?.patch }; return structuredClone(stored); }
    if (command === 'local_apps_list') return apps.map(app => ({ id: `local:manual:${app.id}`, name: app.name, source: 'local', state: 'ready', origin: { kind: 'manual', id: app.id } }));
    if (command === 'local_app_pick_executable') return { token: 'exe-token', path: 'C:\\Paint.exe', suggestedName: 'Paint' };
    if (command === 'local_app_create') {
      const app = { id: 'two', name: args?.name ?? 'Paint', executable: 'C:\\Paint.exe', icon: null };
      apps = [...apps, app]; return { app, duplicate: false };
    }
    if (command === 'local_app_update') {
      apps = apps.map(app => app.id === args?.id ? { ...app, name: args.name ?? app.name } : app);
      return { app: apps.find(app => app.id === args?.id), duplicate: false };
    }
    if (command === 'local_app_remove') { apps = apps.filter(app => app.id !== args?.id); return; }
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0 };
    if (command === 'plugin:autostart|is_enabled' || command === 'backdrop_available') return false;
    return null;
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function show() {
  return render(<FlyoutPanel apps={[official, available]} news={[]} onAppsRefresh={() => {}} />);
}
function tab(name: string) {
  const element = screen.getByRole('tab', { name });
  fireEvent.mouseDown(element, { button: 0 }); fireEvent.click(element);
}

it.each([
  ['es', 'Ajustes', 'Volver', 'Ocultar apps locales', 'No mostrar la sección Apps locales en Mis apps', 'Apps locales', 'Actualizar apps locales', 'Para cerrar una app sin plugin, hazlo desde la propia app.', '1 instalada', 'Catálogo', 'Mis apps'],
  ['en', 'Settings', 'Back', 'Hide local apps', 'Do not show the Local apps section in My apps', 'Local apps', 'Refresh local apps', 'To close an app without the plugin, close it from within the app.', '1 installed', 'Catalog', 'My apps'],
] as const)('defaults to visible, persists hide and restore, and keeps official apps and count (%s)', async (locale, settings, back, label, hint, heading, refresh, note, count, catalog, myApps) => {
  stored.language = locale;
  const first = show();
  const region = await screen.findByRole('region', { name: heading });
  await within(region).findByText('Editor');
  expect(within(region).getByRole('heading', { name: heading })).toBeTruthy();
  expect(within(region).getByRole('button', { name: refresh })).toBeTruthy();
  fireEvent.click(within(region).getByRole('button', { expanded: false }));
  expect(within(region).getByText('Editor')).toBeTruthy();
  expect(within(region).getByText(note)).toBeTruthy();
  expect(screen.getByText(count, { exact: false })).toBeTruthy();
  expect(screen.getByText('Official')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: settings }));
  const toggle = screen.getByRole('switch', { name: label });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe(hint);
  fireEvent.click(screen.getByText(label));
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('save_settings', { patch: { hideLocalApps: true } }));
  expect(stored.hideLocalApps).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: back }));
  expect(screen.queryByRole('region', { name: heading })).toBeNull();
  expect(screen.queryByRole('heading', { name: heading })).toBeNull();
  expect(screen.queryByRole('button', { name: refresh })).toBeNull();
  expect(screen.queryByText('Editor')).toBeNull();
  expect(screen.queryByText(note)).toBeNull();
  expect(screen.getByText('Official')).toBeTruthy();
  expect(screen.getByText(count, { exact: false })).toBeTruthy();
  tab(catalog); expect(screen.getByText('Available')).toBeTruthy(); tab(myApps);

  first.unmount(); show();
  expect(await screen.findByText('Official')).toBeTruthy();
  expect(screen.queryByRole('region', { name: heading })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: settings }));
  const restored = screen.getByRole('switch', { name: label });
  expect(restored.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(restored);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('save_settings', { patch: { hideLocalApps: false } }));
  expect(stored.hideLocalApps).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: back }));
  expect(await screen.findByRole('region', { name: heading })).toBeTruthy();
  expect(await screen.findByText('Editor')).toBeTruthy();
  expect(screen.getByText(count, { exact: false })).toBeTruthy();
});

it('keeps add, rename and remove available in settings while local apps are hidden', async () => {
  stored.hideLocalApps = true;
  show();
  expect(await screen.findByText('Official')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Apps locales' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  tab('Apps locales');
  expect(await screen.findByText('Editor')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Renombrar Editor' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nombre de Editor' }), { target: { value: 'Renombrada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre de Editor' }));
  expect(await screen.findByText('Renombrada')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Añadir app' }));
  const dialog = await screen.findByRole('dialog', { name: 'Añadir app local' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Examinar…' }));
  await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Nombre' }) as HTMLInputElement).value).toBe('Paint'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir' }));
  expect(await screen.findByText('Paint')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar Paint' }));
  const confirmation = await screen.findByRole('alertdialog', { name: 'Confirmar eliminación de Paint' });
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Eliminar app' }));
  await waitFor(() => expect(screen.queryByText('Paint')).toBeNull());
  expect(apps.map(app => app.name)).toEqual(['Renombrada']);
  expect(stored.hideLocalApps).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.queryByRole('region', { name: 'Apps locales' })).toBeNull();
});
