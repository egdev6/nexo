// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import postcss from 'postcss';
// @ts-ignore Vitest runs in Node; the browser tsconfig excludes Node types.
import { readFileSync } from 'node:fs';
import { FirstRun } from '../first-run';
import { NewsPopup } from '../news';
import { defaultSettings } from '../sample';
import { LocaleProvider } from '../i18n/use-locale';
import { SettingsView } from './index';
import { version as buildVersion } from '../../package.json';

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

beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
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
  render(
    <LocaleProvider locale={locale}>
      <SettingsView settings={{ ...defaultSettings, language: locale }} onChange={vi.fn()} onClose={onClose} />
    </LocaleProvider>,
  );
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
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(labels);
  select(labels[2]);
  expect(await screen.findByText('Editor')).toBeTruthy();
  expect(screen.getByRole('button', { name: add })).toBeTruthy();
  expect(screen.queryByText('Private source')).toBeNull();
  expect(screen.queryByRole('button', { name: /fuente|source/i })).toBeNull();
});

it('exposes each settings region, heading and controls in a banded panel', async () => {
  settings();
  for (const [tab, names] of [
    ['General', ['General']],
    ['Apariencia', ['Apariencia']],
    ['Apps locales', ['Apps locales']],
    ['Acerca de', ['Acerca de', 'Autor']],
  ] as const) {
    select(tab);
    for (const name of names) {
      const region = screen.getByRole('region', { name });
      const heading = within(region).getByRole('heading', { name, level: 2 });
      expect(heading.closest('[data-variant="banded"]')).toBeTruthy();
    }
    if (tab === 'General') {
      const region = screen.getByRole('region', { name: 'General' });
      expect(within(region).getByRole('radio', { name: 'Español' })).toBeTruthy();
      expect(within(region).getByRole('switch', { name: 'Iniciar con Windows' })).toBeTruthy();
      expect(within(region).getByRole('switch', { name: 'Mostrar novedades al abrir' })).toBeTruthy();
    } else if (tab === 'Apariencia') {
      const region = screen.getByRole('region', { name: 'Apariencia' });
      expect(within(region).getByRole('radiogroup', { name: 'Color de acento' })).toBeTruthy();
      expect(within(region).getByRole('slider', { name: 'Opacidad del fondo' })).toBeTruthy();
      expect(within(region).getByRole('slider', { name: 'Desenfoque del fondo' })).toBeTruthy();
      expect(within(region).getByRole('switch', { name: 'Interfaz compacta' })).toBeTruthy();
    } else if (tab === 'Apps locales') {
      const region = screen.getByRole('region', { name: 'Apps locales' });
      expect(await within(region).findByText('Editor')).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'Eliminar Editor' })).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'Añadir app' })).toBeTruthy();
    } else {
      expect(within(screen.getByRole('region', { name: 'Acerca de' })).getByText(`Versión ${buildVersion}`)).toBeTruthy();
      expect(within(screen.getByRole('region', { name: 'Autor' })).getByRole('link', { name: /YouTube/i })).toBeTruthy();
    }
  }
});

it('stacks appearance options in a token-spaced flex wrapper without changing their order', () => {
  settings();
  select('Apariencia');
  const region = screen.getByRole('region', { name: 'Apariencia' });
  const options = within(region).getByRole('radiogroup', { name: 'Color de acento' }).closest('.settings__options');
  expect(options?.tagName).toBe('DIV');
  const controls = [
    within(region).getByRole('radiogroup', { name: 'Color de acento' }),
    within(region).getByRole('group', { name: 'Tonos derivados' }),
    within(region).getByRole('button', { name: 'Restablecer rojo egdev' }),
    within(region).getByRole('slider', { name: 'Opacidad del fondo' }),
    within(region).getByRole('slider', { name: 'Desenfoque del fondo' }),
    within(region).getByRole('img', { name: 'Vista previa de apariencia' }),
    within(region).getByRole('switch', { name: 'Interfaz compacta' }),
  ];
  for (const control of controls) expect(options?.contains(control)).toBe(true);
  controls.slice(1).forEach((control, index) => expect(controls[index].compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
  const css = postcss.parse(readFileSync('src/settings/settings.css', 'utf8') as string);
  const rule = css.nodes.find((node) => node.type === 'rule' && node.selector === '.settings__options');
  const declarations = Object.fromEntries(
    rule?.type === 'rule' ? rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]) : [],
  );
  expect(declarations).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: 'var(--space-2)' });
});

it.each([
  ['es', 'Acerca de', 'Autor'],
  ['en', 'About', 'Author'],
] as const)('opens all author profiles through the native policy (%s)', async (locale, about, author) => {
  settings(locale);
  select(about);
  const card = screen.getByRole('region', { name: author });
  expect(within(card).getByRole('heading', { name: author, level: 2 })).toBeTruthy();
  expect(within(card).getByText('Enrique Gómez Navarro (egdev6)')).toBeTruthy();
  const list = within(card).getByRole('list');
  expect(list.classList.contains('flex-wrap')).toBe(true);
  expect(list.classList.contains('gap-2')).toBe(true);
  expect(list.parentElement?.classList.contains('eg-cluster')).toBe(true);
  for (const [name, url] of profiles) {
    const link = within(card).getByRole('link', { name: new RegExp(name, 'i') });
    expect(link.getAttribute('href')).toBe(url);
    const icon = link.querySelector('svg');
    expect(icon?.getAttribute('color')).toBe('var(--color-fg-brand-default)');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.classList.contains('stroke-current')).toBe(true);
    expect(fireEvent.click(link)).toBe(false);
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('open_external', { url }));
  }
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'open_external')).toHaveLength(6);
});

it('reports a failed author link without navigating', async () => {
  bridge.invoke.mockRejectedValue('nexo.external.refused');
  settings();
  select('Acerca de');
  const link = within(screen.getByRole('region', { name: 'Autor' })).getByRole('link', { name: /Twitch/i });
  expect(fireEvent.click(link)).toBe(false);
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe('No se pudo abrir el enlace.');
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(alert.dataset.size).toBe('sm');
});

it('renders both first-run lines inline with hidden separators and language tags', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync('src/first-run/first-run.css', 'utf8');
  document.head.append(style);
  try {
    const { container } = render(<FirstRun onChoose={vi.fn()} />);
    for (const [selector, expected] of [
      ['h1', 'Elige tu idioma - Choose your language'],
      ['header > p:last-child', 'Puedes cambiarlo después en Ajustes. - You can change it later in Settings.'],
    ]) {
      const line = container.querySelector(selector)!;
      expect(line.textContent).toBe(expected);
      expect(line.querySelector('br')).toBeNull();
      expect(Array.from(line.querySelectorAll('span[lang]')).map((span) => span.getAttribute('lang'))).toEqual(['es', 'en']);
      expect(line.querySelector('[aria-hidden="true"]')?.textContent).toBe('-');
      expect(getComputedStyle(line.querySelector('[lang="es"]')!).display).not.toBe('block');
    }
  } finally {
    style.remove();
  }
});

it('centers the scrollable DS news dialog in the flyout', () => {
  render(
    <main>
      <NewsPopup items={[]} open dontShow={false} onClose={vi.fn()} onDontShowChange={vi.fn()} />
    </main>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Novedades' });
  const overlay = dialog.closest('.eg-dialog-backdrop');
  expect(overlay?.parentElement?.tagName).toBe('MAIN');
  for (const name of ['absolute', 'inset-0', 'grid', 'place-items-center']) expect(overlay?.classList.contains(name)).toBe(true);
  expect(dialog.querySelector('.eg-dialog__body')?.classList.contains('overflow-y-auto')).toBe(true);
});
