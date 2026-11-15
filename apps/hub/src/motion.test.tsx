// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { readFileSync } from 'node:fs';
const css = readFileSync('src/style.css', 'utf8') as string;
import { defaultSettings } from './sample';

// React selects its animation event name on import. jsdom has WebKit style
// properties but no AnimationEvent, so provide the standard browser event first.
vi.hoisted(() => {
  if (!('AnimationEvent' in window)) {
    class BrowserAnimationEvent extends Event {
      readonly animationName: string;
      readonly elapsedTime: number;
      readonly pseudoElement: string;
      constructor(type: string, init: AnimationEventInit = {}) {
        super(type, init);
        this.animationName = init.animationName ?? '';
        this.elapsedTime = init.elapsedTime ?? 0;
        this.pseudoElement = init.pseudoElement ?? '';
      }
    }
    Object.defineProperty(window, 'AnimationEvent', { configurable: true, value: BrowserAnimationEvent });
  }
});

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

let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  bridge.listeners.clear();
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_settings') return { state: 'ready', settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false } };
    if (command === 'get_flyout_motion') return { phase: 'hidden', sequence: 0 };
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0 };
    return null;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function start() {
  render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.listeners.has('flyout-motion')).toBe(true));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('get_flyout_motion'));
  return screen.getByRole('main');
}
function motion(phase: 'enter' | 'exit' | 'hidden', sequence: number) {
  act(() => bridge.listeners.get('flyout-motion')?.({ payload: { phase, sequence } }));
}
function finishAnimation(panel: HTMLElement, animationName = 'flyout-exit') {
  fireEvent.animationEnd(panel, { animationName });
}

it('animates each native show from the right and waits for exit completion before hiding', async () => {
  const panel = await start();
  expect(panel.classList.contains('flyout--hidden')).toBe(true);
  motion('enter', 1);
  expect(panel.classList.contains('flyout--enter')).toBe(true);
  motion('exit', 2);
  expect(panel.classList.contains('flyout--exit')).toBe(true);
  expect(bridge.invoke).not.toHaveBeenCalledWith('finish_flyout_hide', expect.anything());
  finishAnimation(screen.getByRole('button', { name: 'Cerrar panel' }));
  finishAnimation(panel, 'flyout-enter');
  expect(bridge.invoke).not.toHaveBeenCalledWith('finish_flyout_hide', expect.anything());
  finishAnimation(panel);
  expect(bridge.invoke).toHaveBeenCalledWith('finish_flyout_hide', { sequence: 2 });
  finishAnimation(panel);
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'finish_flyout_hide')).toHaveLength(1);
  motion('hidden', 3);
  expect(panel.classList.contains('flyout--hidden')).toBe(true);
  motion('enter', 4);
  expect(panel.classList.contains('flyout--enter')).toBe(true);
});

it('ignores stale completion after a reopen and preserves close and Escape requests', async () => {
  const panel = await start();
  motion('enter', 1);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  expect(bridge.invoke).toHaveBeenCalledWith('hide_flyout');
  motion('exit', 2);
  motion('enter', 3);
  finishAnimation(panel);
  expect(bridge.invoke).not.toHaveBeenCalledWith('finish_flyout_hide', expect.anything());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'hide_flyout')).toHaveLength(2);
});

it('finishes a reduced-motion exit immediately without waiting for an animation', async () => {
  reduced = true;
  const panel = await start();
  motion('enter', 1);
  motion('exit', 2);
  expect(panel.classList.contains('flyout--exit')).toBe(true);
  expect(bridge.invoke).toHaveBeenCalledWith('finish_flyout_hide', { sequence: 2 });
});

it('defines horizontal right-edge entry and exit and disables motion for reduced-motion users', () => {
  expect(css).toMatch(/@keyframes\s+flyout-enter\s*\{\s*from\s*\{[^}]*translateX\(100%\)/);
  expect(css).toMatch(/@keyframes\s+flyout-exit\s*\{\s*to\s*\{[^}]*translateX\(100%\)/);
  expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none\s*!important/);
});
