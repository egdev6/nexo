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
afterEach(() => { cleanup(); style.remove(); vi.unstubAllGlobals(); });

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
  expect((within(dialog).getByRole('button', { name: 'Diapositiva anterior' }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(dialog).getByRole('button', { name: 'Diapositiva siguiente' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(indicators[count - 1]);
  expect(groups[count - 1].getAttribute('aria-current')).toBe('true');
  expect(indicators[count - 1].getAttribute('aria-current')).toBe('true');
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

it('localizes indicator names', () => {
  render(<LocaleProvider locale="en"><main><NewsPopup items={items.slice(0, 2)} open dontShow={false} onClose={() => {}} onDontShowChange={() => {}} /></main></LocaleProvider>);
  expect(screen.getByRole('button', { name: 'Go to 1 of 2: Noticia 1' }).getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Go to 2 of 2: Noticia 2' }));
  expect(screen.getByRole('button', { name: 'View in catalog: Noticia 2 · sample' })).toBeTruthy();
});
