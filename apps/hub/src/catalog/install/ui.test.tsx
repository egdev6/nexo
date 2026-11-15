// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App, { FlyoutPanel } from '../../App';
import { CatalogView } from '../index';
import { defaultSettings } from '../../sample';
import type { HubApp, Language } from '../../model';
import type { Catalog } from '../format';
import type { InstallProgress, InstallResult } from './index';

configure({ getElementError: message => new Error(message?.split('\n')[0] ?? 'Element not found') });
const native = vi.hoisted(() => ({ install: vi.fn(), cancel: vi.fn(), listen: vi.fn(), stop: vi.fn(), invoke: vi.fn(), load: vi.fn(), receive: undefined as undefined | ((progress: InstallProgress) => void), locale: 'es' as Language }));
vi.mock('./index', () => ({ installApp: native.install, cancelInstall: native.cancel, onInstallProgress: native.listen }));
vi.mock('../loader', async importOriginal => ({ ...(await importOriginal<typeof import('../loader')>()), loadVersionedCatalog: native.load }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('../../settings/use-settings', () => ({ useSettings: () => ({ settings: { ...defaultSettings, language: native.locale, firstRunComplete: true, showNewsOnOpen: false, sources: [] }, fileState: 'ready', languageDraft: null, autostart: {}, recordVisit: vi.fn(), getVisit: () => null }) }));
vi.mock('../../news/use-flyout', () => ({ useFlyoutVisibility: () => ({ visibility: null, lastShow: null, error: null }) }));
vi.mock('../../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('../../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));
vi.mock('../../local-apps/view', () => ({ LocalAppsView: () => null }));

const base = { tagline: 'Test', description: 'Test', tags: [], installerUrl: 'https://github.com/egdev6/app/releases/download/v1/setup.exe', latestJsonUrl: 'https://github.com/egdev6/app/releases/download/v1/latest.json', integrationLevel: 'launch' as const, releasedAt: '2025-01-01T00:00:00Z', featured: false, news: [], version: '1.0.0', updaterPublicKey: 'validated-key' };
const catalog: Catalog = { schemaVersion: 3, apps: [{ ...base, id: 'alfa', name: 'Alfa' }, { ...base, id: 'beta', name: 'Beta' }] };
const app = (id: string, name: string): HubApp => ({ id, name, description: 'Test', installed: false, running: false, integration: 'catalog', source: 'official', statusKnown: true, installationState: 'notInstalled' });
const alfa = app('alfa', 'Alfa'); const beta = app('beta', 'Beta');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const card = (name: string) => within(screen.getByRole('article', { name }));
const select = (name: string) => { const tab = screen.getByRole('tab', { name }); fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab); };
const show = async (apps = [alfa, beta], state: { status: 'ready' | 'offline' | 'error'; catalog?: Catalog; stale?: boolean } = { status: 'ready', catalog }) => {
  const refresh = vi.fn();
  const view = render(<FlyoutPanel apps={apps} news={[]} catalogState={state} onAppsRefresh={refresh} />);
  select(native.locale === 'en' ? 'Catalog' : 'Catálogo');
  await act(async () => {});
  return { ...view, refresh };
};

beforeEach(() => {
  native.locale = 'es'; native.receive = undefined;
  native.install.mockReset(); native.cancel.mockReset(); native.listen.mockReset(); native.stop.mockReset(); native.invoke.mockReset(); native.load.mockReset();
  native.invoke.mockResolvedValue(null); native.load.mockResolvedValue({ status: 'ready', catalog });
  native.listen.mockImplementation(async (receive: (progress: InstallProgress) => void) => { native.receive = receive; return native.stop; });
  native.cancel.mockResolvedValue('cancelled');
});
afterEach(cleanup);

it('enables only freshly known uninstalled official v3 entries with keys, and explains each rejection', async () => {
  const noKey = { ...catalog, apps: catalog.apps.map(item => item.id === 'beta' ? { ...item, updaterPublicKey: undefined } : item) };
  const { rerender, refresh } = await show([alfa, beta], { status: 'ready', catalog: noKey });
  expect((card('Alfa').getByRole('button', { name: 'Instalar Alfa' }) as HTMLButtonElement).disabled).toBe(false);
  expect((card('Beta').getByRole('button', { name: 'Instalar Beta' }) as HTMLButtonElement).disabled).toBe(true);
  expect(card('Beta').getByText('Falta la clave de verificación de esta app.')).toBeTruthy();
  fireEvent.click(card('Beta').getByRole('button', { name: 'Instalar Beta' }));
  expect(native.install).not.toHaveBeenCalled();
  rerender(<FlyoutPanel apps={[{ ...alfa, statusKnown: false, installationState: 'unknown' }]} news={[]} catalogState={{ status: 'ready', catalog }} onAppsRefresh={refresh} />);
  expect((card('Alfa').getByRole('button', { name: 'Instalar Alfa' }) as HTMLButtonElement).disabled).toBe(true);
  expect(card('Alfa').getByText('No se ha podido comprobar si la app está instalada.')).toBeTruthy();
  rerender(<FlyoutPanel apps={[alfa]} news={[]} catalogState={{ status: 'offline', stale: true, catalog }} onAppsRefresh={refresh} />);
  expect(card('Alfa').getByText('Actualiza el catálogo conectado antes de instalar.')).toBeTruthy();
  expect((card('Alfa').getByRole('button', { name: 'Instalar Alfa' }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<FlyoutPanel apps={[alfa]} news={[]} catalogState={{ status: 'ready', catalog: { ...catalog, schemaVersion: 2 } }} onAppsRefresh={refresh} />);
  expect(card('Alfa').getByText('La instalación requiere un catálogo oficial v3.')).toBeTruthy();
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  expect(native.install).not.toHaveBeenCalled();
});

it('tracks phases, determinate and indeterminate downloads, cancellation races and independent cards across tabs', async () => {
  const first = deferred<InstallResult>(); const second = deferred<InstallResult>();
  native.install.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  native.cancel.mockResolvedValueOnce('tooLate');
  await show();
  const install = card('Alfa').getByRole('button', { name: 'Instalar Alfa' });
  fireEvent.click(install); fireEvent.click(install);
  expect(native.install).toHaveBeenCalledTimes(1);
  expect(native.install).toHaveBeenCalledWith('alfa');
  expect(card('Alfa').getByText('Consultando catálogo…')).toBeTruthy();
  act(() => native.receive!({ id: 'alfa', phase: 'awaitingApproval' }));
  expect(card('Alfa').getByText('Esperando confirmación…')).toBeTruthy();
  act(() => native.receive!({ id: 'alfa', phase: 'downloading', received: 50, total: 100 }));
  expect(card('Alfa').getByRole('progressbar', { name: 'Descarga de Alfa' }).getAttribute('aria-valuenow')).toBe('50');
  expect(card('Alfa').getByText('50 %')).toBeTruthy();
  act(() => native.receive!({ id: 'alfa', phase: 'downloading', received: 7 }));
  expect(card('Alfa').getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
  act(() => native.receive!({ id: 'alfa', phase: 'verifying' }));
  expect(card('Alfa').getByText('Verificando…')).toBeTruthy();
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Cancelar Alfa' }));
  await waitFor(() => expect(native.cancel).toHaveBeenCalledExactlyOnceWith('alfa'));
  expect(await card('Alfa').findByText('La instalación ya ha comenzado; no se puede cancelar.')).toBeTruthy();
  expect(card('Alfa').queryByRole('button', { name: 'Cancelar Alfa' })).toBeNull();
  fireEvent.click(card('Beta').getByRole('button', { name: 'Instalar Beta' }));
  expect(native.install).toHaveBeenCalledTimes(2);
  act(() => native.receive!({ id: 'alfa', phase: 'installing' }));
  select('Mis apps'); select('Catálogo');
  expect(card('Alfa').getByText('Instalando…')).toBeTruthy();
  act(() => native.receive!({ id: 'alfa', phase: 'detecting' }));
  expect(card('Alfa').getByText('Comprobando instalación…')).toBeTruthy();
  expect(card('Alfa').queryByRole('button', { name: 'Cancelar Alfa' })).toBeNull();
  await act(async () => { first.resolve({ status: 'cancelled' }); second.resolve({ status: 'cancelled' }); });
});

it('keeps tracking an installer after a refresh observes the app while it is still running', async () => {
  const run = deferred<InstallResult>(); native.install.mockReturnValueOnce(run.promise);
  const { rerender, refresh } = await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  act(() => native.receive!({ id: 'alfa', phase: 'installing' }));
  rerender(<FlyoutPanel apps={[{ ...alfa, installed: true, installationState: 'installed', integration: 'local', version: '7.0.0' }]} news={[]} catalogState={{ status: 'ready', catalog }} onAppsRefresh={refresh} />);
  expect(card('Alfa').getByText('Instalando…')).toBeTruthy();
  expect(card('Alfa').queryByRole('button', { name: 'Cancelar Alfa' })).toBeNull();
  act(() => native.receive!({ id: 'alfa', phase: 'verifying' }));
  expect(card('Alfa').getByText('Instalando…')).toBeTruthy();
  await act(async () => run.resolve({ status: 'installed', version: '7.0.0' }));
  expect(screen.queryByRole('article', { name: 'Alfa' })).toBeNull();
});

it('silently returns to idle after native cancellation and can retry', async () => {
  const run = deferred<InstallResult>(); native.install.mockReturnValueOnce(run.promise);
  const { refresh } = await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Cancelar Alfa' }));
  await waitFor(() => expect(native.cancel).toHaveBeenCalledExactlyOnceWith('alfa'));
  await act(async () => run.resolve({ status: 'cancelled' }));
  expect(card('Alfa').queryByRole('alert')).toBeNull();
  expect((card('Alfa').getByRole('button', { name: 'Instalar Alfa' }) as HTMLButtonElement).disabled).toBe(false);
  expect(refresh).not.toHaveBeenCalled();
});

it('removes a confirmed installation and refreshes My apps using the new observation, not the catalog version', async () => {
  const run = deferred<InstallResult>(); native.install.mockReturnValueOnce(run.promise);
  const { rerender, refresh } = await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  await act(async () => run.resolve({ status: 'installed', version: '7.0.0' }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole('article', { name: 'Alfa' })).toBeNull();
  // The owner supplies the refreshed registry observation.
  rerender(<FlyoutPanel apps={[{ ...alfa, installed: true, installationState: 'installed', integration: 'local', version: '7.0.0' }]} news={[]} catalogState={{ status: 'ready', catalog }} onAppsRefresh={refresh} />);
  select('Mis apps');
  fireEvent.click(screen.getByRole('button', { name: /Alfa.*Estado de ejecución desconocido/ }));
  expect(screen.getByText('7.0.0')).toBeTruthy();
  select('Catálogo'); expect(screen.queryByRole('article', { name: 'Alfa' })).toBeNull();
});

it.each([
  ['busy', 'Ya hay una instalación en curso. Espera antes de reintentar.'],
  ['notDetected', 'No se pudo confirmar la instalación. Actualiza las apps antes de reintentar.'],
  ['installerFailed', 'El instalador terminó con el código 42.'],
  ['timeout', 'El instalador tardó demasiado y puede seguir ejecutándose. Comprueba su estado antes de reintentar.'],
  ['feedFailed', 'No se pudo consultar el catálogo oficial. Comprueba la conexión y reintenta.'],
  ['downloadFailed', 'Falló la descarga o verificación (red, tamaño, URL o firma). Comprueba la conexión y reintenta.'],
  ['spawnFailed', 'No se pudo iniciar el instalador. Comprueba los permisos y reintenta.'],
  ['cleanupFailed', 'No se pudieron limpiar los archivos temporales de instalación.'],
  ['detectionUnknown', 'No se pudo comprobar la instalación. Actualiza las apps antes de reintentar.'],
  ['releaseChanged', 'La versión del catálogo ha cambiado. Actualiza el catálogo y reintenta.'],
  ['notAvailable', 'Esta app o versión ya no está disponible para instalar.'],
  ['alreadyInstalled', 'La app ya está instalada. Actualiza las apps.'],
  ['monitorFailed', 'No se pudo seguir el instalador y puede seguir ejecutándose. Comprueba su estado antes de reintentar.'],
] as const)('localizes %s without claiming success, with retry', async (status, message) => {
  native.install.mockResolvedValueOnce(status === 'installerFailed' ? { status, code: 42 } : { status });
  const { refresh } = await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  expect((await card('Alfa').findByRole('alert')).textContent).toBe(message);
  expect(card('Alfa').getByRole('button', { name: 'Reintentar Alfa' })).toBeTruthy();
  expect(screen.getByRole('article', { name: 'Alfa' })).toBeTruthy();
  expect(refresh).not.toHaveBeenCalledWith('installed');
});

it.each([
  ['urlNotAllowed', 'La URL del instalador no está permitida. Actualiza el catálogo.', 'The installer URL is not allowed. Refresh the catalog.'],
  ['hostNotAllowed', 'La redirección de descarga no está permitida. Actualiza el catálogo.', 'The download redirect is not allowed. Refresh the catalog.'],
  ['redirectLimit', 'La descarga tuvo demasiadas redirecciones. Reintenta más tarde.', 'The download had too many redirects. Retry later.'],
  ['networkFailed', 'Falló la descarga. Comprueba la conexión y reintenta.', 'The download failed. Check the connection and retry.'],
  ['connectTimedOut', 'Se agotó el tiempo de conexión. Comprueba la conexión y reintenta.', 'The connection timed out. Check the connection and retry.'],
  ['downloadTimedOut', 'Se agotó el tiempo de descarga. Comprueba la conexión y reintenta.', 'The download timed out. Check the connection and retry.'],
  ['tooLarge', 'El archivo de instalación supera el tamaño permitido. Actualiza el catálogo.', 'The installation file exceeds the allowed size. Refresh the catalog.'],
  ['lengthMismatch', 'La descarga está incompleta o tiene un tamaño inesperado. Reintenta.', 'The download is incomplete or has an unexpected size. Retry.'],
  ['storageFailed', 'No se pudieron guardar o leer los archivos temporales. Comprueba el espacio y los permisos.', 'Could not save or read temporary files. Check disk space and permissions.'],
  ['keyMissing', 'Falta la clave de verificación. Actualiza el catálogo.', 'The verification key is missing. Refresh the catalog.'],
  ['keyInvalid', 'La clave de verificación no es válida. Actualiza el catálogo.', 'The verification key is invalid. Refresh the catalog.'],
  ['signatureMalformed', 'La firma del instalador no tiene un formato válido. Actualiza el catálogo.', 'The installer signature has an invalid format. Refresh the catalog.'],
  ['signatureUnsupported', 'La firma del instalador usa un formato no admitido. Actualiza el catálogo.', 'The installer signature uses an unsupported format. Refresh the catalog.'],
  ['signatureInvalid', 'No se pudo verificar la firma del instalador. No se ha ejecutado.', 'The installer signature could not be verified. It was not run.'],
  ['assetNotAllowed', 'Este instalador no es compatible. Actualiza el catálogo.', 'This installer is not supported. Refresh the catalog.'],
] as const)('shows the specific %s error in both languages', async (status, es, en) => {
  native.install.mockResolvedValueOnce({ status });
  const { rerender, refresh } = await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  expect((await card('Alfa').findByRole('alert')).textContent).toBe(es);
  expect(refresh).not.toHaveBeenCalled();
  expect(card('Alfa').getByRole('button', { name: 'Reintentar Alfa' })).toBeTruthy();
  native.locale = 'en';
  rerender(<FlyoutPanel apps={[alfa]} news={[]} catalogState={{ status: 'ready', catalog }} onAppsRefresh={refresh} />);
  expect(card('Alfa').getByRole('alert').textContent).toBe(en);
  expect(native.install).toHaveBeenCalledTimes(1);
});

it.each(['before', 'after'] as const)('reports late cleanup failure arriving %s the timeout response, preserving the original error', async order => {
  const run = deferred<InstallResult>(); native.install.mockReturnValueOnce(run.promise);
  const { rerender, refresh } = await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  act(() => native.receive!({ id: 'alfa', phase: 'installing' }));
  const warning = { id: 'alfa', phase: 'installing' as const, cleanupFailed: true as const };
  if (order === 'before') act(() => native.receive!(warning));
  await act(async () => run.resolve({ status: 'timeout' }));
  if (order === 'after') act(() => native.receive!(warning));
  expect(card('Alfa').getAllByRole('alert').map(alert => alert.textContent)).toEqual([
    'El instalador tardó demasiado y puede seguir ejecutándose. Comprueba su estado antes de reintentar.',
    'No se pudieron limpiar los archivos temporales de instalación.',
  ]);
  rerender(<FlyoutPanel apps={[{ ...alfa, installed: true, installationState: 'installed', integration: 'local' }]} news={[]} catalogState={{ status: 'ready', catalog }} onAppsRefresh={refresh} />);
  expect(card('Alfa').getAllByRole('alert')).toHaveLength(2);
  expect((card('Alfa').getByRole('button', { name: 'Reintentar Alfa' }) as HTMLButtonElement).disabled).toBe(true);
  native.locale = 'en';
  rerender(<FlyoutPanel apps={[{ ...alfa, installed: true, installationState: 'installed', integration: 'local' }]} news={[]} catalogState={{ status: 'ready', catalog }} onAppsRefresh={refresh} />);
  expect(card('Alfa').getAllByRole('alert').map(alert => alert.textContent)).toEqual([
    'The installer timed out and may still be running. Check its status before retrying.',
    'Could not clean up temporary installation files.',
  ]);
});

it('keeps a targeted installed card visible for News but does not offer installation', () => {
  render(<CatalogView apps={[{ ...alfa, installed: true, installationState: 'installed', integration: 'local' }]} targetAppId="alfa" />);
  expect(card('Alfa').getByText('La app ya está instalada.')).toBeTruthy();
  expect(card('Alfa').queryByRole('button', { name: 'Instalar Alfa' })).toBeNull();
  expect(native.install).not.toHaveBeenCalled();
});

it('retries a failed progress subscription before allowing an installation', async () => {
  native.listen.mockRejectedValueOnce(new Error('private diagnostic'));
  await show([alfa]);
  expect((card('Alfa').getByRole('button', { name: 'Instalar Alfa' }) as HTMLButtonElement).disabled).toBe(true);
  expect(card('Alfa').getByText('No se puede seguir el progreso de instalación. Reintenta la conexión.')).toBeTruthy();
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect((card('Alfa').getByRole('button', { name: 'Instalar Alfa' }) as HTMLButtonElement).disabled).toBe(false));
  expect(native.install).not.toHaveBeenCalled();
});

it('retries an error through the same native ID and clears the previous alert', async () => {
  const run = deferred<InstallResult>();
  native.install.mockResolvedValueOnce({ status: 'feedFailed' }).mockReturnValueOnce(run.promise);
  await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  await card('Alfa').findByRole('alert');
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Reintentar Alfa' }));
  expect(native.install).toHaveBeenCalledTimes(2);
  expect(native.install).toHaveBeenLastCalledWith('alfa');
  expect(card('Alfa').queryByRole('alert')).toBeNull();
  await act(async () => run.resolve({ status: 'cancelled' }));
});

it('uses the real App refresh path after native installation', async () => {
  let scans = 0;
  native.invoke.mockImplementation(async (command: string) => command === 'installed_apps'
    ? [{ id: 'alfa', state: ++scans === 1 ? 'notInstalled' : 'installed', version: scans === 1 ? null : '7.0.0', reason: '' }]
    : null);
  const run = deferred<InstallResult>(); native.install.mockReturnValueOnce(run.promise);
  render(<App news={[]} />);
  select('Catálogo');
  await waitFor(() => expect((card('Alfa').getByRole('button', { name: 'Instalar Alfa' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  await act(async () => run.resolve({ status: 'installed', version: '7.0.0' }));
  await waitFor(() => expect(scans).toBe(2));
  expect(screen.queryByRole('article', { name: 'Alfa' })).toBeNull();
  select('Mis apps');
  fireEvent.click(await screen.findByRole('button', { name: /Alfa.*Estado de ejecución desconocido/ }));
  expect(screen.getByText('7.0.0')).toBeTruthy();
});

it('keeps tracking when cancellation fails and never claims it was cancelled', async () => {
  const run = deferred<InstallResult>(); native.install.mockReturnValueOnce(run.promise);
  native.cancel.mockRejectedValueOnce(new Error('private diagnostic'));
  await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Cancelar Alfa' }));
  expect((await card('Alfa').findByRole('alert')).textContent).toBe('No se pudo cancelar; la operación sigue en curso.');
  expect(card('Alfa').getByRole('button', { name: 'Cancelar Alfa' })).toBeTruthy();
  act(() => native.receive!({ id: 'alfa', phase: 'installing' }));
  expect(card('Alfa').queryByRole('button', { name: 'Cancelar Alfa' })).toBeNull();
  await act(async () => run.resolve({ status: 'notDetected' }));
  expect(card('Alfa').getByRole('alert').textContent).toContain('No se pudo confirmar');
});

it('rerenders progress and errors in the selected locale without losing the operation', async () => {
  const run = deferred<InstallResult>(); native.install.mockReturnValueOnce(run.promise);
  const { rerender, refresh } = await show([alfa]);
  fireEvent.click(card('Alfa').getByRole('button', { name: 'Instalar Alfa' }));
  act(() => native.receive!({ id: 'alfa', phase: 'downloading', received: 25, total: 100 }));
  native.locale = 'en';
  rerender(<FlyoutPanel apps={[alfa]} news={[]} catalogState={{ status: 'ready', catalog }} onAppsRefresh={refresh} />);
  expect(card('Alfa').getByText('Downloading…')).toBeTruthy();
  expect(card('Alfa').getByRole('progressbar', { name: 'Download of Alfa' }).getAttribute('aria-valuenow')).toBe('25');
  expect(card('Alfa').getByRole('button', { name: 'Cancel Alfa' })).toBeTruthy();
  await act(async () => run.resolve({ status: 'installerFailed', code: 42 }));
  expect(card('Alfa').getByRole('alert').textContent).toBe('The installer exited with code 42.');
  expect(card('Alfa').getByRole('button', { name: 'Retry Alfa' })).toBeTruthy();
});
