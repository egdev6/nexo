// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import postcss from 'postcss';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { readFileSync } from 'node:fs';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { cwd } from 'node:process';
import { FlyoutPanel } from '../App';
import { sampleNews } from '../sample';

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  events: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, listener: (event: { payload: unknown }) => void) => {
  bridge.events.set(name, listener);
  return () => bridge.events.delete(name);
}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }) }));
vi.mock('../settings/use-settings', async importOriginal => {
  const { defaultSettings } = await import('../sample');
  return { ...(await importOriginal<typeof import('../settings/use-settings')>()), useSettings: () => ({
    settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: true, opacity: 63, blur: 12 },
    fileState: 'ready', languageDraft: null, recordVisit: vi.fn(), getVisit: () => null,
  }) };
});
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('../local-apps/view', () => ({ LocalAppsView: () => null }));

beforeEach(() => {
  bridge.events.clear();
  bridge.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'get_flyout_motion') return { phase: 'hidden', generation: 0, sequence: 0 };
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0 };
    return null;
  });
});
afterEach(cleanup);

function emit(name: string, payload: unknown) {
  act(() => bridge.events.get(name)!({ payload }));
}
function declarations(path: string, selector: string) {
  const css = readFileSync(`${cwd()}/src/${path}`, 'utf8') as string;
  const rule = postcss.parse(css).nodes.find(node => node.type === 'rule' && node.selector === selector);
  if (!rule || rule.type !== 'rule') throw new Error(`Missing ${selector}`);
  return Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
}

it('keeps the real news modal and its scrim inside the sliding panel for entry and exit', async () => {
  render(<FlyoutPanel apps={[]} news={sampleNews} />);
  await waitFor(() => expect(bridge.events.has('flyout-motion') && bridge.events.has('flyout-visibility')).toBe(true));
  const panel = screen.getByRole('main');
  emit('flyout-motion', { phase: 'waiting', generation: 1, sequence: 1 });
  emit('flyout-visibility', { visible: true, sequence: 1, cycle: 1, at: '2026-01-01T00:00:00.000Z' });
  const dialog = await screen.findByRole('dialog', { name: 'Novedades al abrir' });
  const overlay = dialog.closest('.news-overlay');
  expect(overlay?.parentElement).toBe(panel);
  expect(overlay?.querySelector('.news-scrim')).toBeTruthy();

  emit('flyout-motion', { phase: 'entering', generation: 1, sequence: 2 });
  expect(panel.classList.contains('flyout--entering')).toBe(true);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  expect(panel.contains(dialog)).toBe(true);
  emit('flyout-motion', { phase: 'open', generation: 2, sequence: 3 });
  expect(panel.getAttribute('data-backdrop')).toBeNull();
  expect(panel.style.getPropertyValue('--hub-opacity')).toBe('0.63');
  expect(panel.style.getPropertyValue('--hub-blur')).toBe('12px');
  emit('flyout-motion', { phase: 'exiting', generation: 3, sequence: 4 });
  expect(panel.classList.contains('flyout--exiting')).toBe(true);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  expect(panel.contains(dialog)).toBe(true);
  emit('flyout-motion', { phase: 'hidden', generation: 4, sequence: 5 });
  emit('flyout-visibility', { visible: false, sequence: 2, cycle: 1, at: '2026-01-01T00:00:01.000Z' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('clips the modal and scrim to the positioned, painted sliding panel', () => {
  const panel = declarations('style.css', '.flyout');
  const opaque = declarations('style.css', '.flyout[data-backdrop="opaque"]');
  const overlay = declarations('news/news.css', '.news-overlay');
  const scrim = declarations('news/news.css', '.news-scrim');
  expect(panel.position).toBe('relative');
  expect(panel.overflow).toBe('hidden');
  expect(opaque.background).toBe('var(--color-surface-0)');
  expect(overlay.position).toBe('absolute');
  expect(overlay.inset).toBe('0');
  expect(scrim.position).toBe('absolute');
  expect(scrim.inset).toBe('0');
});
