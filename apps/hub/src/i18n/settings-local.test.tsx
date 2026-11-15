// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
import localManagement from '../settings/local-management.tsx?raw';
import { SettingsView } from '../settings';
import { LocaleProvider } from './use-locale';
import { defaultSettings } from '../sample';
import type { CatalogSource, Language } from '../model';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));

type App = { id: string; name: string; executable: string; icon: string | null };
const official: CatalogSource = { id: 'official', label: 'Catálogo oficial egdev', kind: 'official' };
const initialApp: App = { id: 'manual-1', name: 'Editor', executable: 'C:\\Editor.exe', icon: null };
let apps: App[];
let fail: Record<string, string>;
let cancel: string | null;
let duplicate: boolean;

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
beforeEach(() => {
  apps = [structuredClone(initialApp)]; fail = {}; cancel = null; duplicate = false;
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args?: { id?: string; name?: string }) => {
    if (fail[command]) throw fail[command];
    if (command === 'get_settings') return { state: 'ready', settings: { ...defaultSettings, sources: [official, { id: 'source-1', label: 'Trabajo', kind: 'local' }] } };
    if (command === 'local_apps_list') return apps.map(app => ({ id: `manual:${app.id}`, name: app.name, source: 'local', state: 'missingExecutable', origin: { kind: 'manual', id: app.id } }));
    if (cancel === command) { cancel = null; return null; }
    if (command === 'local_app_pick_executable') return { token: 'exe-token', path: 'C:\\Paint.exe', suggestedName: 'Paint' };
    if (command === 'local_app_cancel_selection') return;
    if (command === 'local_app_create') {
      const app = { id: 'manual-2', name: args?.name ?? 'Paint', executable: 'C:\\Paint.exe', icon: null };
      apps = [...apps, app]; return { app, duplicate };
    }
    if (command === 'local_app_update') {
      const name = args?.name?.trim() ?? '';
      if (!name || /[\x00-\x1f]/.test(name)) throw 'nexo.local.invalidName';
      const app = { ...apps.find(item => item.id === args?.id)!, name };
      apps = apps.map(item => item.id === app.id ? app : item); return { app, duplicate };
    }
    if (command === 'local_app_pick_icon') {
      const app = { ...apps.find(item => item.id === args?.id)!, icon: 'owned.png' };
      apps = apps.map(item => item.id === app.id ? app : item); return { app, duplicate };
    }
    if (command === 'local_app_remove') { apps = apps.filter(item => item.id !== args?.id); return; }
    throw new Error(`Unexpected command ${command}`);
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(locale: Language = 'es') {
  const result = render(<LocaleProvider locale={locale}><SettingsView settings={{ ...defaultSettings, language: locale }} onChange={vi.fn()} onClose={vi.fn()} sources={[official]} /></LocaleProvider>);
  const tab = screen.getByRole('tab', { name: locale === 'es' ? 'Apps locales' : 'Local apps' });
  fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab);
  return result;
}

it('does not hard-code visible copy or accessible labels in the local settings view', () => {
  const source = ts.createSourceFile('local-management.tsx', localManagement, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxText(node) && /[A-Za-zÁ-ú]/.test(node.text.trim())) found.push(node.text.trim());
    if (ts.isJsxAttribute(node) && ['aria-label', 'title', 'label', 'placeholder'].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) found.push(node.initializer.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(found).toEqual([]);
});

it('lists manual apps without requesting catalog sources or commands', async () => {
  setup();
  expect(await screen.findByText('Editor')).toBeTruthy();
  expect(bridge.invoke).toHaveBeenCalledWith('local_apps_list');
  expect(bridge.invoke.mock.calls.some(([command]) => command === 'get_settings' || command.startsWith('local_catalog_'))).toBe(false);
  expect(screen.queryByRole('button', { name: /fuente/i })).toBeNull();
});

it('offers localized English controls and keyboard cancellation of an inline edit', async () => {
  setup('en'); await screen.findByText('Editor');
  expect(screen.getByRole('button', { name: 'Add app' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Change icon of Editor' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Rename Editor' }));
  const input = screen.getByRole('textbox', { name: 'Name of Editor' });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'Changed' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Name of Editor' })).toBeNull();
  expect(screen.getByText('Editor')).toBeTruthy();
  expect(bridge.invoke).not.toHaveBeenCalledWith('local_app_update', expect.anything());
});

it('lists manual entries with their state and editable controls', async () => {
  setup();
  const section = await screen.findByRole('region', { name: 'Apps locales' });
  expect(within(section).getByText('Editor')).toBeTruthy();
  expect(within(section).getByText('Ejecutable ausente o inaccesible')).toBeTruthy();
  expect(within(section).getByRole('button', { name: 'Renombrar Editor' })).toBeTruthy();
  expect(within(section).getByRole('button', { name: 'Eliminar Editor' })).toBeTruthy();
  expect(within(section).queryByText('Catálogo App')).toBeNull();
  expect(screen.queryByText('Catálogo oficial egdev')).toBeNull();
  expect(screen.queryByRole('button', { name: /fuente/i })).toBeNull();
});

it('adds through the dialog, leaves picker cancellation unchanged, warns about duplicates and survives reopening', async () => {
  setup(); await screen.findByText('Editor');
  cancel = 'local_app_pick_executable';
  fireEvent.click(screen.getByRole('button', { name: 'Añadir app' }));
  const dialog = await screen.findByRole('dialog', { name: 'Añadir app local' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Examinar…' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('local_app_pick_executable'));
  expect(screen.queryByText('Paint')).toBeNull();
  duplicate = true;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Examinar…' }));
  await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Nombre' }) as HTMLInputElement).value).toBe('Paint'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir' }));
  expect(await screen.findByText('Paint')).toBeTruthy();
  expect(screen.getByText('Puede existir otra app con el mismo nombre o ejecutable.')).toBeTruthy();
  cleanup(); setup();
  expect(await screen.findByText('Paint')).toBeTruthy();
  expect(bridge.invoke).toHaveBeenCalledWith('local_app_create', { token: 'exe-token', name: 'Paint', iconToken: undefined });
});

it('renames inline, retains the previous entry on validation or save failure, and permits editing a missing app', async () => {
  setup(); await screen.findByText('Editor');
  fireEvent.click(screen.getByRole('button', { name: 'Renombrar Editor' }));
  const input = screen.getByRole('textbox', { name: 'Nombre de Editor' });
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre de Editor' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Introduce un nombre válido.');
  expect(screen.getByText('Editor')).toBeTruthy();
  fail.local_app_update = 'nexo.config.save.corrupt';
  fireEvent.change(input, { target: { value: 'Nuevo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre de Editor' }));
  expect((await screen.findByRole('alert')).textContent).toBe('El archivo de ajustes está dañado.');
  expect(screen.getByText('Editor')).toBeTruthy();
  delete fail.local_app_update;
  fireEvent.click(screen.getByRole('button', { name: 'Guardar nombre de Editor' }));
  expect(await screen.findByText('Nuevo')).toBeTruthy();
  expect(screen.queryByText('Editor')).toBeNull();
  expect(bridge.invoke).toHaveBeenLastCalledWith('local_apps_list');
  expect(bridge.invoke).toHaveBeenCalledWith('local_app_update', { id: 'manual-1', name: 'Nuevo' });
});

it('changes the icon only through the native picker and preserves cancellation and failures', async () => {
  setup(); await screen.findByText('Editor');
  cancel = 'local_app_pick_icon';
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar icono de Editor' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('local_app_pick_icon', { id: 'manual-1' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Cambiar icono de Editor' }) as HTMLButtonElement).disabled).toBe(false));
  expect(apps[0].icon).toBeNull();
  fail.local_app_pick_icon = 'nexo.local.invalidIcon';
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar icono de Editor' }));
  expect((await screen.findByRole('alert')).textContent).toBe('El icono seleccionado no es válido.');
  expect(apps[0].icon).toBeNull();
  delete fail.local_app_pick_icon;
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar icono de Editor' }));
  await waitFor(() => expect(apps[0].icon).toBe('owned.png'));
  expect(screen.getByText('Editor')).toBeTruthy();
});

it('requires confirmation to remove an app and leaves it intact on cancel or failed save', async () => {
  setup(); await screen.findByText('Editor');
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar Editor' }));
  let confirm = screen.getByRole('group', { name: 'Confirmar eliminación de Editor' });
  expect(within(confirm).getByText('Se eliminará la entrada; el archivo y los procesos no se modificarán.')).toBeTruthy();
  fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
  expect(bridge.invoke).not.toHaveBeenCalledWith('local_app_remove', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar Editor' }));
  confirm = screen.getByRole('group', { name: 'Confirmar eliminación de Editor' });
  fail.local_app_remove = 'nexo.config.save.unreadable';
  fireEvent.click(within(confirm).getByRole('button', { name: 'Eliminar app' }));
  expect((await screen.findByRole('alert')).textContent).toBe('No se puede leer el archivo de ajustes.');
  expect(screen.getByText('Editor')).toBeTruthy();
  delete fail.local_app_remove;
  fireEvent.click(within(confirm).getByRole('button', { name: 'Eliminar app' }));
  await waitFor(() => expect(screen.queryByText('Editor')).toBeNull());
  expect(bridge.invoke).toHaveBeenCalledWith('local_app_remove', { id: 'manual-1' });
  expect(bridge.invoke.mock.calls.some(([name]) => /kill|terminate|delete_file/.test(name))).toBe(false);
});
