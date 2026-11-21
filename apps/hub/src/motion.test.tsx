// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { readFileSync } from 'node:fs';
import { defaultSettings } from './sample';
const css = readFileSync('src/style.css', 'utf8') as string;

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  reduced: false,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    bridge.listeners.set(name, callback);
    return () => bridge.listeners.delete(name);
  }),
}));
vi.mock('./shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('./local-apps/view', () => ({ LocalAppsView: () => null }));
vi.mock('./news', () => ({ NewsPopup: () => null }));

beforeEach(() => {
  bridge.reduced = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: bridge.reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  bridge.listeners.clear();
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_settings') return { state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false } };
    if (command === 'get_flyout_motion') return { phase: 'hidden', generation: 0 };
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0 };
    if (command === 'plugin:autostart|is_enabled') return false;
    return null;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function start() {
  render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.listeners.has('flyout-motion')).toBe(true));
  return screen.getByRole('main');
}
function motion(phase: string, generation: number) {
  act(() => bridge.listeners.get('flyout-motion')!({ payload: { phase, generation } }));
}
function end(panel: HTMLElement) {
  fireEvent.transitionEnd(panel, { propertyName: 'transform' });
}
function acknowledgements() {
  return bridge.invoke.mock.calls.filter(([command]) => command === 'flyout_motion_finished');
}

it('waits offscreen, starts entry only after the native event, stays opaque and acknowledges the completed transform', async () => {
  const panel = await start();
  expect(panel.classList.contains('flyout--waiting')).toBe(true);
  motion('waiting', 1);
  expect(panel.classList.contains('flyout--waiting')).toBe(true);
  motion('entering', 1);
  expect(panel.classList.contains('flyout--entering')).toBe(true);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  expect(document.body.hasAttribute('data-flyout-sliding')).toBe(true);
  fireEvent.transitionEnd(panel.firstElementChild!, { propertyName: 'transform' });
  fireEvent.transitionEnd(panel, { propertyName: 'opacity' });
  expect(acknowledgements()).toHaveLength(0);
  end(panel);
  expect(acknowledgements()).toEqual([['flyout_motion_finished', { generation: 1 }]]);
  end(panel);
  expect(acknowledgements()).toHaveLength(1);
  motion('open', 2);
  expect(panel.classList.contains('flyout--entering')).toBe(false);
  expect(document.body.hasAttribute('data-flyout-sliding')).toBe(false);
});

it('keeps exit opaque and acknowledges it only after its transition', async () => {
  const panel = await start();
  motion('open', 1);
  motion('exiting', 2);
  expect(panel.classList.contains('flyout--exiting')).toBe(true);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  expect(acknowledgements()).toHaveLength(0);
  end(panel);
  expect(acknowledgements()).toEqual([['flyout_motion_finished', { generation: 2 }]]);
  motion('hidden', 3);
  expect(panel.classList.contains('flyout--waiting')).toBe(true);
});

it('ignores stale events and acknowledges only the latest direction after cancellation', async () => {
  const panel = await start();
  motion('entering', 1);
  motion('exiting', 2);
  motion('entering', 3);
  motion('exiting', 2);
  expect(panel.classList.contains('flyout--entering')).toBe(true);
  end(panel);
  expect(acknowledgements()).toEqual([['flyout_motion_finished', { generation: 3 }]]);
});

it('acknowledges immediately without a transform when reduced motion is requested', async () => {
  bridge.reduced = true;
  const panel = await start();
  motion('entering', 1);
  expect(panel.classList.contains('flyout--entering')).toBe(false);
  expect(acknowledgements()).toEqual([['flyout_motion_finished', { generation: 1 }]]);
  motion('exiting', 2);
  expect(panel.classList.contains('flyout--exiting')).toBe(false);
  expect(acknowledgements()).toEqual([
    ['flyout_motion_finished', { generation: 1 }],
    ['flyout_motion_finished', { generation: 2 }],
  ]);
});

it('keeps the close button and Escape requests routed through native hide', async () => {
  await start();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  expect(screen.getByRole('region', { name: 'Ajustes' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'hide_flyout')).toHaveLength(2);
  expect(bridge.invoke).not.toHaveBeenCalledWith('quit_after_settings');
});

it('specifies a 200 ms rightward slide, transparent surroundings and no reduced-motion transform', () => {
  expect(css).toMatch(/\.flyout--waiting[\s\S]*translateX\(100%\)/);
  expect(css).toMatch(/\.flyout--entering[\s\S]*transition:[^;]*transform[^;]*200ms[^;]*ease-out/);
  expect(css).toMatch(/\.flyout--exiting[\s\S]*translateX\(100%\)/);
  expect(css).toMatch(/body\[data-flyout-sliding\]\s*>\s*:not\(#root\)[\s\S]*visibility:\s*hidden/);
  expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transform:\s*none/);
});
