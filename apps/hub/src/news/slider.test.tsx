// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NewsItem } from '../model';
import { LocaleProvider } from '../i18n/use-locale';
import { NewsPopup } from './index';
// @ts-ignore The browser tsconfig intentionally excludes Node types, but Vitest runs in Node.
import { readFileSync } from 'node:fs';
// @ts-ignore Same as above.
import { cwd } from 'node:process';

// Vitest mocks CSS imports (including ?raw), so load the actual stylesheet for computed-style checks.
// Under jsdom import.meta.url is not a file URL; Vitest's root (cwd) is apps/hub.
const newsCss = readFileSync(`${cwd()}/src/news/news.css`, 'utf8') as string;

const items: NewsItem[] = Array.from({ length: 6 }, (_, index) => ({
  id: `news-${index}`, appId: `app-${index}`, badge: 'Nuevo', title: `Noticia ${index + 1}`,
  text: `Contenido ${index + 1}`, cta: 'Ver en el catálogo',
}));
let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement('style');
  style.textContent = newsCss;
  document.head.append(style);
});
afterEach(() => { cleanup(); style.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function open(count: number, onShown = vi.fn()) {
  render(<main><NewsPopup items={items.slice(0, count)} open dontShow={false} onClose={() => {}} onDontShowChange={() => {}} onShown={onShown} /></main>);
  return { dialog: screen.getByRole('dialog', { name: 'Novedades' }), onShown };
}

function slides(dialog: HTMLElement, count: number) {
  const region = within(dialog).getByRole('region', { name: 'Últimas novedades' });
  expect(region.getAttribute('aria-roledescription')).toBe('carousel');
  const groups = within(region).getAllByRole('group', { hidden: true })
    .filter(group => group.getAttribute('aria-roledescription') === 'slide');
  expect(groups).toHaveLength(count);
  groups.forEach((group, index) => expect(group.getAttribute('aria-label')).toBe(`${index + 1} de ${count}: Noticia ${index + 1}`));
  return groups;
}

function expectPosition(dialog: HTMLElement, groups: HTMLElement[], index: number) {
  const count = groups.length;
  expect(dialog.textContent).toContain(`${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`);
  expect(groups[0].parentElement!.style.transform).toBe(`translateX(${index === 0 ? 0 : -index * 100}%)`);
  groups.forEach((group, position) => {
    expect(group.getAttribute('aria-current')).toBe(position === index ? 'true' : null);
    expect(group.getAttribute('aria-hidden')).toBe(position === index ? null : 'true');
    expect(group.hasAttribute('inert')).toBe(position !== index);
  });
  const visible = within(dialog).getByRole('group', { name: `${index + 1} de ${count}: Noticia ${index + 1}` });
  expect(visible).toBe(groups[index]);
  expect(within(visible).getByRole('heading', { name: `Noticia ${index + 1}` })).toBeTruthy();
  expect((within(dialog).getByRole('button', { name: 'Diapositiva anterior' }) as HTMLButtonElement).disabled).toBe(index === 0);
  expect((within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }) as HTMLButtonElement).disabled).toBe(index === count - 1);
}

it('keeps the empty state without a current action or indicators', () => {
  const { dialog, onShown } = open(0);
  expect(within(dialog).getByText('No hay novedades.')).toBeTruthy();
  expect(within(dialog).queryByRole('button', { name: /^Ir a / })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: /catálogo:/ })).toBeNull();
  expect(onShown).not.toHaveBeenCalled();
});

it('shows one item as static content with no carousel, navigation, indicators or scrolling', () => {
  const { dialog, onShown } = open(1);
  expect(within(dialog).getByRole('heading', { name: 'Noticia 1' })).toBeTruthy();
  expect(within(dialog).queryByRole('region', { name: 'Últimas novedades' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: /Diapositiva (anterior|siguiente)|^Ir a / })).toBeNull();
  expect(within(dialog).queryByRole('progressbar', { hidden: true })).toBeNull();
  expect(dialog.textContent).not.toMatch(/\d{2} \/ \d{2}/);
  const article = within(dialog).getByRole('article');
  expect(['auto', 'scroll']).not.toContain(getComputedStyle(article.parentElement!).overflowX);
  expect(onShown).toHaveBeenCalledExactlyOnceWith(items[0]);
  expect(within(dialog).getByRole('button', { name: 'Ver en el catálogo: Noticia 1 · muestra' }).getAttribute('data-app-id')).toBe('app-0');
});

it.each([2, 3, 4])('adapts the carousel, controls and indicators to %i items', count => {
  const { dialog } = open(count);
  const groups = slides(dialog, count);
  expect(groups).toHaveLength(count);
  expectPosition(dialog, groups, 0);
  const indicators = within(dialog).getAllByRole('button', { name: /^Ir a / });
  expect(indicators).toHaveLength(count);
  expect(indicators[0].getAttribute('aria-current')).toBe('true');
  expect(Number(within(dialog).getByRole('progressbar', { hidden: true }).getAttribute('aria-valuenow'))).toBeCloseTo(100 / count);
  fireEvent.click(indicators[count - 1]);
  expectPosition(dialog, groups, count - 1);
  expect(indicators[count - 1].getAttribute('aria-current')).toBe('true');
  expect(within(dialog).getByRole('progressbar', { hidden: true }).getAttribute('aria-valuenow')).toBe('100');
  expect(within(dialog).getByRole('button', { name: `Ver en el catálogo: Noticia ${count} · muestra` })).toBeTruthy();
});

it('caps the supplied newest-first items at four without presenting or marking the overflow', () => {
  const { dialog, onShown } = open(6);
  const groups = slides(dialog, 4);
  expect(groups).toHaveLength(4);
  expect(within(dialog).queryByText('Noticia 5')).toBeNull();
  expect(within(dialog).queryByText('Noticia 6')).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ir a 4 de 4: Noticia 4' }));
  expect(onShown.mock.calls.map(([item]) => item.id)).toEqual(['news-0', 'news-3']);
});

it('uses the catalog banner in a fixed cover area for each news item', () => {
  const { dialog } = open(2);
  const heroes = Array.from(dialog.querySelectorAll<HTMLElement>('.news-hero'));
  expect(heroes).toHaveLength(2);
  heroes.forEach((hero, index) => {
    const image = hero.querySelector('img');
    expect(hero.getAttribute('aria-hidden')).toBe('true');
    expect(image?.getAttribute('src')).toBe(`https://egdev6.github.io/nexo-catalog/banners/app-${index}.webp`);
    expect(image?.getAttribute('alt')).toBe('');
    expect(getComputedStyle(image!).objectFit).toBe('cover');
  });
  expect(newsCss).toMatch(/\.news-hero\s*\{[^}]*height:\s*calc\(/s);
  expect(newsCss).toMatch(/\.news-hero img\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover/s);
});

it('replaces a failed banner with the catalog app initial and retries for a changed app', () => {
  const item = { ...items[0], appId: 'orbit', appName: ' Órbita', title: 'Cambios de versión' };
  const view = render(<main><NewsPopup items={[item]} open dontShow={false} onClose={() => {}} onDontShowChange={() => {}} /></main>);
  const hero = screen.getByRole('article').querySelector('.news-hero')!;
  const image = hero.querySelector('img');
  expect(image?.getAttribute('src')).toBe('https://egdev6.github.io/nexo-catalog/banners/orbit.webp');
  fireEvent.error(image!);
  expect(hero.querySelector('img')).toBeNull();
  expect(hero.textContent).toBe('Ó');
  expect(hero.querySelector('.catalog-initial')?.textContent).toBe('Ó');
  const betaItem = { ...item, appId: 'beta', appName: 'Beta' };
  view.rerender(<main><NewsPopup items={[betaItem]} open dontShow={false} onClose={() => {}} onDontShowChange={() => {}} /></main>);
  expect(screen.getByRole('article').querySelector('.news-hero img')?.getAttribute('src')).toBe('https://egdev6.github.io/nexo-catalog/banners/beta.webp');
});

it('uses the catalog initial without requesting a banner for an invalid app id', () => {
  const item = { ...items[0], appId: '../escape', appName: ' Pizarra', title: 'Una noticia' };
  render(<main><NewsPopup items={[item]} open dontShow={false} onClose={() => {}} onDontShowChange={() => {}} /></main>);
  const hero = screen.getByRole('article').querySelector('.news-hero')!;
  expect(hero.querySelector('img')).toBeNull();
  expect(hero.textContent).toBe('P');
});

it('moves between every item with arrows, dots and keys without scroll feedback', () => {
  const { dialog, onShown } = open(3);
  const groups = slides(dialog, 3);
  const region = within(dialog).getByRole('region', { name: 'Últimas novedades' });
  const track = groups[0].parentElement!;
  const scrollBy = vi.fn();
  track.scrollBy = scrollBy;
  expect(getComputedStyle(track).display).toBe('flex');
  expect(getComputedStyle(track.parentElement!).overflow).toBe('clip');
  expect(getComputedStyle(groups[0]).flex).toBe('0 0 100%');
  expectPosition(dialog, groups, 0);
  for (let index = 1; index < groups.length; index++) {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
    expectPosition(dialog, groups, index);
    fireEvent.scroll(track); fireEvent(track, new Event('scrollend')); fireEvent(window, new Event('resize'));
    expectPosition(dialog, groups, index);
  }
  for (let index = groups.length - 2; index >= 0; index--) {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva anterior' }));
    expectPosition(dialog, groups, index);
  }
  for (let index = 0; index < groups.length; index++) {
    fireEvent.click(within(dialog).getByRole('button', { name: `Ir a ${index + 1} de 3: Noticia ${index + 1}` }));
    expectPosition(dialog, groups, index);
  }
  region.focus();
  for (let index = groups.length - 2; index >= 0; index--) {
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expectPosition(dialog, groups, index);
  }
  for (let index = 1; index < groups.length; index++) {
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expectPosition(dialog, groups, index);
  }
  fireEvent.keyDown(region, { key: 'ArrowRight' }); expectPosition(dialog, groups, 2);
  fireEvent.keyDown(region, { key: 'Home' }); expectPosition(dialog, groups, 0);
  fireEvent.keyDown(region, { key: 'ArrowLeft' }); expectPosition(dialog, groups, 0);
  fireEvent.keyDown(region, { key: 'End' }); expectPosition(dialog, groups, 2);
  groups[2].focus();
  fireEvent.keyDown(groups[2], { key: 'ArrowLeft' }); expectPosition(dialog, groups, 1);
  expect(document.activeElement).toBe(groups[1]);
  fireEvent.keyDown(groups[1], { key: 'ArrowRight' }); expectPosition(dialog, groups, 2);
  expect(document.activeElement).toBe(groups[2]);
  expect(scrollBy).not.toHaveBeenCalled();
  expect(onShown).toHaveBeenLastCalledWith(items[2]);
  expect(within(dialog).getByRole('button', { name: 'Ver en el catálogo: Noticia 3 · muestra' }).getAttribute('data-app-id')).toBe('app-2');
});

it('transitions the track normally and disables its transition for reduced motion', () => {
  const { dialog } = open(2);
  const track = slides(dialog, 2)[0].parentElement!;
  // jsdom cannot resolve custom properties in transition shorthands or evaluate media queries.
  const rules = Array.from(style.sheet!.cssRules);
  const normal = rules.find((rule): rule is CSSStyleRule => 'selectorText' in rule && (rule as CSSStyleRule).selectorText === '.news-track')!;
  expect(normal.style.getPropertyValue('transition')).toMatch(/transform/);
  const motion = rules.find(rule => rule instanceof CSSMediaRule && rule.media.mediaText === '(prefers-reduced-motion: reduce)') as CSSMediaRule;
  expect(motion).toBeTruthy();
  const matching = Array.from(motion.cssRules).filter((rule): rule is CSSStyleRule => 'selectorText' in rule && track.matches((rule as CSSStyleRule).selectorText));
  expect(matching.some(rule => rule.style.getPropertyValue('transition') === 'none' && rule.style.getPropertyPriority('transition') === 'important')).toBe(true);
});

it('resets to the newest item when displayed ids change and on reopening', () => {
  const onShown = vi.fn();
  const props = { dontShow: false, onClose: () => {}, onDontShowChange: () => {}, onShown };
  const view = render(<main><NewsPopup {...props} items={items.slice(0, 2)} open /></main>);
  let dialog = screen.getByRole('dialog');
  expectPosition(dialog, slides(dialog, 2), 0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  expectPosition(dialog, slides(dialog, 2), 1);
  // The previously selected id is still second; it must not survive a snapshot change.
  const replacement = [items[2], items[1]];
  view.rerender(<main><NewsPopup {...props} items={replacement} open /></main>);
  dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('01 / 02');
  expect(within(dialog).getByRole('group', { name: '1 de 2: Noticia 3' }).getAttribute('aria-hidden')).toBeNull();
  expect(onShown.mock.calls.map(([item]) => item.id)).toEqual(['news-0', 'news-1', 'news-2']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  view.rerender(<main><NewsPopup {...props} items={replacement} open={false} /></main>);
  view.rerender(<main><NewsPopup {...props} items={[items[3], items[1]]} open /></main>);
  dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('01 / 02');
  expect(within(dialog).getByRole('group', { name: '1 de 2: Noticia 4' }).getAttribute('aria-hidden')).toBeNull();
});

it('localizes indicator names', () => {
  render(<LocaleProvider locale="en"><main><NewsPopup items={items.slice(0, 2)} open dontShow={false} onClose={() => {}} onDontShowChange={() => {}} /></main></LocaleProvider>);
  expect(screen.getByRole('button', { name: 'Go to 1 of 2: Noticia 1' }).getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Go to 2 of 2: Noticia 2' }));
  expect(screen.getByRole('button', { name: 'View in catalog: Noticia 2 · sample' })).toBeTruthy();
});
