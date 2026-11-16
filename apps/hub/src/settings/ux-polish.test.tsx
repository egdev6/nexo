// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
// @ts-ignore Vitest runs in Node; the browser tsconfig excludes Node types.
import { readFileSync } from 'node:fs';
import { FirstRun } from '../first-run';
import { NewsPopup } from '../news';
import { defaultSettings } from '../sample';
import { LocaleProvider } from '../i18n/use-locale';
import { SettingsView } from './index';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));

const profiles = [
  ['YouTube', 'https://www.youtube.com/@egdev6'],
  ['Twitch', 'https://twitch.tv/egdev6'],
  ['X', 'https://x.com/egdev66'],
  ['LinkedIn', 'https://www.linkedin.com/in/egdev6/'],
  ['Instagram', 'https://www.instagram.com/egdev6/'],
  ['GitHub', 'https://github.com/egdev6'],
] as const;

beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
beforeEach(() => {
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_settings') return { settings: { sources: [{ id: 'local', kind: 'local', label: 'Private source' }] } };
    if (command === 'local_apps_list') return [{ id: 'manual:1', name: 'Editor', state: 'ready', origin: { kind: 'manual', id: '1' } }];
    return undefined;
  });
});
afterEach(cleanup);

function settings(locale: 'es' | 'en' = 'es') {
  const onClose = vi.fn();
  render(<LocaleProvider locale={locale}><SettingsView settings={{ ...defaultSettings, language: locale }} onChange={vi.fn()} onClose={onClose} /></LocaleProvider>);
  return onClose;
}
function select(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

it('uses only the back arrow to close settings', () => {
  const onClose = settings();
  expect(screen.queryByRole('button', { name: 'Cerrar ajustes' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it.each([
  ['es', ['General', 'Apariencia', 'Apps locales', 'Acerca de'], 'Añadir app'],
  ['en', ['General', 'Appearance', 'Local apps', 'About'], 'Add app'],
] as const)('shows only local app management in the %s local apps tab', async (locale, labels, add) => {
  settings(locale);
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(labels);
  select(labels[2]);
  expect(await screen.findByText('Editor')).toBeTruthy();
  expect(screen.getByRole('button', { name: add })).toBeTruthy();
  expect(screen.queryByText('Private source')).toBeNull();
  expect(screen.queryByRole('button', { name: /fuente|source/i })).toBeNull();
});

it('keeps the themed card and header band in every settings section', () => {
  const theme = readFileSync('src/theme/family.css', 'utf8') as string;
  expect(theme).toMatch(/\.settings__group,[^{]*\{[^}]*background:/s);
  expect(theme).toMatch(/\.settings__group > h2\s*\{[^}]*background:[^;]*var\(--color-surface-2\)/s);
  settings();
  for (const [tab, names] of [
    ['General', ['General']],
    ['Apariencia', ['Apariencia']],
    ['Apps locales', ['Apps locales']],
    ['Acerca de', ['Acerca de', 'Autor']],
  ] as const) {
    select(tab);
    for (const name of names) {
      const card = screen.getByRole('region', { name });
      expect(card.classList.contains('settings__group')).toBe(true);
      expect(card.querySelector(':scope > h2')?.textContent).toBe(name);
    }
  }
});

it.each([['es', 'Acerca de', 'Autor'], ['en', 'About', 'Author']] as const)('opens all author profiles through the native policy (%s)', async (locale, about, author) => {
  settings(locale); select(about);
  const card = screen.getByRole('region', { name: author });
  expect(card.classList.contains('settings__group')).toBe(true);
  expect(within(card).getByText('Enrique Gómez Navarro (egdev6)')).toBeTruthy();
  for (const [name, url] of profiles) {
    const link = within(card).getByRole('link', { name: new RegExp(name, 'i') });
    expect(link.getAttribute('href')).toBe(url);
    expect(fireEvent.click(link)).toBe(false);
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('open_external', { url }));
  }
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'open_external')).toHaveLength(6);
});

it('reports a failed author link without navigating', async () => {
  bridge.invoke.mockRejectedValue('nexo.external.refused');
  settings(); select('Acerca de');
  const link = within(screen.getByRole('region', { name: 'Autor' })).getByRole('link', { name: /Twitch/i });
  expect(fireEvent.click(link)).toBe(false);
  expect((await screen.findByRole('alert')).textContent).toBe('No se pudo abrir el enlace.');
});

it('renders both first-run lines inline with hidden separators and language tags', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync('src/first-run/first-run.css', 'utf8');
  document.head.append(style);
  try {
    const { container } = render(<FirstRun onChoose={vi.fn()} />);
    for (const [selector, expected] of [
      ['h1', 'Elige tu idioma - Choose your language'],
      ['.first-run__description', 'Puedes cambiarlo después en Ajustes. - You can change it later in Settings.'],
    ]) {
      const line = container.querySelector(selector)!;
      expect(line.textContent).toBe(expected);
      expect(line.querySelector('br')).toBeNull();
      expect(Array.from(line.querySelectorAll('span')).map(span => span.getAttribute('lang'))).toEqual(['es', null, 'en']);
      expect(line.querySelector('[aria-hidden="true"]')?.textContent).toBe('-');
      expect(getComputedStyle(line.querySelector('[lang="es"]')!).display).not.toBe('block');
    }
  } finally { style.remove(); }
});

it('centers the scrollable news dialog in the flyout', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync('src/news/news.css', 'utf8');
  document.head.append(style);
  try {
    render(<main><NewsPopup items={[]} open dontShow={false} onClose={vi.fn()} onDontShowChange={vi.fn()} /></main>);
    const dialog = screen.getByRole('dialog', { name: 'Novedades' });
    const css = getComputedStyle(dialog);
    expect(css.top).toBe('50%');
    expect(css.transform).toBe('translateY(-50%)');
    expect(css.overflow).toBe('auto');
  } finally { style.remove(); }
});
