// @vitest-environment jsdom
import { Link, Slider } from '@egdev/ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import postcss from 'postcss';
import { createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
// @ts-ignore Vitest runs in Node; the browser tsconfig excludes Node types.
import { readFileSync } from 'node:fs';
// @ts-ignore Same as above.
import { cwd } from 'node:process';
import { FirstRun } from '../first-run';

const family = postcss.parse(readFileSync(`${cwd()}/src/theme/family.css`, 'utf8') as string);
const paint = new Set(['background', 'background-color', 'background-image', 'border', 'border-color', 'box-shadow', 'color']);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function paintFor(element: Element) {
  const declarations: [string, string][] = [];
  family.walkRules(rule => {
    if (rule.selectors.some(selector => element.matches(selector))) {
      rule.walkDecls(decl => { if (paint.has(decl.prop)) declarations.push([decl.prop, decl.value]); });
    }
  });
  return declarations;
}

function propertiesFor(selector: string) {
  const declarations: Record<string, string> = {};
  family.walkRules(rule => {
    if (rule.selectors.includes(selector)) rule.walkDecls(decl => { declarations[decl.prop] = decl.value; });
  });
  return declarations;
}

it('lets the DS paint and focus the selected first-run language without overriding either choice', () => {
  const onPreview = vi.fn();
  render(createElement('main', { className: 'flyout' }, createElement(FirstRun, { onChoose: vi.fn(), onPreview })));
  const spanish = screen.getByRole('radio', { name: 'Español' });
  const english = screen.getByRole('radio', { name: 'English' });
  for (const choice of [spanish, english]) {
    const card = choice.closest('.eg-tile')!;
    expect(card.classList.contains('has-[[data-state=checked]]:border-border-brand')).toBe(true);
    expect(card.classList.contains('has-[[data-state=checked]]:bg-surface-3')).toBe(true);
    expect(choice.classList.contains('focus-visible:shadow-focus')).toBe(true);
    expect(paintFor(card)).toEqual([]);
  }
  const choiceSelectors: string[] = [];
  family.walkRules(rule => { choiceSelectors.push(...rule.selectors.filter(selector => selector.includes('.first-run__choices'))); });
  expect(choiceSelectors).toEqual([]);
  expect(spanish.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(english);
  expect(english.getAttribute('aria-checked')).toBe('true');
  expect(spanish.getAttribute('aria-checked')).toBe('false');
  expect(onPreview).toHaveBeenLastCalledWith('en');
});

it('keeps the slider track contrast on the DS boundary role and lets the DS paint the range', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  render(createElement('main', { className: 'flyout' }, createElement(Slider, { label: 'Opacity', defaultValue: 63 })));
  const slider = screen.getByRole('slider', { name: 'Opacity' });
  const root = slider.closest('.eg-slider')!;
  const track = root.firstElementChild!;
  const range = track.firstElementChild!;
  expect(slider.getAttribute('aria-valuenow')).toBe('63');
  expect(track.classList.contains('bg-control-well')).toBe(true);
  expect(range.classList.contains('bg-state-selected')).toBe(true);
  expect({ track: paintFor(track), range: paintFor(range) }).toEqual({
    track: [['background', 'var(--color-control-boundary)']],
    range: [],
  });
});

it('keeps the existing link colour through the DS hover role', () => {
  render(createElement('main', { className: 'flyout' }, createElement(Link, { href: '/catalog', children: 'Catalog', arrow: false })));
  const link = screen.getByRole('link', { name: 'Catalog' });
  expect(link.getAttribute('href')).toBe('/catalog');
  expect(link.classList.contains('text-link-default')).toBe(true);
  expect(link.classList.contains('hover:text-link-hover')).toBe(true);
  expect(paintFor(link)).toEqual([['color', 'var(--color-link-hover)']]);
});

it('preserves the application card, header and preview surfaces', () => {
  for (const selector of ['.app-card.eg-collapsible:has(> .app-row)', '.catalog-card', '.news-dialog', '.preview-row']) {
    const props = propertiesFor(selector);
    expect(props['border-radius'], selector).toBe('var(--radius-xl)');
    expect(props.background, selector).toBe('var(--gradient-sheen), var(--color-surface-1)');
    expect(props['box-shadow'], selector).toBe('var(--shadow-edge), var(--shadow-elev-1)');
  }
  for (const selector of ['.app-card.eg-collapsible:has(> .app-row) > .app-row', '.news-header', '.catalog-card .catalog-art', '.catalog-card:nth-child(even) .catalog-art']) {
    const props = propertiesFor(selector);
    expect(props.background, selector).toBe('var(--gradient-sheen), var(--color-surface-2)');
    expect(props['border-bottom'], selector).toBe('var(--border-width) solid var(--color-border-hairline)');
    expect(props['box-shadow'], selector).toBe('var(--shadow-edge)');
  }
  const previewRules: string[] = [];
  family.walkRules(rule => {
    if (rule.selector === '.settings__preview-panel') rule.walkDecls('background', decl => { previewRules.push(decl.value); });
  });
  expect(previewRules).toEqual([
    'var(--color-surface-0)',
    'color-mix(in srgb, var(--color-surface-0) var(--settings-preview-opacity), transparent)',
    'var(--color-surface-0)',
  ]);
});
