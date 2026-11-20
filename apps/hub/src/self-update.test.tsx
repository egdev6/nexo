// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { defaultSettings } from './sample';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), check: vi.fn(), install: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('./shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
beforeEach(() => {
  bridge.invoke.mockReset(); bridge.check.mockReset(); bridge.install.mockReset();
  bridge.check.mockResolvedValue(null); bridge.install.mockResolvedValue(undefined);
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'self_update_check') return bridge.check();
    if (command === 'self_update_install') return bridge.install();
    if (command === 'app_version') return '9.8.7';
    if (command === 'get_settings') return { state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, sources: [] } };
    if (command === 'plugin:autostart|is_enabled' || command === 'backdrop_available') return false;
    if (command === 'local_apps_list') return [];
    return null;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
async function about() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  const tab = screen.getByRole('tab', { name: 'Acerca de' });
  fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab);
}

it('checks silently at startup and only shows an actionable notice for a new version', async () => {
  const pending = deferred<{ version: string } | null>();
  bridge.check.mockReturnValue(pending.promise);
  render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.check).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Hay una versión nueva/)).toBeNull();
  expect(screen.queryByText(/Buscando actualizaciones/)).toBeNull();
  await act(async () => pending.resolve({ version: '2.3.4' }));
  const notice = screen.getByText('Hay una versión nueva: 2.3.4').closest('[role="status"]')!;
  expect(within(notice as HTMLElement).getByRole('button', { name: 'Instalar' })).toBeTruthy();
  expect(bridge.install).not.toHaveBeenCalled();
});

it('keeps the startup panel quiet when no update exists or the check fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  bridge.check.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
  const view = render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(log).toHaveBeenCalled());
  expect(screen.queryByText(/Hay una versión nueva/)).toBeNull();
  expect(screen.queryByText(/No se pudo buscar actualizaciones/)).toBeNull();
  view.unmount(); render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.check).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Hay una versión nueva/)).toBeNull();
});

it('shows the real version and manual checking and up-to-date states', async () => {
  const pending = deferred<null>();
  bridge.check.mockResolvedValueOnce(null).mockReturnValueOnce(pending.promise);
  render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.check).toHaveBeenCalledTimes(1));
  await about();
  expect(await screen.findByText('Versión 9.8.7')).toBeTruthy();
  expect(bridge.invoke).toHaveBeenCalledWith('app_version');
  fireEvent.click(screen.getByRole('button', { name: 'Buscar actualizaciones' }));
  const checking = screen.getByRole('button', { name: 'Buscando actualizaciones…' });
  expect(checking.hasAttribute('disabled')).toBe(true);
  expect(bridge.check).toHaveBeenCalledTimes(2);
  await act(async () => pending.resolve(null));
  expect(screen.getByText('Nexo está actualizado.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Buscar actualizaciones' }).hasAttribute('disabled')).toBe(false);
});

it('offers retry after a manual error and installs the version returned by the retry', async () => {
  const installing = deferred<void>();
  bridge.check.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ version: '2.0.0' });
  bridge.install.mockReturnValue(installing.promise);
  render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.check).toHaveBeenCalledTimes(1));
  await about();
  fireEvent.click(screen.getByRole('button', { name: 'Buscar actualizaciones' }));
  expect(await screen.findByText('No se pudo buscar actualizaciones.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('Hay una versión nueva: 2.0.0');
  const aboutSection = screen.getByRole('region', { name: 'Acerca de' });
  fireEvent.click(within(aboutSection).getByRole('button', { name: 'Instalar' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('self_update_install'));
  expect(bridge.install).toHaveBeenCalledTimes(1);
  expect(within(aboutSection).getByRole('button', { name: 'Descargando e instalando…' }).hasAttribute('disabled')).toBe(true);
  expect(within(aboutSection).getByRole('button', { name: 'Buscar actualizaciones' }).hasAttribute('disabled')).toBe(true);
  await act(async () => installing.reject(new Error('signature')));
  expect(screen.getByText('No se pudo instalar la actualización.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(bridge.check).toHaveBeenCalledTimes(4));
});

it('flushes pending settings before installation and stops if saving fails', async () => {
  const saving = deferred<unknown>();
  const original = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === 'save_settings') return saving.promise;
    return original(command, args);
  });
  bridge.check.mockResolvedValueOnce({ version: '2.4.0' });
  render(<App apps={[]} news={[]} />);
  await screen.findByText('Hay una versión nueva: 2.4.0');
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Mostrar novedades al abrir' }));
  const tab = screen.getByRole('tab', { name: 'Acerca de' });
  fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab);
  fireEvent.click(screen.getByRole('button', { name: 'Instalar' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('save_settings', expect.anything()));
  expect(bridge.install).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Descargando e instalando…' }).hasAttribute('disabled')).toBe(true);
  await act(async () => saving.reject(new Error('disco lleno')));
  expect(await screen.findByText(/No se pudieron guardar los ajustes/)).toBeTruthy();
  expect(bridge.install).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Instalar' }).hasAttribute('disabled')).toBe(false);
});

it('retains the startup result under React StrictMode without issuing concurrent checks', async () => {
  const pending = deferred<{ version: string }>();
  bridge.check.mockReturnValue(pending.promise);
  render(<StrictMode><App apps={[]} news={[]} /></StrictMode>);
  expect(bridge.check).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ version: '2.2.0' }));
  expect(screen.getByText('Hay una versión nueva: 2.2.0')).toBeTruthy();
});

it('reports an installation failure from the panel and allows checking again', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  bridge.check.mockResolvedValueOnce({ version: '2.1.0' }).mockResolvedValueOnce(null);
  bridge.install.mockRejectedValueOnce(new Error('bad signature'));
  render(<App apps={[]} news={[]} />);
  const notice = (await screen.findByText('Hay una versión nueva: 2.1.0')).closest('[role="status"]') as HTMLElement;
  fireEvent.click(within(notice).getByRole('button', { name: 'Instalar' }));
  expect(await screen.findByText('No se pudo instalar la actualización.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(bridge.check).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/Hay una versión nueva/)).toBeNull();
});

it('installs directly from the startup notice after an explicit click', async () => {
  bridge.check.mockResolvedValueOnce({ version: '2.1.0' });
  bridge.install.mockReturnValue(new Promise(() => {}));
  render(<App apps={[]} news={[]} />);
  const notice = (await screen.findByText('Hay una versión nueva: 2.1.0')).closest('[role="status"]') as HTMLElement;
  fireEvent.click(within(notice).getByRole('button', { name: 'Instalar' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('self_update_install'));
  expect(within(notice).getByRole('button', { name: 'Descargando e instalando…' }).hasAttribute('disabled')).toBe(true);
});
