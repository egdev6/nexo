// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FlyoutPanel } from './App';
import { defaultSettings } from './sample';
import type { HubApp, Language } from './model';
import type { RegistrySnapshot } from './shell/registry';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), locale: 'es' as Language, publish: undefined as undefined | ((snapshot: RegistrySnapshot) => void) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('./catalog/install', () => ({ updateApp: vi.fn(), installApp: vi.fn(), cancelInstall: vi.fn(), onInstallProgress: native.listen }));
vi.mock('./settings/use-settings', () => ({ useSettings: () => ({ settings: { ...defaultSettings, language: native.locale, firstRunComplete: true, showNewsOnOpen: false, sources: [] }, fileState: 'ready', languageDraft: null, autostart: {}, recordVisit: vi.fn(), getVisit: () => null }) }));
vi.mock('./news/use-flyout', () => ({ useFlyoutVisibility: () => ({ visibility: null, lastShow: null, error: null }) }));
vi.mock('./shell/registry', () => ({ subscribeRegistry: vi.fn(async (publish: (snapshot: RegistrySnapshot) => void) => { native.publish = publish; return () => {}; }), exitHubOnly: vi.fn() }));
vi.mock('./window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));

const official: HubApp = { id: 'quorb', name: 'Quorb', description: 'Quorb', source: 'official', integration: 'complete', installed: true, running: false, statusKnown: true, installationState: 'installed', canOpen: true };
const notice = 'Quorb sigue abierta: puede que se haya ocultado en la bandeja. Ciérrala desde la propia app.';

beforeEach(() => {
  native.locale = 'es'; native.publish = undefined; native.invoke.mockReset(); native.listen.mockReset();
  native.listen.mockResolvedValue(() => {});
  native.invoke.mockImplementation(async (command: string) => command === 'local_apps_list' ? [] : command === 'close_official_app' ? { status: 'stillRunning', message: notice } : null);
});
afterEach(cleanup);

it.each([
  ['es', 'Abierta', 'Cerrar Quorb', 'Abrir Quorb'],
  ['en', 'Open', 'Close Quorb', 'Open Quorb'],
] as const)('shows the running status and close action in %s', async (locale, status, close, open) => {
  native.locale = locale;
  render(<FlyoutPanel apps={[{ ...official, runningState: 'running' }]} news={[]} catalogState={{ status: 'ready' }} onAppsRefresh={() => {}} />);
  expect(await screen.findByText(status)).toBeTruthy();
  expect(screen.getByRole('button', { name: close })).toBeTruthy();
  expect(screen.queryByRole('button', { name: open })).toBeNull();
});

it.each([
  ['es', 'Cerrada', 'Abrir Quorb', 'Cerrar Quorb'],
  ['en', 'Not running', 'Open Quorb', 'Close Quorb'],
] as const)('offers open for a stopped official app in %s', async (locale, status, open, close) => {
  native.locale = locale;
  render(<FlyoutPanel apps={[{ ...official, runningState: 'notRunning' }]} news={[]} catalogState={{ status: 'ready' }} onAppsRefresh={() => {}} />);
  expect(await screen.findByText(status)).toBeTruthy();
  expect(screen.getByRole('button', { name: open })).toBeTruthy();
  expect(screen.queryByRole('button', { name: close })).toBeNull();
});

it('requests graceful close by id, displays the returned tray notice and refreshes', async () => {
  const refresh = vi.fn();
  render(<FlyoutPanel apps={[{ ...official, runningState: 'running' }]} news={[]} catalogState={{ status: 'ready' }} onAppsRefresh={refresh} />);
  const close = await screen.findByRole('button', { name: 'Cerrar Quorb' });
  const trigger = screen.getByRole('button', { name: /^Quorb/, expanded: false });
  fireEvent.click(close);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(await screen.findByText(notice)).toBeTruthy();
  expect(native.invoke).toHaveBeenCalledWith('close_official_app', { id: 'quorb' });
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(native.invoke.mock.calls.some(([command]) => /kill|terminate/i.test(command))).toBe(false);
});

it('shows the localized English tray notice and refreshes after close', async () => {
  native.locale = 'en';
  const refresh = vi.fn();
  const englishNotice = 'Quorb is still open: it may have been hidden in the tray. Close it from within the app.';
  native.invoke.mockImplementation(async (command: string) => command === 'local_apps_list' ? [] : command === 'close_official_app' ? { status: 'stillRunning', message: englishNotice } : null);
  render(<FlyoutPanel apps={[{ ...official, runningState: 'running' }]} news={[]} catalogState={{ status: 'ready' }} onAppsRefresh={refresh} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Close Quorb' }));
  expect((await screen.findByText(englishNotice)).closest('[role="status"]')?.getAttribute('data-tone')).toBe('warning');
  expect(native.invoke).toHaveBeenCalledWith('close_official_app', { id: 'quorb' });
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});

it('preserves opening when the process status is unknown', async () => {
  const refresh = vi.fn();
  native.invoke.mockImplementation(async (command: string) => command === 'local_apps_list' ? [] : command === 'open_official_app' ? 'Inicio solicitado; no hay confirmación de ejecución' : null);
  render(<FlyoutPanel apps={[{ ...official, runningState: 'unknown' }]} news={[]} catalogState={{ status: 'ready' }} onAppsRefresh={refresh} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Abrir Quorb' }));
  expect(native.invoke).toHaveBeenCalledWith('open_official_app', { id: 'quorb' });
  expect(await screen.findByText('Inicio solicitado; no hay confirmación de ejecución')).toBeTruthy();
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});

it('keeps the connected plugin in priority over process-only controls', async () => {
  render(<FlyoutPanel apps={[{ ...official, runningState: 'running' }]} news={[]} catalogState={{ status: 'ready' }} onAppsRefresh={() => {}} />);
  await waitFor(() => expect(native.publish).toBeTypeOf('function'));
  act(() => native.publish!({ revision: 1, apps: [{ app: { id: 'quorb', name: 'Quorb', version: '1.0.0' }, capabilities: ['show', 'quit'], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  expect(screen.getByText('Conectada')).toBeTruthy();
  expect(screen.queryByText('Abierta')).toBeNull();
  expect(screen.getByRole('button', { name: 'Abrir Quorb' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cerrar Quorb' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Quorb.*Conectada/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar Quorb' }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('close_connected_app', { id: 'quorb' }));
});
