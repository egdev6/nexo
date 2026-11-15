// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { readFileSync } from 'node:fs';
import { defaultSettings } from './sample';
const css = readFileSync('src/style.css', 'utf8') as string;

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
  bridge.listeners.set(name, callback);
  return () => bridge.listeners.delete(name);
}) }));
vi.mock('./shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('./local-apps/view', () => ({ LocalAppsView: () => null }));
vi.mock('./news', () => ({ NewsPopup: () => null }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  bridge.listeners.clear();
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_settings') return { state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false } };
    if (command === 'get_flyout_motion') return { phase: 'hidden', sequence: 0 };
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0 };
    if (command === 'plugin:autostart|is_enabled') return false;
    return null;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function start() {
  render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('get_flyout_state'));
  return screen.getByRole('main');
}

it('leaves content stationary and does not subscribe to the old animation protocol', async () => {
  const panel = await start();
  expect(panel.className).not.toMatch(/flyout--(?:hidden|enter|exit)/);
  expect(bridge.listeners.has('flyout-motion')).toBe(false);
  expect(bridge.invoke).not.toHaveBeenCalledWith('get_flyout_motion');
  fireEvent.animationEnd(panel, { animationName: 'flyout-exit' });
  expect(bridge.invoke).not.toHaveBeenCalledWith('finish_flyout_hide', expect.anything());
});

it('keeps the close button and Escape requests routed through native hide', async () => {
  await start();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'hide_flyout')).toHaveLength(2);
  expect(bridge.invoke).not.toHaveBeenCalledWith('finish_flyout_hide', expect.anything());
});

it('hides on X without quitting, while a tray quit request invokes the definitive exit', async () => {
  await start();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  expect(bridge.invoke).toHaveBeenCalledWith('hide_flyout');
  expect(bridge.invoke).not.toHaveBeenCalledWith('quit_after_settings');
  expect(bridge.invoke).not.toHaveBeenCalledWith('hub_only_exit');

  await waitFor(() => expect(bridge.listeners.has('quit-requested')).toBe(true));
  bridge.listeners.get('quit-requested')?.({ payload: 'all' });
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('quit_after_settings'));
  expect(bridge.invoke).not.toHaveBeenCalledWith('hub_only_exit');
});

it('has no flyout slide or hidden transform while retaining reduced-motion protection', () => {
  expect(css).not.toMatch(/(?:\.flyout--(?:hidden|enter|exit)|@keyframes\s+flyout-(?:enter|exit))/);
  expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none\s*!important/);
});
