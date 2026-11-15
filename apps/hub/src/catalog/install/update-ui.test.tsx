// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App, { FlyoutPanel } from '../../App';
import { parseCatalog, type Catalog } from '../format';
import { defaultSettings } from '../../sample';
import type { HubApp, Language } from '../../model';
import type { InstallProgress } from './index';

const native = vi.hoisted(() => ({ update: vi.fn(), install: vi.fn(), cancel: vi.fn(), listen: vi.fn(), invoke: vi.fn(), load: vi.fn(), receive: undefined as undefined | ((progress: InstallProgress) => void), publish: undefined as undefined | ((value: unknown) => void), locale: 'es' as Language }));
vi.mock('./index', () => ({ updateApp: native.update, installApp: native.install, cancelInstall: native.cancel, onInstallProgress: native.listen }));
vi.mock('../loader', async original => ({ ...(await original<typeof import('../loader')>()), loadVersionedCatalog: native.load }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('../../settings/use-settings', () => ({ useSettings: () => ({ settings: { ...defaultSettings, language: native.locale, firstRunComplete: true, showNewsOnOpen: false, sources: [] }, fileState: 'ready', languageDraft: null, autostart: {}, recordVisit: vi.fn(), getVisit: () => null }) }));
vi.mock('../../news/use-flyout', () => ({ useFlyoutVisibility: () => ({ visibility: null, lastShow: null, error: null }) }));
vi.mock('../../shell/registry', () => ({ subscribeRegistry: vi.fn(async (publish: (value: unknown) => void) => { native.publish = publish; return () => {}; }), exitHubOnly: vi.fn() }));
vi.mock('../../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));
vi.mock('../../local-apps/view', () => ({ LocalAppsView: () => null }));

const key = btoa(`untrusted comment: key\n${btoa('Ed' + '\x00'.repeat(40))}\n`);
const catalog = (version = '2.0.0'): Catalog => parseCatalog({ schemaVersion: 3, apps: [{ id: 'antena', name: 'Antena', tagline: 'Test', description: 'Test', tags: [], iconUrl: 'https://example.com/icon.png', installerUrl: 'https://github.com/egdev6/antena/releases/download/v2/setup.exe', latestJsonUrl: 'https://github.com/egdev6/antena/releases/download/v2/latest.json', updaterPublicKey: key, integrationLevel: 'full', releasedAt: '2025-01-01T00:00:00Z', featured: false, version, news: [
  { id: 'newer', title: 'New notes', text: '<b>Plain text</b>', publishedAt: '2025-01-01T10:00:00+01:00', kind: 'update' },
  { id: 'older', title: 'Old notes', text: 'Old', publishedAt: '2025-01-01T08:30:00Z', kind: 'update' },
] }] });
const installed = (version: string | undefined = '1.0.0'): HubApp => ({ id: 'antena', name: 'Antena', description: 'Test', installed: true, running: false, source: 'official', statusKnown: true, installationState: 'installed', integration: 'complete', version, canOpen: true });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const button = () => screen.queryByRole('button', { name: /Actualizar Antena a v|Update Antena to v/ });
const show = async (app = installed(), state: { status: 'ready' | 'offline' | 'loading'; catalog: Catalog; stale?: boolean } = { status: 'ready', catalog: catalog() }) => {
  const refresh = vi.fn();
  const view = render(<FlyoutPanel apps={[app]} news={[]} catalogState={state} onAppsRefresh={refresh} />);
  await act(async () => {});
  return { ...view, refresh };
};

beforeEach(() => {
  native.locale = 'es'; native.receive = undefined; native.publish = undefined;
  native.update.mockReset(); native.install.mockReset(); native.cancel.mockReset(); native.listen.mockReset(); native.invoke.mockReset(); native.load.mockReset();
  native.invoke.mockResolvedValue(null); native.load.mockResolvedValue({ status: 'ready', catalog: catalog() }); native.cancel.mockResolvedValue('cancelled');
  native.listen.mockImplementation(async (receive: (progress: InstallProgress) => void) => { native.receive = receive; return () => {}; });
});
afterEach(cleanup);

it('shows the strictly newer v3 catalog version and latest news as plain text, reevaluating detection and catalog changes', async () => {
  const { rerender, refresh } = await show();
  expect(button()?.textContent).toBe('Actualizar a v2.0.0');
  expect(screen.getByText('New notes')).toBeTruthy();
  expect(screen.getByText('<b>Plain text</b>').querySelector('b')).toBeNull();
  expect(screen.queryByText('Old notes')).toBeNull();
  rerender(<FlyoutPanel apps={[installed('2.0.0')]} news={[]} catalogState={{ status: 'ready', catalog: catalog() }} onAppsRefresh={refresh} />);
  expect(button()).toBeNull();
  rerender(<FlyoutPanel apps={[installed('2.0.0')]} news={[]} catalogState={{ status: 'ready', catalog: catalog('3.0.0') }} onAppsRefresh={refresh} />);
  expect(button()?.textContent).toBe('Actualizar a v3.0.0');
  expect(native.update).not.toHaveBeenCalled();
});

it('implements strict SemVer precedence including prerelease, metadata, numeric bounds and invalid installed versions', async () => {
  const { rerender, refresh } = await show();
  const cases: [string, string, boolean][] = [
    ['1.0.0-alpha', '1.0.0-alpha.1', true], ['1.0.0-alpha.1', '1.0.0-alpha.beta', true],
    ['1.0.0-alpha.beta', '1.0.0-beta', true], ['1.0.0-beta.2', '1.0.0-beta.11', true],
    ['1.0.0-rc.1', '1.0.0', true], ['1.0.0', '1.0.0-rc.1', false],
    ['1.0.0+one', '1.0.0+two', false], ['2.0.0', '1.99.99', false],
    ['1.0.0-999999999999999999999', '1.0.0-1000000000000000000000', true],
    ['18446744073709551615.0.0', '18446744073709551615.0.1', true],
    ['18446744073709551616.0.0', '2.0.0', false], ['1.0', '2.0.0', false],
    ['v1.0.0', '2.0.0', false], ['01.0.0', '2.0.0', false], ['1.0.0-01', '2.0.0', false], ['1.0.0\n', '2.0.0', false],
  ];
  for (const [current, target, expected] of cases) {
    rerender(<FlyoutPanel apps={[installed(current)]} news={[]} catalogState={{ status: 'ready', catalog: catalog(target) }} onAppsRefresh={refresh} />);
    expect(!!button(), `${current} -> ${target}`).toBe(expected);
  }
  expect(native.update).not.toHaveBeenCalled();
});

it('requires a known official installation and v3 key, and labels stale availability without allowing an update', async () => {
  const { rerender, refresh } = await show();
  const check = (app: HubApp, state: { status: 'ready' | 'offline' | 'loading'; catalog: Catalog; stale?: boolean }) => rerender(<FlyoutPanel apps={[app]} news={[]} catalogState={state} onAppsRefresh={refresh} />);
  check({ ...installed(), statusKnown: false, installationState: 'unknown' }, { status: 'ready', catalog: catalog() }); expect(button()).toBeNull();
  check({ ...installed(), source: 'local' }, { status: 'ready', catalog: catalog() }); expect(button()).toBeNull();
  check({ ...installed(), version: undefined }, { status: 'ready', catalog: catalog() }); expect(button()).toBeNull();
  const noKey = catalog(); delete noKey.apps[0].updaterPublicKey;
  check(installed(), { status: 'ready', catalog: noKey }); expect(button()).toBeNull();
  check(installed(), { status: 'ready', catalog: { ...catalog(), schemaVersion: 2 } }); expect(button()).toBeNull();
  check(installed(), { status: 'offline', catalog: catalog(), stale: true });
  expect((button() as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Catálogo desactualizado; actualízalo antes de actualizar la app.')).toBeTruthy();
  fireEvent.click(button()!); expect(native.update).not.toHaveBeenCalled();
  native.locale = 'en';
  check(installed(), { status: 'offline', catalog: catalog(), stale: true });
  expect(button()?.textContent).toBe('Update to v2.0.0');
  expect(screen.getByText('Outdated catalog; refresh it before updating the app.')).toBeTruthy();
});

it('requires a working progress subscription before starting an update', async () => {
  native.listen.mockRejectedValueOnce(new Error('private diagnostic'));
  await show();
  expect((button() as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('No se puede seguir el progreso de actualización. Reintenta la conexión.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect((button() as HTMLButtonElement).disabled).toBe(false));
  expect(native.update).not.toHaveBeenCalled();
});

it('tracks update progress, fences open, supports cancellation before launch and refreshes on confirmed success', async () => {
  const run = deferred<{ status: 'updated'; version: string }>(); native.update.mockReturnValueOnce(run.promise);
  native.cancel.mockResolvedValueOnce('tooLate');
  const { rerender, refresh } = await show();
  const start = button()!; fireEvent.click(start); fireEvent.click(start);
  expect(native.update).toHaveBeenCalledExactlyOnceWith('antena');
  expect(screen.getByText('Consultando catálogo…')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Abrir Antena' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => native.receive!({ id: 'antena', phase: 'downloading', received: 50, total: 100 }));
  expect(screen.getByRole('progressbar', { name: 'Descarga de Antena' }).getAttribute('aria-valuenow')).toBe('50');
  act(() => native.receive!({ id: 'antena', phase: 'verifying' })); expect(screen.getByText('Verificando…')).toBeTruthy();
  act(() => native.receive!({ id: 'antena', phase: 'closing' })); expect(screen.getByText('Cerrando app…')).toBeTruthy();
  native.locale = 'en';
  rerender(<FlyoutPanel apps={[installed()]} news={[]} catalogState={{ status: 'ready', catalog: catalog() }} onAppsRefresh={refresh} />);
  expect(screen.getByText('Closing app…')).toBeTruthy();
  native.locale = 'es';
  rerender(<FlyoutPanel apps={[installed()]} news={[]} catalogState={{ status: 'ready', catalog: catalog() }} onAppsRefresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar Antena' }));
  await waitFor(() => expect(native.cancel).toHaveBeenCalledExactlyOnceWith('antena'));
  act(() => native.receive!({ id: 'antena', phase: 'installing' }));
  expect(screen.queryByRole('button', { name: 'Cancelar Antena' })).toBeNull();
  act(() => native.receive!({ id: 'antena', phase: 'detecting' })); expect(screen.getByText('Comprobando instalación…')).toBeTruthy();
  await act(async () => run.resolve({ status: 'updated', version: '2.0.0' }));
  expect(refresh).toHaveBeenCalledOnce();
  rerender(<FlyoutPanel apps={[installed('2.0.0')]} news={[]} catalogState={{ status: 'ready', catalog: catalog() }} onAppsRefresh={refresh} />);
  expect(screen.getByText('Instalada: 2.0.0')).toBeTruthy();
  expect(screen.getByText('Actualizada a v2.0.0.')).toBeTruthy();
  expect(button()).toBeNull();
  native.locale = 'en';
  rerender(<FlyoutPanel apps={[installed('2.0.0')]} news={[]} catalogState={{ status: 'ready', catalog: catalog() }} onAppsRefresh={refresh} />);
  expect(screen.getByText('Updated to v2.0.0.')).toBeTruthy();
});

it('keeps tracking during an unknown detection and returns to idle after cancellation', async () => {
  const run = deferred<{ status: 'cancelled' }>(); native.update.mockReturnValueOnce(run.promise);
  const { rerender, refresh } = await show();
  fireEvent.click(button()!);
  rerender(<FlyoutPanel apps={[{ ...installed(), statusKnown: false, installationState: 'unknown' }]} news={[]} catalogState={{ status: 'ready', catalog: catalog() }} onAppsRefresh={refresh} />);
  act(() => native.receive!({ id: 'antena', phase: 'downloading', received: 7 }));
  expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar Antena' }));
  await waitFor(() => expect(native.cancel).toHaveBeenCalledExactlyOnceWith('antena'));
  await act(async () => run.resolve({ status: 'cancelled' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Descargando…')).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

it('keeps a late cleanup warning alongside an update timeout', async () => {
  const run = deferred<{ status: 'timeout' }>(); native.update.mockReturnValueOnce(run.promise);
  await show(); fireEvent.click(button()!);
  act(() => native.receive!({ id: 'antena', phase: 'installing' }));
  await act(async () => run.resolve({ status: 'timeout' }));
  act(() => native.receive!({ id: 'antena', phase: 'installing', cleanupFailed: true }));
  expect(screen.getAllByRole('alert').map(item => item.textContent)).toEqual([
    'El instalador tardó demasiado y puede seguir ejecutándose. Comprueba su estado antes de reintentar.',
    'No se pudieron limpiar los archivos temporales de instalación.',
  ]);
});

it('explains manual close failures in both languages and retries the update by id', async () => {
  native.update.mockResolvedValueOnce({ status: 'appStillRunning' }).mockResolvedValueOnce({ status: 'cancelled' });
  const { rerender, refresh } = await show();
  fireEvent.click(button()!);
  expect((await screen.findByRole('alert')).textContent).toBe('La app sigue abierta o no se pudo confirmar su cierre. Ciérrala y reintenta.');
  native.locale = 'en';
  rerender(<FlyoutPanel apps={[installed()]} news={[]} catalogState={{ status: 'ready', catalog: catalog() }} onAppsRefresh={refresh} />);
  expect(screen.getByRole('alert').textContent).toBe('The app is still running or its exit could not be confirmed. Close it and retry.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry Antena' }));
  await waitFor(() => expect(native.update).toHaveBeenCalledTimes(2));
  expect(native.update).toHaveBeenLastCalledWith('antena');
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each([
  ['upToDate', '3.0.0', 'La app ya está actualizada: v3.0.0.', 'The app is already up to date: v3.0.0.'],
  ['versionMismatch', '1.5.0', 'No se pudo confirmar la versión esperada. Versión detectada: v1.5.0.', 'Could not confirm the expected version. Detected version: v1.5.0.'],
  ['notDetected', undefined, 'No se pudo confirmar la instalación. Actualiza las apps antes de reintentar.', 'Could not confirm installation. Refresh apps before retrying.'],
  ['detectionUnknown', undefined, 'No se pudo comprobar la instalación. Actualiza las apps antes de reintentar.', 'Could not check installation. Refresh apps before retrying.'],
  ['signatureInvalid', undefined, 'No se pudo verificar la firma del instalador. No se ha ejecutado.', 'The installer signature could not be verified. It was not run.'],
] as const)('reports %s accurately rather than claiming an update', async (status, version, message, english) => {
  native.update.mockResolvedValueOnce(version ? { status, version } : { status });
  const { refresh, rerender } = await show();
  fireEvent.click(button()!);
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByText(/Actualizada a/)).toBeNull();
  expect(refresh).toHaveBeenCalledTimes(status === 'signatureInvalid' ? 0 : 1);
  native.locale = 'en';
  rerender(<FlyoutPanel apps={[installed()]} news={[]} catalogState={{ status: 'ready', catalog: catalog() }} onAppsRefresh={refresh} />);
  expect(screen.getByText(english)).toBeTruthy();
  expect(screen.queryByText(/Updated to/)).toBeNull();
});

it('shows and tracks updates on connected official rows using installed, not reported, versions', async () => {
  const run = deferred<{ status: 'cancelled' }>(); native.update.mockReturnValueOnce(run.promise);
  await show();
  act(() => native.publish!({ revision: 1, apps: [{ app: { id: 'antena', name: 'Antena', version: '99.0.0' }, capabilities: ['show', 'quit'], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  expect(screen.getByText('Versión comunicada: 99.0.0 · Bandeja unificada')).toBeTruthy();
  expect(button()?.textContent).toBe('Actualizar a v2.0.0');
  fireEvent.click(button()!);
  expect((screen.getByRole('button', { name: 'Abrir Antena' }) as HTMLButtonElement).disabled).toBe(true);
  act(() => native.receive!({ id: 'antena', phase: 'closing' })); expect(screen.getByText('Cerrando app…')).toBeTruthy();
  await act(async () => run.resolve({ status: 'cancelled' }));
  expect(native.update).toHaveBeenCalledExactlyOnceWith('antena');
});

it('keeps an unconfirmed update visible when the refreshed scan finds no installation', async () => {
  let scans = 0;
  native.invoke.mockImplementation(async (command: string) => command === 'installed_apps' ? [{ id: 'antena', state: ++scans === 1 ? 'installed' : 'notInstalled', version: scans === 1 ? '1.0.0' : null, reason: '', canOpen: true }] : null);
  native.update.mockResolvedValueOnce({ status: 'notDetected' });
  render(<App news={[]} />);
  await waitFor(() => expect(button()).toBeTruthy());
  fireEvent.click(button()!);
  await waitFor(() => expect(scans).toBe(2));
  expect(await screen.findByText('No hay aplicaciones instaladas.')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe('No se pudo confirmar la instalación. Actualiza las apps antes de reintentar.');
  expect(button()).toBeNull();
});

it('uses the real detection refresh after an update, rather than the catalog or IPC version', async () => {
  let scans = 0;
  native.invoke.mockImplementation(async (command: string) => command === 'installed_apps' ? [{ id: 'antena', state: 'installed', version: ++scans === 1 ? '1.0.0' : '2.0.0', reason: '', canOpen: true }] : null);
  native.update.mockResolvedValueOnce({ status: 'updated', version: '2.0.0' });
  render(<App news={[]} />);
  await waitFor(() => expect(button()).toBeTruthy());
  fireEvent.click(button()!);
  await waitFor(() => expect(scans).toBe(2));
  expect(await screen.findByText('Instalada: 2.0.0')).toBeTruthy();
  expect(native.update).toHaveBeenCalledExactlyOnceWith('antena');
});
