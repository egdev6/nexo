// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import postcss from 'postcss';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { readFileSync } from 'node:fs';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { cwd } from 'node:process';
import { FlyoutPanel } from './App';
import { defaultSettings } from './sample';
const css = readFileSync(`${cwd()}/src/style.css`, 'utf8') as string;

const bridge = vi.hoisted(() => ({
  native: true,
  opacity: 63,
  blur: 12,
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
  settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, opacity: bridge.opacity, blur: bridge.blur },
  fileState: 'ready', languageDraft: null, recordVisit: vi.fn(),
}) }));
vi.mock('./shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('./local-apps/view', () => ({ LocalAppsView: () => null }));
vi.mock('./news', () => ({ NewsPopup: () => null }));

beforeEach(() => {
  bridge.native = true;
  bridge.opacity = 63;
  bridge.blur = 12;
  bridge.listener = undefined;
  bridge.events.clear();
  bridge.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'get_flyout_state') return { visible: false, sequence: 0, cycle: 0, at: 0 };
    if (command === 'get_flyout_motion') return { phase: 'open', generation: 0, sequence: 0 };
    if (command === 'backdrop_available') return true;
    return null;
  });
  bridge.stop.mockReset();
  bridge.hide.mockReset().mockResolvedValue(undefined);
  bridge.onFocusChanged.mockReset().mockImplementation(async listener => { bridge.listener = listener; return bridge.stop; });
  bridge.getCurrentWindow.mockReset().mockReturnValue({ onFocusChanged: bridge.onFocusChanged, hide: bridge.hide });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function visibility(visible: boolean, sequence: number, cycle: number) {
  act(() => bridge.events.get('flyout-visibility')!({ payload: { visible, sequence, cycle, at: 1 } }));
}

function focus(focused: boolean) {
  act(() => bridge.listener?.({ payload: focused }));
}

function motion(phase: string, sequence: number) {
  act(() => bridge.events.get('flyout-motion')!({ payload: { phase, generation: sequence, sequence } }));
}

async function openPanel() {
  render(<FlyoutPanel apps={[]} news={[]} />);
  await waitFor(() => expect(screen.getByRole('main').classList.contains('flyout--waiting')).toBe(false));
  visibility(true, 1, 1);
  return screen.getByRole('main');
}

function measurePanel() {
  vi.stubGlobal('innerWidth', 480);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('devicePixelRatio', 1.25);
  const rectangle = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.matches('.main-tabs > [role="tabpanel"], .area-scroll') ? rectangle(0, 140, 480, 660) : rectangle(0, 0, 480, 800);
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
}

it('sends the physical content-only clip and live blur and opacity settings at rest', async () => {
  measurePanel();
  const view = render(<FlyoutPanel apps={[]} news={[]} />);
  const clip = { width: 600, height: 1000, x: 0, y: 175, contentWidth: 600, contentHeight: 825 };
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('set_surface_clip', { clip, blur: 12, opacity: 63, generation: 0 }));
  expect(screen.getByRole('main').style.getPropertyValue('--hub-opacity')).toBe('0.63');
  bridge.opacity = 60;
  bridge.blur = 0;
  view.rerender(<FlyoutPanel apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('set_surface_clip', { clip, blur: 0, opacity: 60, generation: 0 }));
  expect(screen.getByRole('main').style.getPropertyValue('--hub-opacity')).toBe('0.6');
  expect(screen.getByRole('main').style.getPropertyValue('--hub-blur')).toBe('0px');
  bridge.blur = 40;
  view.rerender(<FlyoutPanel apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('set_surface_clip', { clip, blur: 40, opacity: 60, generation: 0 }));
});

it('resends matching geometry after a native resize even if the measured rectangle is unchanged', async () => {
  measurePanel();
  await openPanel();
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('set_surface_clip', expect.objectContaining({ generation: 0 })));
  const calls = bridge.invoke.mock.calls.filter(([command]) => command === 'set_surface_clip').length;
  fireEvent.resize(window);
  await waitFor(() => expect(bridge.invoke.mock.calls.filter(([command]) => command === 'set_surface_clip').length).toBeGreaterThan(calls));
});

it('does not request a visible native backdrop during motion and remeasures on reopening', async () => {
  measurePanel();
  await openPanel();
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('set_surface_clip', expect.objectContaining({ generation: 0 })));
  motion('exiting', 1);
  const calls = bridge.invoke.mock.calls.filter(([command]) => command === 'set_surface_clip').length;
  motion('hidden', 2);
  motion('entering', 3);
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'set_surface_clip')).toHaveLength(calls);
  motion('open', 4);
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('set_surface_clip', expect.objectContaining({ generation: 4 })));
});

it('uses the configured translucent appearance at rest even when no focus event arrives', async () => {
  const panel = await openPanel();
  expect(panel.getAttribute('data-backdrop')).toBeNull();
  expect(panel.style.getPropertyValue('--hub-opacity')).toBe('0.63');
  expect(panel.style.getPropertyValue('--hub-blur')).toBe('12px');
  focus(false);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
  focus(true);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
  expect(panel.style.getPropertyValue('--hub-opacity')).toBe('0.63');
  expect(panel.style.getPropertyValue('--hub-blur')).toBe('12px');
});

it.each(['close button', 'Escape'] as const)('keeps the %s exit opaque only while motion is active', async action => {
  const panel = await openPanel();
  const atHide: (string | null)[] = [];
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'hide_flyout') atHide.push(panel.getAttribute('data-backdrop'));
    return null;
  });
  if (action === 'close button') fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  else fireEvent.keyDown(document, { key: 'Escape' });
  expect(atHide).toEqual([null]);
  expect(bridge.invoke).not.toHaveBeenCalledWith('quit_after_settings');
  motion('exiting', 1);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  focus(false);
  focus(true);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  motion('open', 2);
  visibility(true, 2, 2);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
});

it('starts opaque while waiting but becomes translucent on the first unfocused open', async () => {
  render(<FlyoutPanel apps={[]} news={[]} />);
  const panel = screen.getByRole('main');
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  await waitFor(() => expect(panel.classList.contains('flyout--waiting')).toBe(false));
  visibility(true, 1, 1);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
});

it('keeps entry opaque and restores translucency on a later open without focus', async () => {
  const panel = await openPanel();
  motion('hidden', 1);
  visibility(false, 2, 1);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  motion('entering', 2);
  visibility(true, 3, 2);
  expect(panel.getAttribute('data-backdrop')).toBe('opaque');
  motion('open', 3);
  expect(panel.getAttribute('data-backdrop')).toBeNull();
});

it('does not depend on a native focus subscription', async () => {
  await openPanel();
  expect(bridge.onFocusChanged).not.toHaveBeenCalled();
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

function declarations(selector: string) {
  const rule = postcss.parse(css).nodes.find(node => node.type === 'rule' && node.selector === selector);
  return rule?.type === 'rule' ? Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])) : {};
}

it.each([0, 63, 100])('keeps the title header opaque at %i percent panel opacity', async opacity => {
  bridge.opacity = opacity;
  const panel = await openPanel();
  const header = screen.getByRole('heading', { name: 'Nexo' }).closest('header');
  expect(header?.classList.contains('panel-head')).toBe(true);
  expect(panel.style.getPropertyValue('--hub-opacity')).toBe(String(opacity / 100));
  expect(declarations('.panel-head').background).toBe('var(--gradient-sheen), var(--color-surface-0)');
  // No hairline between the opaque title header and the opaque menu row.
  expect(declarations('.panel-head')['border-bottom']).toBeUndefined();
});

it.each([0, 63, 100])('keeps the entire menu row opaque at %i percent panel opacity', async opacity => {
  bridge.opacity = opacity;
  const panel = await openPanel();
  const tablist = screen.getByRole('tablist', { name: 'Secciones de Nexo' });
  expect(tablist.matches(".main-tabs > [role='tablist']")).toBe(true);
  expect(panel.style.getPropertyValue('--hub-opacity')).toBe(String(opacity / 100));
  expect(declarations('.main-tabs').isolation).toBe('isolate');
  const row = declarations(".main-tabs > [role='tablist']");
  expect(row.position).toBe('relative');
  expect(row['--menu-band-gutter']).toBe('var(--space-6)');
  // Spread shadows do not contribute to scrollable overflow. The extra pixel
  // overlaps the header, and the side offsets cover the rounded shadow corners.
  expect(row['box-shadow']).toBe([
    'var(--shadow-well)',
    '0 0 0 calc(var(--space-4) + 1px) var(--color-surface-0)',
    'calc(-1 * (var(--menu-band-gutter) + var(--radius-md))) 0 0 calc(var(--space-4) + 1px) var(--color-surface-0)',
    'calc(var(--menu-band-gutter) + var(--radius-md)) 0 0 calc(var(--space-4) + 1px) var(--color-surface-0)',
  ].join(', '));
  const media = postcss.parse(css).nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params === '(max-width: 400px)');
  const narrow = media?.type === 'atrule' ? media.nodes?.find(node => node.type === 'rule' && node.selector === ".main-tabs > [role='tablist']") : undefined;
  const narrowProps = narrow?.type === 'rule' ? Object.fromEntries(narrow.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])) : {};
  expect(narrowProps['--menu-band-gutter']).toBe('var(--space-4)');
  expect(narrowProps['margin-left']).toBe('var(--space-4)');
  expect(narrowProps['margin-right']).toBe('var(--space-4)');
});

it('does not create a scrollable menu band pseudo-element', () => {
  const pseudoRules: string[] = [];
  postcss.parse(css).walkRules(rule => {
    if (rule.selectors.includes(".main-tabs > [role='tablist']::before")) pseudoRules.push(rule.selector);
  });
  expect(pseudoRules).toEqual([]);
});

it('fits the full-width menu row inside the existing side gutters', async () => {
  await openPanel();
  const list = screen.getByRole('tablist', { name: 'Secciones de Nexo' });
  expect(list.classList.contains('w-full')).toBe(true);
  const row = declarations(".main-tabs > [role='tablist']");
  expect(row.width).toBe('auto');
  expect(row.margin).toBe('var(--space-4) var(--space-6) 0');
});

it('prevents the selected menu tab glow from bleeding above the opaque row without changing its border', async () => {
  await openPanel();
  const selector = ".main-tabs > [role='tablist'] > [role='tab'][aria-selected='true']";
  expect(screen.getByRole('tab', { name: 'Mis apps' }).matches(selector)).toBe(true);
  expect(screen.getByRole('tab', { name: 'Catálogo' }).matches(selector)).toBe(false);
  const family = postcss.parse(readFileSync(`${cwd()}/src/theme/family.css`, 'utf8') as string);
  const selected = family.nodes.find(node => node.type === 'rule' && node.selectors.includes(".flyout [role='tab'][aria-selected='true']"));
  const familyProps = selected?.type === 'rule' ? Object.fromEntries(selected.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])) : {};
  expect(familyProps['border-color']).toBe('var(--color-primitive-red-neon)');
  expect(familyProps.background).toBe('var(--gradient-chip-active), var(--color-surface-1)');
  expect(declarations(selector)).toEqual({ 'box-shadow': 'var(--shadow-edge-strong)' });
});

it('preserves navigation between the two menu tabs', async () => {
  await openPanel();
  const apps = screen.getByRole('tab', { name: 'Mis apps' });
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  expect(apps.getAttribute('aria-selected')).toBe('true');
  fireEvent.mouseDown(catalog, { button: 0 });
  fireEvent.click(catalog);
  expect(catalog.getAttribute('aria-selected')).toBe('true');
  expect(apps.getAttribute('aria-selected')).toBe('false');
});

it('keeps every static window ancestor explicitly transparent', () => {
  const stylesheet = postcss.parse(css);
  for (const selector of ['html', 'body', '#root']) {
    const rules = stylesheet.nodes.filter(node => node.type === 'rule' && node.selectors.includes(selector));
    const backgrounds = rules.flatMap(rule => rule.type === 'rule' ? rule.nodes.flatMap(node => node.type === 'decl' && node.prop === 'background' ? [node.value] : []) : []);
    expect(backgrounds.at(-1), selector).toBe('transparent');
  }
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

it('groups panel notices under the header with padding and an opaque background', async () => {
  await openPanel();
  const header = screen.getByRole('heading', { name: 'Nexo' }).closest('header')!;
  const notices = header.nextElementSibling as HTMLElement;
  expect(notices.classList.contains('panel-notices')).toBe(true);
  const rule = declarations('.panel-notices');
  expect(rule.padding).toBe('var(--space-3) var(--space-6) var(--space-1)');
  expect(rule.background).toBe('var(--color-surface-0)');
  expect(rule.display).toBe('grid');
  expect(rule.gap).toBe('var(--space-2)');
  expect(declarations('.panel-notices:empty').display).toBe('none');
});
