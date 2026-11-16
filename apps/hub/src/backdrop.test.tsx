// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import postcss from 'postcss';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { readFileSync } from 'node:fs';
import { FlyoutPanel } from './App';
import { defaultSettings } from './sample';
const css = readFileSync('src/style.css', 'utf8') as string;

const bridge = vi.hoisted(() => ({
  native: true,
  invoke: vi.fn(),
  getCurrentWindow: vi.fn(),
  onFocusChanged: vi.fn(),
  stop: vi.fn(),
  hide: vi.fn(),
  listener: undefined as undefined | ((event: { payload: boolean }) => void),
  events: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => bridge.native, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: bridge.getCurrentWindow }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, listener: (event: { payload: unknown }) => void) => {
  bridge.events.set(name, listener);
  return () => bridge.events.delete(name);
}) }));
vi.mock('./settings/use-settings', () => ({ useSettings: () => ({
  settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, opacity: 63, blur: 12 },
  fileState: 'ready', languageDraft: null, recordVisit: vi.fn(),
}) }));
vi.mock('./shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('./local-apps/view', () => ({ LocalAppsView: () => null }));
vi.mock('./news', () => ({ NewsPopup: () => null }));

beforeEach(() => {
  bridge.native = true;
  bridge.listener = undefined;
  bridge.events.clear();
  bridge.invoke.mockReset().mockImplementation(async (command: string) => command === 'get_flyout_state'
    ? { visible: false, sequence: 0, cycle: 0, at: 0 } : null);
  bridge.stop.mockReset();
  bridge.hide.mockReset().mockResolvedValue(undefined);
  bridge.onFocusChanged.mockReset().mockImplementation(async listener => { bridge.listener = listener; return bridge.stop; });
  bridge.getCurrentWindow.mockReset().mockReturnValue({ onFocusChanged: bridge.onFocusChanged, hide: bridge.hide });
});
afterEach(cleanup);

function visibility(visible: boolean, sequence: number, cycle: number) {
  act(() => bridge.events.get('flyout-visibility')!({ payload: { visible, sequence, cycle, at: 1 } }));
}

function focus(focused: boolean) {
  act(() => bridge.listener?.({ payload: focused }));
}

async function openPanel() {
  render(<FlyoutPanel apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('get_flyout_state'));
  visibility(true, 1, 1);
  focus(true);
  const panel = screen.getByRole('main');
  expect(panel.getAttribute('data-backdrop')).toBeNull();
  return panel;
}

it('uses opaque while unfocused and restores the configured translucent appearance on focus', async () => {
  const panel = await openPanel();
  expect(panel.style.getPropertyValue('--hub-opacity')).toBe('0.63');
  expect(panel.style.getPropertyValue('--hub-blur')).toBe('12px');
  focus(false);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  focus(true);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
  expect(panel.style.getPropertyValue('--hub-opacity')).toBe('0.63');
  expect(panel.style.getPropertyValue('--hub-blur')).toBe('12px');
});

it.each(['close button', 'Escape'] as const)('makes the backdrop opaque before the %s native exit request, then restores it on reopening', async action => {
  const panel = await openPanel();
  const atHide: (string | null)[] = [];
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'hide_flyout') atHide.push(panel.getAttribute('data-backdrop'));
    return null;
  });
  if (action === 'close button') fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  else fireEvent.keyDown(document, { key: 'Escape' });
  expect(atHide).toEqual(['opaque']);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  expect(bridge.invoke).not.toHaveBeenCalledWith('quit_after_settings');
  focus(false);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  // A refocus while the native exit is still running keeps the opaque backdrop.
  focus(true);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  // Reopening (a new visible cycle) with focus restores the translucent backdrop.
  visibility(true, 2, 2);
  focus(true);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
});

it('starts opaque on mount and stays opaque on the first show until focus is reported', async () => {
  render(<FlyoutPanel apps={[]} news={[]} />);
  const panel = screen.getByRole('main');
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('get_flyout_state'));
  visibility(true, 1, 1);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  focus(true);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
});

it('keeps a later native show without focus opaque until focus is reported', async () => {
  const panel = await openPanel();
  visibility(false, 2, 1);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  visibility(true, 3, 2);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  focus(true);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
});

it('removes the native focus listener on unmount', async () => {
  await openPanel();
  cleanup();
  expect(bridge.stop).toHaveBeenCalledOnce();
});

it('does not touch the native window in a browser preview', () => {
  bridge.native = false;
  render(<FlyoutPanel apps={[]} news={[]} />);
  const panel = screen.getByRole('main');
  fireEvent.blur(window);
  fireEvent.focus(window);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(panel.getAttribute('data-backdrop')).toBeNull();
  expect(bridge.getCurrentWindow).not.toHaveBeenCalled();
  expect(bridge.invoke).not.toHaveBeenCalled();
});

it('overrides the translucent backdrop without a transition, retaining the user-controlled normal rule', () => {
  const stylesheet = postcss.parse(css);
  const opaque = stylesheet.nodes.find(node => node.type === 'rule' && node.selector === '.flyout[data-backdrop="opaque"]');
  expect(opaque?.type).toBe('rule');
  if (!opaque || opaque.type !== 'rule') return;
  const properties = Object.fromEntries(opaque.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
  expect(properties.background).toBe('var(--color-surface-0)');
  expect(properties['backdrop-filter']).toBe('none');
  expect(properties.transition).toBe('none');
  expect(css).toContain('calc(var(--hub-opacity) * 100%)');
  expect(css).toContain('blur(var(--hub-blur))');
});
