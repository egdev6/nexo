// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FlyoutPanel } from '../App';
import type { HubApp } from '../model';
import { defaultSettings } from '../sample';

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), publish: undefined as undefined | ((value: unknown) => void), visibility: undefined as undefined | ((event: { payload: unknown }) => void) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => { if (name === 'flyout-visibility') bridge.visibility = callback; return () => {}; }) }));
vi.mock('../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn(async (publish: (value: unknown) => void) => { bridge.publish = publish; return () => {}; }), exitHubOnly: vi.fn() }));

const installed: HubApp = { id: 'example', name: 'Example', description: 'Original', source: 'official', integration: 'local', installed: true, running: false, statusKnown: true, installationState: 'installed', runningState: 'unknown', version: '9.1', canOpen: true };
const unknown: HubApp = { id: 'missing', name: 'Missing', description: 'Original', source: 'official', integration: 'catalog', installed: false, running: false, statusKnown: false, installationState: 'unknown', installationReason: 'Sin datos de detección en el catálogo' };

beforeEach(() => {
  bridge.invoke.mockReset(); bridge.publish = undefined; bridge.visibility = undefined;
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_settings') return { state: 'ready', settings: { ...defaultSettings, language: 'en', firstRunComplete: true, showNewsOnOpen: false, sources: [] } };
    if (command === 'plugin:autostart|is_enabled') return false;
    if (command === 'get_flyout_state') return null;
    if (command === 'local_apps_list') return [];
    if (command === 'close_connected_app') throw 'cambios sin guardar';
    return undefined;
  });
});
afterEach(cleanup);

it('localizes installation, open and unknown reasons without translating app data', async () => {
  render(<FlyoutPanel apps={[installed, unknown]} news={[]} onAppsRefresh={() => {}} />);
  expect(await screen.findByText('Installed: 9.1')).toBeTruthy();
  expect(screen.getByText('Running status unknown')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open Example' })).toBeTruthy();
  const region = screen.getByRole('region', { name: 'Installation unknown' });
  expect(within(region).getByText('Missing')).toBeTruthy();
  expect(within(region).getByText('No detection information in the catalog')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh apps' })).toBeTruthy();
});

it('localizes connected controls and preserves the app-provided refusal verbatim', async () => {
  render(<FlyoutPanel apps={[installed]} news={[]} onAppsRefresh={() => {}} />);
  await screen.findByText('Installed: 9.1');
  act(() => bridge.publish!({ revision: 1, apps: [{ app: { id: 'example', name: 'Example', version: '2.0' }, capabilities: ['show', 'quit'], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  expect(screen.getByRole('button', { name: 'Open Example' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close Example' }));
  expect((await screen.findByRole('alert')).textContent).toContain('cambios sin guardar');
  expect(bridge.invoke).toHaveBeenCalledWith('close_connected_app', { id: 'example' });
});

it('localizes a launch failure while preserving the OS diagnostic', async () => {
  const original = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'open_official_app') throw 'No se pudo iniciar la app: acceso denegado';
    return original(command);
  });
  render(<FlyoutPanel apps={[installed]} news={[]} onAppsRefresh={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Example' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Could not start the app: acceso denegado');
  expect(bridge.invoke).toHaveBeenCalledWith('open_official_app', { id: 'example' });
});

it('refreshes installation observations when the flyout is shown again', async () => {
  const refresh = vi.fn();
  render(<FlyoutPanel apps={[]} news={[]} onAppsRefresh={refresh} />);
  await waitFor(() => expect(bridge.visibility).toBeTypeOf('function'));
  act(() => bridge.visibility!({ payload: { visible: true, sequence: 1, cycle: 1, at: 1 } }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  act(() => bridge.visibility!({ payload: { visible: false, sequence: 2, cycle: 1, at: 2 } }));
  act(() => bridge.visibility!({ payload: { visible: true, sequence: 3, cycle: 2, at: 3 } }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
});
