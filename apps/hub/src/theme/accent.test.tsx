// @vitest-environment jsdom
import postcss from 'postcss';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
// @ts-ignore Vitest runs in Node; the browser tsconfig intentionally excludes Node types.
import { existsSync, readFileSync } from 'node:fs';
// @ts-ignore Same as above.
import { cwd } from 'node:process';
import mainSource from '../main.tsx?raw';
import { FlyoutPanel } from '../App';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));

const cssPath = `${cwd()}/src/theme/accent.css`;
const tokensPath = `${cwd()}/node_modules/@egdev/tokens/dist/tokens.css`;
const customSelector = '.flyout[data-custom-accent], .local-app-dialog[data-custom-accent]';
const names = [
  '--color-primitive-red-neon', '--color-primitive-red-dark', '--color-primitive-red-light', '--color-primitive-red-200', '--color-primitive-red-300', '--color-primitive-red-950',
  ...['07', '10', '12', '15', '18', '22', '30', '45', '65'].map(n => `--color-alpha-red-${n}`),
  '--logo-red', '--logo-red-shade', '--color-bg-deep', '--color-bg-flood', '--color-fg-on-flood', '--color-bg-brand-subtle', '--color-bg-brand-hover',
  '--color-fg-brand-default', '--color-fg-brand-hover', '--color-fg-brand-raised', '--color-border-brand', '--color-border-brand-strong',
  '--color-action-primary-bg-default', '--color-action-primary-bg-hover', '--color-action-primary-solid-bg', '--color-action-primary-solid-bg-hover', '--color-action-primary-solid-fg', '--color-focus-ring',
  '--gradient-btn-primary', '--gradient-btn-primary-hover', '--gradient-btn-secondary', '--gradient-btn-secondary-hover', '--gradient-chip-active', '--gradient-post-new', '--gradient-progress', '--gradient-section-show', '--gradient-hot',
  '--shadow-glow-base', '--shadow-glow-active', '--shadow-glow-intense', '--shadow-cta-hover', '--shadow-focus', '--shadow-card', '--shadow-glow-hot', '--shadow-ring-brand', '--shadow-btn-primary', '--shadow-btn-primary-hover', '--shadow-hot', '--text-shadow-title-hero',
];

function css() {
  expect(existsSync(cssPath), 'accent stylesheet exists').toBe(true);
  return readFileSync(cssPath, 'utf8') as string;
}
function declarations(source: string, selector: string) {
  const result = new Map<string, string>();
  postcss.parse(source).walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { result.set(declaration.prop, declaration.value); });
  });
  return result;
}
function referencesAccent(name: string, rules: Map<string, string>, seen = new Set<string>()): boolean {
  if (name.startsWith('--hub-accent')) return true;
  if (seen.has(name)) return false;
  const value = rules.get(name);
  if (!value) return false;
  const next = new Set(seen).add(name);
  return [...value.matchAll(/var\((--[\w-]+)/g)].some(match => referencesAccent(match[1], rules, next));
}
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const channels = hex.match(/[0-9a-f]{2}/gi)!.map(channel => {
      const c = parseInt(channel, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + 0.05) / (low + 0.05);
}
function clickTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 }); fireEvent.click(tab);
}

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

it('maps every Foundation brand token and derived shadow to the custom accent in the flyout and portalled dialog', () => {
  const rules = declarations(css(), customSelector);
  for (const name of names) {
    expect(rules.has(name), name).toBe(true);
    expect(referencesAccent(name, rules), `${name} must derive from the accent`).toBe(true);
  }
  expect(rules.get('--color-action-primary-solid-bg-hover')).toBe('color-mix(in srgb, var(--hub-accent-base) 80%, var(--hub-accent-contrast))');
  expect(rules.get('--color-fg-brand-hover')).toBe('color-mix(in srgb, var(--hub-accent-base) 30%, white)');
  expect(rules.has('--color-status-danger')).toBe(false);
  expect(rules.has('--color-status-success')).toBe(false);
  expect(mainSource.indexOf("import './theme/accent.css'")).toBeGreaterThan(mainSource.indexOf("import './theme/family.css'"));
});

it('keeps the existing default-red overrides and leaves the other Foundation values untouched', () => {
  const source = css();
  const rules = declarations(source, '.flyout');
  expect(Object.fromEntries(rules)).toEqual({
    '--color-fg-brand-default': 'var(--hub-accent-base)',
    '--color-fg-brand-raised': 'var(--hub-accent-light)',
    '--color-fg-brand-hover': 'var(--hub-accent-mid)',
    '--color-border-brand': 'var(--hub-accent-mid)',
    '--color-action-primary-solid-bg': 'var(--hub-accent-base)',
    '--color-action-primary-solid-bg-hover': 'var(--hub-accent-mid)',
  });
  const original = declarations(readFileSync(tokensPath, 'utf8'), ':root, :host');
  const originalRoot = declarations(readFileSync(tokensPath, 'utf8'), ':root');
  expect(original.get('--color-primitive-red-neon')).toBe('#FF0036');
  expect(original.get('--color-primitive-red-200')).toBe('#FF8FA6');
  expect(original.get('--shadow-focus')).toBe('0 0 0 2px #141518, 0 0 0 4px #FF0036');
  expect(originalRoot.get('--gradient-btn-primary')).toBe('linear-gradient(180deg, #FF2D57 0%, #FF0036 52%, #EE0031 100%)');
});

it('updates the flyout variables live, restores default red, and keeps button text contrast for light and dark custom accents', () => {
  const style = document.createElement('style');
  const tokenSource = readFileSync(tokensPath, 'utf8');
  const original = new Map([...declarations(tokenSource, ':root, :host'), ...declarations(tokenSource, ':root')]);
  style.textContent = `:root { ${[...original].map(([name, value]) => `${name}: ${value};`).join(' ')} }\n${css()}`;
  document.head.appendChild(style);
  try {
    render(<FlyoutPanel apps={[]} news={[]} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    const panel = screen.getByRole('main');
    expect(panel.hasAttribute('data-custom-accent')).toBe(false);
    expect(getComputedStyle(panel).getPropertyValue('--hub-accent')).toBe('#ff0036');
    fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
    clickTab('Apariencia');
    const input = screen.getByLabelText('Elegir cualquier color de acento');
    for (const color of ['#2e7dff', '#0000aa', '#777777', '#ffffff', '#123456']) {
      fireEvent.change(input, { target: { value: color } });
      expect(panel.hasAttribute('data-custom-accent')).toBe(true);
      const computed = getComputedStyle(panel);
      expect(computed.getPropertyValue('--hub-accent')).toBe(color);
      for (const name of names) expect(computed.getPropertyValue(name).trim(), name).not.toBe('');
      const base = computed.getPropertyValue('--hub-accent-base');
      expect(computed.getPropertyValue('--color-primitive-red-neon')).toBe(base);
      expect(computed.getPropertyValue('--color-action-primary-solid-bg')).toBe(base);
      expect(computed.getPropertyValue('--color-border-brand')).toBe(computed.getPropertyValue('--color-alpha-red-45'));
      expect(computed.getPropertyValue('--gradient-btn-primary')).toContain(base);
      const foreground = computed.getPropertyValue('--hub-accent-on');
      const opposite = computed.getPropertyValue('--hub-accent-contrast');
      expect(contrast(base, foreground)).toBeGreaterThanOrEqual(4.5);
      expect([foreground, opposite].sort()).toEqual(['#000000', '#ffffff']);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer rojo egdev' }));
    expect(panel.hasAttribute('data-custom-accent')).toBe(false);
    const red = getComputedStyle(panel);
    expect(red.getPropertyValue('--hub-accent-base')).toBe('#ff0036');
    expect(red.getPropertyValue('--hub-accent-light')).toBe('#ffebef');
    expect(red.getPropertyValue('--hub-accent-mid')).toBe('#ff859f');
    expect(red.getPropertyValue('--color-fg-brand-default')).toBe('#ff0036');
    expect(red.getPropertyValue('--color-fg-brand-raised')).toBe('#ffebef');
    expect(red.getPropertyValue('--color-fg-brand-hover')).toBe('#ff859f');
    expect(red.getPropertyValue('--color-border-brand')).toBe('#ff859f');
    expect(red.getPropertyValue('--color-primitive-red-neon')).toBe('#FF0036');
    expect(red.getPropertyValue('--gradient-btn-primary')).toBe(original.get('--gradient-btn-primary'));
    expect(red.getPropertyValue('--shadow-focus')).toBe(original.get('--shadow-focus'));
  } finally { style.remove(); }
});
