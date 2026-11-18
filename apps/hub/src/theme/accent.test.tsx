// @vitest-environment jsdom
import postcss from 'postcss';
import { createAccentTheme } from '@egdev/tokens/accent';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
// @ts-ignore Vitest runs in Node; the browser tsconfig intentionally excludes Node types.
import { readFileSync } from 'node:fs';
import mainSource from '../main.tsx?raw';
import { FlyoutPanel } from '../App';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));

const customSelector = '.flyout[data-custom-accent], .local-app-dialog[data-custom-accent], .local-app-alert-dialog[data-custom-accent]';
const appTokens = [
  '--color-primitive-red-neon', '--color-primitive-red-dark', '--color-primitive-red-light', '--color-primitive-red-200', '--color-primitive-red-300', '--color-primitive-red-950',
  ...['07', '10', '12', '15', '18', '22', '30', '45', '65'].map(n => `--color-alpha-red-${n}`),
  '--logo-red', '--logo-red-shade', '--color-bg-deep', '--color-bg-flood', '--color-fg-on-flood', '--color-bg-brand-subtle', '--color-bg-brand-hover',
  '--color-action-primary-bg-default', '--color-action-primary-bg-hover',
  '--gradient-btn-secondary', '--gradient-btn-secondary-hover', '--gradient-chip-active', '--gradient-post-new', '--gradient-progress', '--gradient-section-show', '--gradient-hot',
  '--shadow-glow-base', '--shadow-glow-active', '--shadow-glow-intense', '--shadow-cta-hover', '--shadow-card', '--shadow-glow-hot', '--shadow-ring-brand', '--shadow-hot', '--text-shadow-title-hero',
];

function declarations(source: string, selector: string) {
  const result = new Map<string, string>();
  postcss.parse(source).walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { result.set(declaration.prop, declaration.value); });
  });
  return result;
}
function contrastWithBlack(hex: string) {
  const channels = hex.match(/[0-9a-f]{2}/gi)!.map(channel => {
    const c = parseInt(channel, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] + 0.05) / 0.05;
}
function clickTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab);
}
function expectTheme(scope: HTMLElement, accent: string) {
  const theme = createAccentTheme(accent);
  expect(scope.style.getPropertyValue('--hub-accent')).toBe(theme.normalizedAccent);
  for (const [name, value] of Object.entries(theme.variables)) expect(scope.style.getPropertyValue(name), name).toBe(value);
}

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

it('retains only accent-dependent roles the helper does not provide', () => {
  const source = readFileSync('src/theme/accent.css', 'utf8') as string;
  const rules = declarations(source, customSelector);
  expect([...rules.keys()].sort()).toEqual([...appTokens].sort());
  for (const name of Object.keys(createAccentTheme('#123456').variables)) expect(rules.has(name), name).toBe(false);
  expect(declarations(source, '.flyout').size).toBe(0);
  expect(rules.get('--color-primitive-red-neon')).toBe('var(--hub-accent)');
  expect(rules.get('--color-bg-flood')).toBe('var(--color-action-primary-solid-bg)');
  expect(rules.get('--color-fg-on-flood')).toBe('var(--color-action-primary-solid-fg)');
  expect(rules.has('--color-status-danger')).toBe(false);
  expect(rules.has('--color-status-success')).toBe(false);
  expect(mainSource.indexOf("import './theme/accent.css'")).toBeGreaterThan(mainSource.indexOf("import './theme/family.css'"));
});

it('updates the complete DS theme for custom accents and restores the default', () => {
  render(<FlyoutPanel apps={[]} news={[]} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
  const panel = screen.getByRole('main');
  expect(panel.hasAttribute('data-custom-accent')).toBe(false);
  expectTheme(panel, '#ff0036');
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  clickTab('Apariencia');
  const input = screen.getByLabelText('Elegir cualquier color de acento');
  for (const color of ['#2e7dff', '#0000aa', '#777777', '#ffffff', '#123456']) {
    fireEvent.change(input, { target: { value: color } });
    expect(panel.hasAttribute('data-custom-accent')).toBe(true);
    expectTheme(panel, color);
    expect(panel.style.getPropertyValue('--color-action-primary-solid-fg')).toBe('var(--color-primitive-black)');
    expect(contrastWithBlack(panel.style.getPropertyValue('--color-action-primary-solid-bg'))).toBeGreaterThanOrEqual(4.6);
  }
  expect(panel.style.getPropertyValue('--color-action-primary-solid-bg')).not.toBe('#123456');
  fireEvent.click(screen.getByRole('button', { name: 'Restablecer rojo egdev' }));
  expect(panel.hasAttribute('data-custom-accent')).toBe(false);
  expectTheme(panel, '#ff0036');
});
