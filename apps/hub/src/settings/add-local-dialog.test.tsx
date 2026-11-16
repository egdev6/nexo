// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../i18n/use-locale';
import { defaultSettings } from '../sample';
import { SettingsView } from './index';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));

const executable = { token: 'exe-token', path: 'C:\\Apps\\Paint.exe', suggestedName: 'Paint' };
const icon = { token: 'icon-token', preview: 'data:image/png;base64,aWNvbg==' };
let apps: { id: string; name: string }[];
let failures: Record<string, string>;
let cancelled: string | null;

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
beforeEach(() => {
  apps = []; failures = {}; cancelled = null;
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args?: { token?: string; name?: string; iconToken?: string }) => {
    if (failures[command]) throw failures[command];
    if (cancelled === command) { cancelled = null; return null; }
    if (command === 'local_apps_list') return apps.map(app => ({ id: `manual:${app.id}`, source: 'local', name: app.name, state: 'ready', origin: { kind: 'manual', id: app.id } }));
    if (command === 'local_app_pick_executable') return executable;
    if (command === 'local_app_pick_icon_file') return icon;
    if (command === 'local_app_cancel_selection') return;
    if (command === 'local_app_create') {
      const app = { id: 'manual-1', name: args!.name!, executable: executable.path, icon: args?.iconToken ? 'icon-1.png' : null };
      apps.push(app); return { app, duplicate: true };
    }
    if (command === 'local_app_icon') return null;
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openSettings(locale: 'es' | 'en' = 'es', accent = defaultSettings.accent) {
  render(<LocaleProvider locale={locale}><SettingsView settings={{ ...defaultSettings, language: locale, accent }} onChange={vi.fn()} onClose={vi.fn()} /></LocaleProvider>);
  const tab = screen.getByRole('tab', { name: locale === 'es' ? 'Apps locales' : 'Local apps' });
  fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab);
  const trigger = screen.getByRole('button', { name: locale === 'es' ? 'Añadir app' : 'Add app' });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  trigger.focus();
  return trigger;
}
async function openDialog(locale: 'es' | 'en' = 'es') {
  const trigger = await openSettings(locale);
  fireEvent.click(trigger);
  return { trigger, dialog: await screen.findByRole('dialog', { name: locale === 'es' ? 'Añadir app local' : 'Add local app' }) };
}
async function selectExecutable(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Examinar…' }));
  await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Ejecutable' }) as HTMLInputElement).value).toBe(executable.path));
}

it('carries a custom accent into the body-portalled dialog without affecting its close behavior', async () => {
  const trigger = await openSettings('es', '#2e7dff');
  fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog', { name: 'Añadir app local' });
  expect(dialog.hasAttribute('data-custom-accent')).toBe(true);
  expect(dialog.style.getPropertyValue('--hub-accent')).toBe('#2e7dff');
  expect(dialog.style.getPropertyValue('--hub-accent-base')).toBe('#2e7dff');
  expect(dialog.style.getPropertyValue('--hub-accent-on')).toBe('#000000');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Añadir app local' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('opens before the native picker, with a read-only path and add disabled until both fields are valid', async () => {
  const { dialog } = await openDialog();
  const path = within(dialog).getByRole('textbox', { name: 'Ejecutable' }) as HTMLInputElement;
  const name = within(dialog).getByRole('textbox', { name: 'Nombre' }) as HTMLInputElement;
  const add = within(dialog).getByRole('button', { name: 'Añadir' }) as HTMLButtonElement;
  expect(path.readOnly).toBe(true); expect(path.value).toBe(''); expect(name.value).toBe(''); expect(add.disabled).toBe(true);
  expect(within(dialog).getByRole('button', { name: 'Elegir icono…' })).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'Quitar' })).toBeTruthy();
  expect(bridge.invoke).not.toHaveBeenCalledWith('local_app_pick_executable');
  fireEvent.change(name, { target: { value: 'My app' } }); expect(add.disabled).toBe(true);
  await selectExecutable(dialog);
  expect(name.value).toBe('Paint'); expect(add.disabled).toBe(false);
  fireEvent.change(name, { target: { value: '   ' } }); expect(add.disabled).toBe(true);
  expect(apps).toEqual([]);
});

it.each([
  ['nexo.local.missing', 'No se encuentra el archivo seleccionado.'],
  ['nexo.local.notExecutable', 'Selecciona un archivo ejecutable válido.'],
  ['nexo.local.refused', 'No se puede usar esta ruta o los datos han cambiado; vuelve a intentar.'],
])('shows %s inline and never creates an app', async (code, message) => {
  failures.local_app_pick_executable = code;
  const { dialog } = await openDialog();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Examinar…' }));
  expect(await within(dialog).findByText(message)).toBeTruthy();
  expect(within(dialog).getByRole('textbox', { name: 'Ejecutable' }).getAttribute('aria-invalid')).toBe('true');
  expect((within(dialog).getByRole('button', { name: 'Añadir' }) as HTMLButtonElement).disabled).toBe(true);
  expect(apps).toEqual([]); expect(bridge.invoke).not.toHaveBeenCalledWith('local_app_create', expect.anything());
});

it.each([
  ['nexo.local.missing', 'No se encuentra el archivo seleccionado.'],
  ['nexo.local.notExecutable', 'Selecciona un archivo ejecutable válido.'],
  ['nexo.local.refused', 'No se puede usar esta ruta o los datos han cambiado; vuelve a intentar.'],
])('shows create-time executable revalidation %s on the executable field', async (code, message) => {
  const { dialog } = await openDialog(); await selectExecutable(dialog);
  failures.local_app_create = code;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir' }));
  expect(await within(dialog).findByText(message)).toBeTruthy();
  expect(within(dialog).getByRole('textbox', { name: 'Ejecutable' }).getAttribute('aria-invalid')).toBe('true');
  expect((within(dialog).getByRole('button', { name: 'Añadir' }) as HTMLButtonElement).disabled).toBe(true);
  expect(apps).toEqual([]);
});

it('prefills and edits the name, previews and removes a selected icon, and creates with tokens rather than paths', async () => {
  const { dialog } = await openDialog(); await selectExecutable(dialog);
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'My Paint' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Elegir icono…' }));
  await waitFor(() => expect(within(dialog).getByRole('img', { name: /vista previa/i }).querySelector('img')?.getAttribute('src')).toBe(icon.preview));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Quitar' }));
  expect(within(dialog).getByRole('img', { name: /vista previa/i }).textContent).toContain('M');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Elegir icono…' }));
  await waitFor(() => expect(within(dialog).getByRole('img', { name: /vista previa/i }).querySelector('img')).toBeTruthy());
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('local_app_create', { token: executable.token, name: 'My Paint', iconToken: icon.token }));
  expect(await screen.findByText('My Paint')).toBeTruthy();
  expect(screen.getByText('Puede existir otra app con el mismo nombre o ejecutable.')).toBeTruthy();
  expect(apps).toHaveLength(1);
});

it('keeps the selected icon and app unchanged on native picker cancellation or invalid icon', async () => {
  const { dialog } = await openDialog(); await selectExecutable(dialog);
  cancelled = 'local_app_pick_icon_file';
  fireEvent.click(within(dialog).getByRole('button', { name: 'Elegir icono…' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('local_app_pick_icon_file'));
  failures.local_app_pick_icon_file = 'nexo.local.invalidIcon';
  fireEvent.click(within(dialog).getByRole('button', { name: 'Elegir icono…' }));
  const alert = await within(dialog).findByRole('alert');
  expect(alert.textContent).toBe('El icono seleccionado no es válido.');
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(alert.dataset.size).toBe('sm');
  expect(within(dialog).getByRole('img', { name: /vista previa/i }).textContent).toContain('P');
  expect(apps).toEqual([]);
});

it('shows save failures as compact alerts without creating an app', async () => {
  const { dialog } = await openDialog(); await selectExecutable(dialog);
  failures.local_app_create = 'nexo.local.invalidName';
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir' }));
  const alert = await within(dialog).findByRole('alert');
  expect(alert.textContent).toBe('Introduce un nombre válido.');
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(alert.dataset.size).toBe('sm');
  expect(apps).toEqual([]);
});

it('shows failed selection cleanup as a compact alert', async () => {
  const { dialog } = await openDialog();
  failures.local_app_cancel_selection = 'nexo.local.refused';
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('No se puede usar esta ruta o los datos han cambiado; vuelve a intentar.');
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(alert.dataset.size).toBe('sm');
  expect(apps).toEqual([]);
});

it.each(['cancel', 'escape', 'close'] as const)('closes with %s, revokes the selection, restores focus and changes nothing', async method => {
  const { dialog, trigger } = await openDialog(); await selectExecutable(dialog);
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Unsaved' } });
  if (method === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  if (method === 'close') fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar diálogo' }));
  if (method === 'escape') fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Añadir app local' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(bridge.invoke).toHaveBeenCalledWith('local_app_cancel_selection');
  expect(bridge.invoke).not.toHaveBeenCalledWith('local_app_create', expect.anything());
  expect(apps).toEqual([]);
});

it('traps focus and provides English dialog labels', async () => {
  const { dialog, trigger } = await openDialog('en');
  expect(within(dialog).getByRole('textbox', { name: 'Executable' })).toBeTruthy();
  expect(within(dialog).getByRole('textbox', { name: 'Name' })).toBeTruthy();
  trigger.focus();
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
