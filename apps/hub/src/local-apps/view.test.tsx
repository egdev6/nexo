// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FlyoutPanel } from '../App';
import type { HubApp } from '../model';
import { defaultSettings } from '../sample';
import type { LocalAppRow } from './index';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));

const official: HubApp = { id: 'official-id', name: 'Official Example', description: 'Official', source: 'official', integration: 'local', installed: true, running: false, statusKnown: true, installationState: 'installed', canOpen: true };
const rows: LocalAppRow[] = [
  { id: 'local:manual:1', source: 'local', name: 'Work', state: 'ready', origin: { kind: 'manual', id: 'manual-1' }, duplicateOf: 'official-id' },
  { id: 'local:manual:2', source: 'local', name: 'Broken', state: 'missingExecutable', origin: { kind: 'manual', id: 'manual-2' } },
];

beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_settings') return { state: 'ready', settings: { ...defaultSettings, language: 'en', firstRunComplete: true, showNewsOnOpen: false, sources: [] } };
    if (command === 'plugin:autostart|is_enabled' || command === 'backdrop_available') return false;
    if (command === 'local_apps_list') return rows;
    return null;
  });
});
afterEach(cleanup);

function card(name: string) {
  const element = screen.getByText(name).closest('.app-card');
  if (!element) throw new Error('Missing app row');
  return within(element as HTMLElement);
}
function expand(name: string) {
  const trigger = card(name).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!;
  if (trigger.getAttribute('aria-expanded') === 'false') fireEvent.click(trigger);
}

it('shows manual local rows after official apps with duplicate and availability warnings', async () => {
  render(<FlyoutPanel apps={[official]} news={[]} onAppsRefresh={() => {}} />);
  await screen.findByText('Work');
  const names = Array.from(document.querySelectorAll('.app-card strong')).map(node => node.textContent);
  expect(names).toEqual(['Official Example', 'Work', 'Broken']);
  expect(card('Work').getByText('Local')).toBeTruthy();
  expand('Work');
  expect(card('Work').getByText('Added manually')).toBeTruthy();
  expect(card('Work').getByText('Running status unknown')).toBeTruthy();
  expect(card('Work').getByText('Possible duplicate of Official Example')).toBeTruthy();
  expect((card('Work').getByRole('button', { name: 'Open Work' }) as HTMLButtonElement).disabled).toBe(false);
  expand('Broken');
  expect(card('Broken').getByText('Executable missing or inaccessible')).toBeTruthy();
  expect((card('Broken').getByRole('button', { name: 'Open Broken' }) as HTMLButtonElement).disabled).toBe(true);
  expect(card('Broken').getByRole('button', { name: 'Repair Broken' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Close (Work|Broken)/ })).toBeNull();
  expect(bridge.invoke).toHaveBeenCalledWith('local_apps_list');
});

it('opens only by opaque manual ID and reports a request, not running state', async () => {
  render(<FlyoutPanel apps={[official]} news={[]} onAppsRefresh={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Work' }));
  const status = (await screen.findByText('Launch requested; execution is not confirmed')).closest('[role="status"]');
  expect(status?.classList.contains('eg-notice')).toBe(true);
  expect(status?.getAttribute('data-tone')).toBe('success');
  expect(bridge.invoke).toHaveBeenCalledWith('local_app_open', { id: 'manual-1' });
  expect(card('Work').getByText('Running status unknown')).toBeTruthy();
  expect(bridge.invoke.mock.calls.some(([command]) => /kill|terminate/.test(command))).toBe(false);
});

it('localizes launch failures and keeps the stored rows unchanged', async () => {
  const original = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'local_app_open') throw 'nexo.local.spawnFailed';
    return original(command);
  });
  render(<FlyoutPanel apps={[official]} news={[]} onAppsRefresh={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open Work' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('Could not start the local app.');
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(alert.dataset.size).toBe('sm');
  expect(card('Work').getByText('Running status unknown')).toBeTruthy();
  expect(rows).toHaveLength(2);
  expect(bridge.invoke).toHaveBeenCalledWith('local_app_open', { id: 'manual-1' });
  expect(bridge.invoke.mock.calls.some(([command]) => /update|remove|bind/.test(command))).toBe(false);
});

it('reports a failed local app list as a compact alert', async () => {
  const original = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'local_apps_list') throw 'nexo.local.spawnFailed';
    return original(command);
  });
  render(<FlyoutPanel apps={[official]} news={[]} onAppsRefresh={() => {}} />);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('Could not start the local app.');
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(alert.dataset.size).toBe('sm');
  expect(screen.queryByText('Work')).toBeNull();
});

it('uses the native picker for repair and preserves cancellation', async () => {
  render(<FlyoutPanel apps={[official]} news={[]} onAppsRefresh={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Repair Broken' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('local_app_repair', { id: 'manual-2' }));
  await waitFor(() => expect((card('Broken').getByRole('button', { name: 'Repair Broken' }) as HTMLButtonElement).disabled).toBe(false));
  expand('Broken');
  expect(card('Broken').getByText('Executable missing or inaccessible')).toBeTruthy();
  expect(bridge.invoke.mock.calls.some(([command]) => command.startsWith('local_catalog_'))).toBe(false);
});

it('refreshes local state and ignores an older list result', async () => {
  let finishOld!: (value: LocalAppRow[]) => void;
  let lists = 0;
  const original = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'local_apps_list') {
      lists++;
      if (lists === 2) return new Promise<LocalAppRow[]>(resolve => { finishOld = resolve; });
      if (lists === 3) return [{ ...rows[0], name: 'New name' }];
    }
    return original(command);
  });
  render(<FlyoutPanel apps={[official]} news={[]} onAppsRefresh={() => {}} />);
  await screen.findByText('Work');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh local apps' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh local apps' }));
  expect(await screen.findByText('New name')).toBeTruthy();
  await act(async () => finishOld(rows));
  expect(screen.queryByText('Work')).toBeNull();
  expect(screen.getByText('New name')).toBeTruthy();
});
