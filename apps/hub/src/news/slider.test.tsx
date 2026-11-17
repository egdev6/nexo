// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import postcss from 'postcss';
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
const appCss = readFileSync(`${cwd()}/src/style.css`, 'utf8') as string;
// jsdom cannot parse the complete layered DS stylesheet; retain its actual layout utilities.
const dsCss = readFileSync(`${cwd()}/node_modules/@egdev/ui/dist/styles.css`, 'utf8') as string;
const layoutUtilities = new Set(['.flex', '.overflow-x-auto', '.basis-full', '.shrink-0']);
const dsLayoutRules: string[] = [];
postcss.parse(dsCss).walkRules(rule => { if (layoutUtilities.has(rule.selector)) dsLayoutRules.push(rule.toString()); });

const items: NewsItem[] = Array.from({ length: 6 }, (_, index) => ({
  id: `news-${index}`, appId: `app-${index}`, badge: 'Nuevo', title: `Noticia ${index + 1}`,
  text: `Contenido ${index + 1}`, cta: 'Ver en el catálogo',
}));
let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement('style');
  style.textContent = `${dsLayoutRules.join('\n')}\n${newsCss}\n${appCss}`;
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
  const groups = within(region).getAllByRole('group', { hidden: true });
  return Array.from({ length: count }, (_, index) => {
    const group = groups.find(candidate => candidate.getAttribute('aria-label') === `${index + 1} de ${count}: Noticia ${index + 1}`);
    expect(group).toBeTruthy();
    return group!;
  });
}

// JSDOM has no layout: model the viewport and slide positions while exercising real navigation.
function layout(groups: HTMLElement[]) {
  let offset = 0;
  const track = groups[0].parentElement!;
  const rect = (left: number) => ({ x: left, y: 0, left, right: left + 300, top: 0, bottom: 100, width: 300, height: 100, toJSON() {} });
  vi.spyOn(track, 'getBoundingClientRect').mockImplementation(() => rect(0));
  groups.forEach((group, index) => vi.spyOn(group, 'getBoundingClientRect').mockImplementation(() => rect(index * 300 - offset)));
  track.scrollBy = vi.fn((options: ScrollToOptions) => { offset += options.left ?? 0; }) as typeof track.scrollBy;
  // The DS Carousel aligns with absolute scrollTo (egdev-design-system#407); model the scroller like a browser.
  Object.defineProperty(track, 'scrollLeft', { configurable: true, get: () => offset, set: (value: number) => { offset = value; } });
  track.scrollTo = vi.fn((options: ScrollToOptions) => { offset = options.left ?? offset; }) as typeof track.scrollTo;
  return { track, offset: () => offset, moveTo: (position: number) => { offset = position; } };
}

function expectPosition(dialog: HTMLElement, groups: HTMLElement[], index: number) {
  const count = groups.length;
  expect(dialog.textContent).toContain(`${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}`);
  groups.forEach((group, position) => {
    expect(group.getAttribute('aria-current')).toBe(position === index ? 'true' : null);
    const article = group.querySelector('article')!;
    expect(!!article.closest('[aria-hidden="true"]')).toBe(position !== index);
    expect(!!article.closest('[inert]')).toBe(position !== index);
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

it.each([2, 3, 4])('reaches all %i items with arrows and progress but no navigation dots', count => {
  const { dialog } = open(count);
  const groups = slides(dialog, count);
  expect(groups).toHaveLength(count);
  expectPosition(dialog, groups, 0);
  expect(within(dialog).queryByRole('group', { name: 'Seleccionar diapositiva' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: /^Ir a / })).toBeNull();
  expect(Number(within(dialog).getByRole('progressbar', { hidden: true }).getAttribute('aria-valuenow'))).toBeCloseTo(100 / count);
  for (let index = 1; index < count; index++) {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
    expectPosition(dialog, groups, index);
  }
  expect(within(dialog).getByRole('progressbar', { hidden: true }).getAttribute('aria-valuenow')).toBe('100');
  expect(within(dialog).getByRole('button', { name: `Ver en el catálogo: Noticia ${count} · muestra` })).toBeTruthy();
});

it('caps the supplied newest-first items at four without presenting or marking the overflow', () => {
  const { dialog, onShown } = open(6);
  const groups = slides(dialog, 4);
  expect(groups).toHaveLength(4);
  expect(within(dialog).queryByText('Noticia 5')).toBeNull();
  expect(within(dialog).queryByText('Noticia 6')).toBeNull();
  fireEvent.keyDown(within(dialog).getByRole('region', { name: 'Últimas novedades' }), { key: 'End' });
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
  expect(newsCss).toMatch(/\.news-hero\s*>\s*img\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover/s);
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
  expect(hero.querySelector('.eg-app-icon')?.textContent).toBe('Ó');
  expect(hero.querySelector('.eg-app-icon')?.getAttribute('aria-hidden')).toBe('true');
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
  expect(hero.querySelector('.eg-app-icon')?.getAttribute('aria-hidden')).toBe('true');
});

it('uses the full-width scroll and snap layout for every news slide', () => {
  const { dialog } = open(3);
  const groups = slides(dialog, 3);
  const track = groups[0].parentElement!;
  for (const name of ['gap-0', 'p-0', 'overflow-x-auto', 'snap-x', 'snap-mandatory', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden']) {
    expect(track.classList.contains(name), name).toBe(true);
  }
  for (const group of groups) {
    for (const name of ['basis-full', 'shrink-0', 'snap-center', 'focus-visible:-outline-offset-(--focus-width)']) {
      expect(group.classList.contains(name), name).toBe(true);
    }
  }
  expectPosition(dialog, groups, 0);
});

it('moves every item with arrows and keys and stays aligned after scroll feedback', () => {
  const { dialog, onShown } = open(3);
  const groups = slides(dialog, 3);
  const region = within(dialog).getByRole('region', { name: 'Últimas novedades' });
  const { track, offset } = layout(groups);
  expect(getComputedStyle(track).display).toBe('flex');
  expect(getComputedStyle(track).overflowX).toBe('auto');
  expect(getComputedStyle(groups[0]).flexBasis).toBe('100%');
  expect(getComputedStyle(groups[0]).flexShrink).toBe('0');
  expectPosition(dialog, groups, 0);
  for (let index = 1; index < groups.length; index++) {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
    expectPosition(dialog, groups, index);
    expect(offset()).toBe(index * 300);
    fireEvent.scroll(track); fireEvent(track, new Event('scrollend')); fireEvent(window, new Event('resize'));
    expectPosition(dialog, groups, index);
    expect(offset()).toBe(index * 300);
  }
  for (let index = groups.length - 2; index >= 0; index--) {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva anterior' }));
    expectPosition(dialog, groups, index);
    expect(offset()).toBe(index * 300);
  }
  region.focus();
  fireEvent.keyDown(region, { key: 'End' });
  expectPosition(dialog, groups, groups.length - 1);
  expect(offset()).toBe((groups.length - 1) * 300);
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
  expect(onShown).toHaveBeenLastCalledWith(items[2]);
  expect(within(dialog).getByRole('button', { name: 'Ver en el catálogo: Noticia 3 · muestra' }).getAttribute('data-app-id')).toBe('app-2');
});

it('does not snap back when programmatic scrolling emits synchronous feedback', () => {
  const { dialog } = open(3);
  const groups = slides(dialog, 3);
  const { track, offset } = layout(groups);
  fireEvent.keyDown(within(dialog).getByRole('region', { name: 'Últimas novedades' }), { key: 'End' });
  expect(offset()).toBe(600);
  const scrollTo = vi.mocked(track.scrollTo as (options: ScrollToOptions) => void);
  const move = scrollTo.getMockImplementation()!;
  let dispatching = false;
  scrollTo.mockClear();
  scrollTo.mockImplementation(options => {
    move(options);
    if (dispatching) return;
    dispatching = true;
    fireEvent.scroll(track);
    fireEvent(track, new Event('scrollend'));
    dispatching = false;
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva anterior' }));
  expectPosition(dialog, groups, 1);
  expect(offset()).toBe(300);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 300, behavior: 'instant' });
});

it('selects the slide reached by direct horizontal scrolling and returns to the first', () => {
  const { dialog, onShown } = open(2);
  const groups = slides(dialog, 2);
  const { track, offset, moveTo } = layout(groups);
  moveTo(300); fireEvent.scroll(track); fireEvent(track, new Event('scrollend'));
  expectPosition(dialog, groups, 1);
  expect(offset()).toBe(300);
  expect(onShown).toHaveBeenLastCalledWith(items[1]);
  moveTo(0); fireEvent.scroll(track); fireEvent(track, new Event('scrollend'));
  expectPosition(dialog, groups, 0);
  expect(offset()).toBe(0);
  expect(onShown).toHaveBeenLastCalledWith(items[0]);
});

it('disables scrolling animations for reduced motion', () => {
  const { dialog } = open(2);
  const track = slides(dialog, 2)[0].parentElement!;
  // jsdom cannot evaluate media queries; inspect the matching reduced-motion rule.
  const rules = Array.from(style.sheet!.cssRules);
  const motion = rules.find(rule => rule instanceof CSSMediaRule && rule.media.mediaText === '(prefers-reduced-motion: reduce)') as CSSMediaRule;
  expect(motion).toBeTruthy();
  const matching = Array.from(motion.cssRules).filter((rule): rule is CSSStyleRule => 'selectorText' in rule && track.matches((rule as CSSStyleRule).selectorText));
  expect(matching.some(rule => rule.style.getPropertyValue('scroll-behavior') === 'auto' && rule.style.getPropertyPriority('scroll-behavior') === 'important')).toBe(true);
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

it('localizes carousel arrows without navigation dots', () => {
  render(<LocaleProvider locale="en"><main><NewsPopup items={items.slice(0, 2)} open dontShow={false} onClose={() => {}} onDontShowChange={() => {}} /></main></LocaleProvider>);
  expect(screen.queryByRole('group', { name: 'Select slide' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Go to / })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
  expect(screen.getByRole('button', { name: 'View in catalog: Noticia 2 · sample' })).toBeTruthy();
});
