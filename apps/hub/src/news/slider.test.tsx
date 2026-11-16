// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  return { dialog: screen.getByRole('dialog', { name: 'Novedades al abrir' }), onShown };
}

function slides(dialog: HTMLElement, count: number) {
  return Array.from({ length: count }, (_, index) => within(dialog).getByRole('group', { name: `${index + 1} de ${count}: Noticia ${index + 1}` }));
}

// JSDOM has no layout: give the real carousel a viewport and model its scrollBy geometry.
function layout(groups: HTMLElement[]) {
  let offset = 0;
  const track = groups[0].parentElement!;
  const rect = (left: number) => ({ x: left, y: 0, left, right: left + 300, top: 0, bottom: 100, width: 300, height: 100, toJSON() {} });
  vi.spyOn(track, 'getBoundingClientRect').mockImplementation(() => rect(0));
  groups.forEach((group, index) => vi.spyOn(group, 'getBoundingClientRect').mockImplementation(() => rect(index * 300 - offset)));
  const scrollBy = vi.fn((options: ScrollToOptions) => { offset += options.left ?? 0; });
  track.scrollBy = scrollBy as typeof track.scrollBy;
  return { track, scrollBy, offset: () => offset };
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
  expect(within(dialog).queryByRole('group', { name: 'Últimas novedades' })).toBeNull();
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
  expect(groups[0].getAttribute('aria-current')).toBe('true');
  const indicators = within(dialog).getAllByRole('button', { name: /^Ir a / });
  expect(indicators).toHaveLength(count);
  expect(indicators[0].getAttribute('aria-current')).toBe('true');
  expect(dialog.textContent).toContain(`01 / 0${count}`);
  expect(Number(within(dialog).getByRole('progressbar', { hidden: true }).getAttribute('aria-valuenow'))).toBeCloseTo(100 / count);
  expect((within(dialog).getByRole('button', { name: 'Diapositiva anterior' }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(indicators[count - 1]);
  expect(groups[count - 1].getAttribute('aria-current')).toBe('true');
  expect(indicators[count - 1].getAttribute('aria-current')).toBe('true');
  expect(dialog.textContent).toContain(`0${count} / 0${count}`);
  expect(within(dialog).getByRole('progressbar', { hidden: true }).getAttribute('aria-valuenow')).toBe('100');
  expect((within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }) as HTMLButtonElement).disabled).toBe(true);
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

it('hides the scrollbar while keeping a horizontal scrollable slide track', () => {
  const { dialog } = open(2);
  const { track } = layout(slides(dialog, 2));
  expect(track.matches('.news-carousel .eg-carousel > .overflow-x-auto')).toBe(true);
  const css = getComputedStyle(track);
  expect(css.display).toBe('flex');
  expect(css.overflowX).toBe('auto');
  expect(css.scrollbarWidth).toBe('none');
  expect(newsCss).toMatch(/\.news-carousel[^{}]*::-webkit-scrollbar\s*\{[^}]*display:\s*none/s);
});

it.each([false, true])('moves the actual track with buttons, arrow keys and indicators (reduced motion: %s)', reduced => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: reduced, addEventListener() {}, removeEventListener() {} }));
  const { dialog, onShown } = open(3);
  const groups = slides(dialog, 3);
  const { scrollBy, offset } = layout(groups);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  expect(groups[1].getAttribute('aria-current')).toBe('true');
  expect(offset()).toBe(300);
  expect(scrollBy).toHaveBeenLastCalledWith({ left: 300, behavior: 'instant' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva anterior' }));
  expect(groups[0].getAttribute('aria-current')).toBe('true');
  expect(offset()).toBe(0);
  groups[0].focus(); fireEvent.keyDown(groups[0], { key: 'ArrowRight' });
  expect(groups[1].getAttribute('aria-current')).toBe('true');
  expect(offset()).toBe(300);
  fireEvent.keyDown(groups[1], { key: 'ArrowLeft' });
  expect(groups[0].getAttribute('aria-current')).toBe('true');
  expect(offset()).toBe(0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ir a 3 de 3: Noticia 3' }));
  expect(groups[2].getAttribute('aria-current')).toBe('true');
  expect(offset()).toBe(600);
  expect(scrollBy).toHaveBeenLastCalledWith({ left: 600, behavior: 'instant' });
  expect(onShown).toHaveBeenLastCalledWith(items[2]);
  expect(within(dialog).getByRole('button', { name: 'Ver en el catálogo: Noticia 3 · muestra' }).getAttribute('data-app-id')).toBe('app-2');
});

it.each(['scrollend', 'resize', 'observer'] as const)('resynchronizes a hidden-layout scroll when visible via %s', resume => {
  const observers: { targets: Set<Element>; notify: () => void }[] = [];
  vi.stubGlobal('ResizeObserver', class {
    private entry: { targets: Set<Element>; notify: () => void };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { targets: new Set(), notify: () => callback([], this as unknown as ResizeObserver) };
      observers.push(this.entry);
    }
    observe(target: Element) { this.entry.targets.add(target); }
    unobserve(target: Element) { this.entry.targets.delete(target); }
    disconnect() { this.entry.targets.clear(); }
  });
  let width = 0, offset = 0, slidesReady = false;
  const padding = 6.4, gap = 22.4, visibleWidth = 539, step = visibleWidth - 2 * padding + gap;
  const originalRect = Element.prototype.getBoundingClientRect;
  const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!.get!;
  const rect = (left: number, size: number) => ({ x: left, y: 0, left, right: left + size, top: 0, bottom: 100, width: size, height: 100, toJSON() {} });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.matches('.news-carousel .eg-carousel > .overflow-x-auto')) return rect(0, width);
    if (this.matches('.news-carousel .eg-carousel > .overflow-x-auto > [role="group"]')) {
      const index = Array.from(this.parentElement!.children).indexOf(this);
      return rect(width ? padding + index * step - offset : -offset, width && slidesReady ? width - 2 * padding : 0);
    }
    return originalRect.call(this);
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.matches('.news-carousel .eg-carousel > .overflow-x-auto') ? width : originalClientWidth.call(this);
  });
  const { dialog, onShown } = open(2);
  const groups = slides(dialog, 2);
  const track = groups[0].parentElement!;
  track.scrollBy = vi.fn((options: ScrollToOptions) => { offset = Math.max(0, Math.min(step, offset + (options.left ?? 0))); }) as typeof track.scrollBy;
  const visible = (index: number) => {
    expect(groups[index].getAttribute('aria-current')).toBe('true');
    expect(within(groups[index]).getByRole('heading', { name: `Noticia ${index + 1}` })).toBeTruthy();
    expect(dialog.textContent).toContain(index ? '02 / 02' : '01 / 02');
  };
  expect(track.clientWidth).toBe(0);
  visible(0);
  fireEvent(window, new Event('resize'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }));
  visible(0);
  expect(onShown.mock.calls.map(([item]) => item.id)).toEqual(['news-0']);
  offset = 2 * padding + gap;
  fireEvent.scroll(track);
  visible(0);
  // Model the browser restoring a last-slide snap as layout returns.
  width = visibleWidth;
  offset = step;
  if (resume === 'observer') {
    act(() => observers.filter(observer => observer.targets.has(track)).forEach(observer => observer.notify()));
    visible(0);
    slidesReady = true;
    act(() => observers.filter(observer => observer.targets.has(groups[0])).forEach(observer => observer.notify()));
  } else {
    slidesReady = true;
    if (resume === 'scrollend') fireEvent(track, new Event('scrollend'));
    else fireEvent(window, new Event('resize'));
  }
  visible(0);
  expect(offset).toBeCloseTo(0);
  expect(onShown.mock.calls.map(([item]) => item.id)).toEqual(['news-0']);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva siguiente' })); visible(1);
  expect(offset).toBeCloseTo(step);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Diapositiva anterior' })); visible(0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ir a 2 de 2: Noticia 2' })); visible(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ir a 1 de 2: Noticia 1' })); visible(0);
  groups[0].focus(); fireEvent.keyDown(groups[0], { key: 'ArrowRight' }); visible(1);
  fireEvent.keyDown(groups[1], { key: 'ArrowLeft' }); visible(0);
  expect(offset).toBeCloseTo(0);
  // Once visible, direct scrolling must still select the slide under the viewport.
  offset = step; fireEvent.scroll(track); fireEvent(track, new Event('scrollend')); visible(1);
  offset = 0; fireEvent.scroll(track); fireEvent(track, new Event('scrollend')); visible(0);
});

it('localizes indicator names', () => {
  render(<LocaleProvider locale="en"><main><NewsPopup items={items.slice(0, 2)} open dontShow={false} onClose={() => {}} onDontShowChange={() => {}} /></main></LocaleProvider>);
  expect(screen.getByRole('button', { name: 'Go to 1 of 2: Noticia 1' }).getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Go to 2 of 2: Noticia 2' }));
  expect(screen.getByRole('button', { name: 'View in catalog: Noticia 2 · sample' })).toBeTruthy();
});
