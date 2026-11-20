// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import postcss from 'postcss';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { HubSettings, Language } from '../model';
import { SettingsView } from './index';
import { LocaleProvider } from '../i18n/use-locale';
import { version as buildVersion } from '../../package.json';
// @ts-ignore Vitest runs in Node; the browser tsconfig excludes Node types.
import { readFileSync } from 'node:fs';
const settingsCss = readFileSync('src/settings/settings.css', 'utf8') as string;

configure({ getElementError: message => new Error(message?.split('\n')[0] ?? 'Element not found') });
// Radix measures slider thumbs; jsdom does not implement ResizeObserver.
beforeAll(() => vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

const initial: HubSettings = {
  language: 'es', startWithWindows: false, showNewsOnOpen: true, hideLocalApps: false,
  accent: '#ff0036', compact: false, opacity: 85, blur: 24,
};

function setup(locale: Language = 'es') {
  const onChange = vi.fn();
  const onClose = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(initial);
    return <SettingsView settings={settings} onClose={onClose} onChange={next => { onChange(next); setSettings(next); }} />;
  }
  render(<LocaleProvider locale={locale}><Harness /></LocaleProvider>);
  return { onChange, onClose };
}

function tab(name: string) {
  const element = screen.getByRole('tab', { name });
  fireEvent.mouseDown(element, { button: 0 });
  fireEvent.click(element);
  return element;
}

it.each([
  ['es', 'Apariencia', 'Apps locales', 'Acerca de', 'Autor'],
  ['en', 'Appearance', 'Local apps', 'About', 'Author'],
] as const)('uses compact panel headings for all settings sections in %s', (locale, appearance, localApps, about, author) => {
  setup(locale);
  function checkHeading(name: string) {
    const section = screen.getByRole('region', { name });
    const heading = within(section).getByRole('heading', { level: 2, name });
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.parentElement?.classList.contains('eg-panel__header')).toBe(true);
    for (const className of ['eg-heading', 'text-heading-small', 'text-fg-default', 'uppercase']) {
      expect(heading.classList.contains(className)).toBe(true);
    }
  }
  checkHeading('General');
  tab(appearance); checkHeading(appearance);
  tab(localApps); checkHeading(localApps);
  tab(about); checkHeading(about); checkHeading(author);
  const links = within(screen.getByRole('region', { name: author })).getAllByRole('link');
  expect(links.length).toBeGreaterThan(0);
  // Author social links use the DS outline IconButton look.
  for (const link of links) expect(link.classList.contains('border-border-hairline-strong')).toBe(true);
});

it('switches the four settings sections with the keyboard and shows their content', async () => {
  setup();
  const general = screen.getByRole('tab', { name: 'General' });
  expect(general.getAttribute('aria-selected')).toBe('true');
  general.focus();
  fireEvent.keyDown(general, { key: 'ArrowRight' });
  const appearance = screen.getByRole('tab', { name: 'Apariencia' });
  await waitFor(() => expect(document.activeElement).toBe(appearance));
  expect(appearance.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Color de acento')).toBeTruthy();
  fireEvent.keyDown(appearance, { key: 'ArrowRight' });
  const localApps = screen.getByRole('tab', { name: 'Apps locales' });
  await waitFor(() => expect(document.activeElement).toBe(localApps));
  expect(screen.getByText('No hay apps locales.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Añadir app' }).hasAttribute('disabled')).toBe(true);
  fireEvent.keyDown(localApps, { key: 'ArrowRight' });
  const about = screen.getByRole('tab', { name: 'Acerca de' });
  await waitFor(() => expect(document.activeElement).toBe(about));
  expect(screen.getByText(`Versión ${buildVersion}`)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Buscar actualizaciones/ }).hasAttribute('disabled')).toBe(true);
});

it.each([
  ['es', 'Secciones de ajustes', 'General', 'Acerca de'],
  ['en', 'Settings sections', 'General', 'About'],
] as const)('centers full-width settings labels on one line and reveals the focused tab in %s', async (locale, label, first, last) => {
  setup(locale);
  const list = screen.getByRole('tablist', { name: label });
  const start = screen.getByRole('tab', { name: first });
  const end = screen.getByRole('tab', { name: last });
  Object.defineProperties(list, { clientWidth: { configurable: true, value: 120 }, scrollWidth: { configurable: true, value: 360 } });
  const reveal = vi.fn();
  Object.defineProperty(end, 'scrollIntoView', { configurable: true, value: reveal });
  start.focus();
  fireEvent.keyDown(start, { key: 'End' });
  await waitFor(() => expect(document.activeElement).toBe(end));
  expect(end.getAttribute('aria-selected')).toBe('true');
  expect(reveal).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  for (const name of ['grid', 'grid-flow-col', 'auto-cols-[1fr]', 'w-full']) expect(list.classList.contains(name)).toBe(true);
  for (const item of within(list).getAllByRole('tab')) {
    for (const name of ['whitespace-nowrap', 'justify-center']) expect(item.classList.contains(name)).toBe(true);
  }
});

it('keeps the settings tab row and content within responsive host gutters', () => {
  setup();
  const list = screen.getByRole('tablist', { name: 'Secciones de ajustes' });
  expect(list.closest('.settings__tabs')).toBeTruthy();
  const sheet = postcss.parse(settingsCss);
  const root = sheet.nodes.find(node => node.type === 'rule' && node.selector === '.settings__tabs');
  const properties = root?.type === 'rule' ? Object.fromEntries(root.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])) : {};
  expect(properties.padding).toBe('var(--space-4) var(--space-6) var(--space-5)');
  const media = sheet.nodes.find(node => node.type === 'atrule' && node.name === 'media' && node.params === '(max-width: 400px)');
  const narrow = media?.type === 'atrule' ? media.nodes?.find(node => node.type === 'rule' && node.selectors.includes('.settings__tabs')) : undefined;
  const narrowProps = narrow?.type === 'rule' ? Object.fromEntries(narrow.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])) : {};
  expect(narrowProps['padding-left']).toBe('var(--space-4)');
  expect(narrowProps['padding-right']).toBe('var(--space-4)');
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByRole('tab', { name: 'General' }).id);
});

it.each([
  ['es', 'Acerca de', 'Tipografía Barlow · SIL Open Font License 1.1'],
  ['en', 'About', 'Barlow typeface · SIL Open Font License 1.1'],
] as const)('shows the font license credit in About (%s)', (locale, label, credit) => {
  setup(locale);
  tab(label);
  expect(screen.getByText(credit)).toBeTruthy();
});

it('selects each preset with a visible selected state and emits full settings', () => {
  const { onChange } = setup();
  tab('Apariencia');
  const presets = [
    ['rojo', '#ff0036'], ['naranja', '#ff7a00'], ['amarillo', '#ffd400'], ['verde', '#22c55e'],
    ['cian', '#00c2ff'], ['azul', '#3b82f6'], ['morado', '#8b5cf6'], ['rosa', '#ff3fb4'],
  ];
  for (const [name, accent] of presets.slice(1)) {
    const swatch = screen.getByRole('radio', { name });
    fireEvent.click(swatch);
    expect(swatch.getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, accent });
  }
  expect(onChange).toHaveBeenCalledTimes(7);
  fireEvent.click(screen.getByRole('button', { name: 'Restablecer rojo egdev' }));
  expect(onChange).toHaveBeenLastCalledWith(initial);
});

it('selects a custom native color and displays the derived tones', () => {
  const { onChange } = setup();
  tab('Apariencia');
  fireEvent.change(screen.getByLabelText('Elegir cualquier color de acento'), { target: { value: '#123456' } });
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, accent: '#123456' });
  const tones = screen.getByRole('group', { name: 'Tonos derivados' });
  for (const tone of ['#256bb1', '#eef3f9', '#96b8da']) expect(within(tones).getByText(tone)).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'rojo' }).getAttribute('aria-checked')).toBe('false');
});

it.each([
  ['Opacidad del fondo', 'opacity', 85, 86, 0, 100, '%'],
  ['Desenfoque del fondo', 'blur', 24, 25, 0, 40, 'px'],
] as const)('changes %s by keyboard, including its bounds and live readout', (label, field, start, next, min, max, unit) => {
  const { onChange } = setup();
  tab('Apariencia');
  const slider = screen.getByRole('slider', { name: label });
  expect(slider.getAttribute('aria-valuenow')).toBe(String(start));
  expect(slider.getAttribute('aria-valuemin')).toBe(String(min));
  expect(slider.getAttribute('aria-valuemax')).toBe(String(max));
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, [field]: next });
  expect(slider.getAttribute('aria-valuetext')).toBe(`${next} ${unit}`);
  expect(screen.getByText(`${next} ${unit}`)).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Vista previa de apariencia' }).style.getPropertyValue(`--settings-preview-${field}`)).toBe(`${next}${unit}`);
  fireEvent.keyDown(slider, { key: 'Home' });
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, [field]: min });
  fireEvent.keyDown(slider, { key: 'End' });
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, [field]: max });
});

it.each([
  ['Iniciar con Windows', 'startWithWindows', true],
  ['Mostrar novedades al abrir', 'showNewsOnOpen', false],
  ['Interfaz compacta', 'compact', true],
] as const)('toggles %s and preserves the other settings', (label, field, value) => {
  const { onChange } = setup();
  if (field === 'compact') tab('Apariencia');
  const toggle = screen.getByRole('switch', { name: label });
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe(String(value));
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, [field]: value });
});

it.each([
  ['es', 'Iniciar con Windows', 'Se comprueba con el sistema', 'startWithWindows', true],
  ['es', 'Mostrar novedades al abrir', 'Muestra las novedades del catálogo oficial cada vez que abres el panel.', 'showNewsOnOpen', false],
  ['es', 'Ocultar apps locales', 'No mostrar la sección Apps locales en Mis apps', 'hideLocalApps', true],
  ['es', 'Interfaz compacta', 'Reduce el espacio entre secciones', 'compact', true],
  ['en', 'Start with Windows', 'Checked with the system', 'startWithWindows', true],
  ['en', 'Show news on opening', 'Shows official catalog news whenever you open the panel.', 'showNewsOnOpen', false],
  ['en', 'Hide local apps', 'Do not show the Local apps section in My apps', 'hideLocalApps', true],
  ['en', 'Compact interface', 'Reduce spacing between sections', 'compact', true],
] as const)('uses a trailing choice for %s %s with its associated hint and working label', (locale, name, hint, key, value) => {
  const { onChange } = setup(locale);
  if (key === 'compact') tab(locale === 'es' ? 'Apariencia' : 'Appearance');
  const toggle = screen.getByRole('switch', { name, description: hint });
  const label = screen.getByText(name).closest('label');
  expect(label?.htmlFor).toBe(toggle.id);
  expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe(hint);
  fireEvent.click(label!);
  expect(toggle.getAttribute('aria-checked')).toBe(String(value));
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, [key]: value });
  fireEvent.click(screen.getByText(hint));
  expect(toggle.getAttribute('aria-checked')).toBe(String(!value));
  expect(onChange).toHaveBeenLastCalledWith(initial);
  expect(onChange).toHaveBeenCalledTimes(2);
  const field = toggle.closest('.eg-field');
  expect(field?.contains(label)).toBe(true);
  expect(field?.classList.contains('grid-cols-[minmax(0,1fr)_auto]')).toBe(true);
  expect(field?.lastElementChild).toBe(toggle);
});

it('preserves the unknown and busy autostart states and retries', () => {
  const change = vi.fn();
  const retry = vi.fn();
  const onChange = vi.fn();
  const view = (confirmed: boolean | null, busy: boolean) => <LocaleProvider locale="es"><SettingsView settings={initial} onClose={vi.fn()} onChange={onChange}
    autostart={{ confirmed, busy, error: 'Error de inicio', change, retry }} /></LocaleProvider>;
  const { rerender } = render(view(null, false));
  const toggle = screen.getByRole('switch', { name: 'Iniciar con Windows', description: 'Estado del sistema desconocido' });
  expect(toggle.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByText('Iniciar con Windows'));
  fireEvent.click(screen.getByText('Estado del sistema desconocido'));
  expect(change).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar inicio automático' }));
  expect(retry).toHaveBeenCalledOnce();
  rerender(view(true, true));
  expect(toggle.hasAttribute('disabled')).toBe(true);
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('switch', { name: 'Iniciar con Windows', description: 'Se comprueba con el sistema' })).toBe(toggle);
  rerender(view(true, false));
  fireEvent.click(screen.getByText('Iniciar con Windows'));
  expect(change).toHaveBeenCalledExactlyOnceWith(false);
  expect(onChange).not.toHaveBeenCalled();
});

it('describes news on every panel opening without suggesting a nonexistent news view', () => {
  setup();
  const toggle = screen.getByRole('switch', { name: 'Mostrar novedades al abrir' });
  const description = document.getElementById(toggle.getAttribute('aria-describedby')!);
  expect(description?.textContent).toBe('Muestra las novedades del catálogo oficial cada vez que abres el panel.');
});

it('changes language without the settings row styling the radio internals', () => {
  const style = document.createElement('style');
  style.textContent = settingsCss;
  document.head.append(style);
  try {
    const { onChange } = setup();
    const group = screen.getByRole('radiogroup', { name: 'Idioma' });
    const selected = within(group).getByRole('radio', { name: 'Español' });
    const indicator = selected.querySelector('span');
    const label = within(group).getByText('Español');
    expect(indicator).toBeTruthy();
    expect(settingsCss).not.toContain('.settings__row .eg-radio-group span');
    expect(settingsCss).not.toContain('.settings__row label,');
    const rules = Array.from(style.sheet!.cssRules).filter((rule): rule is CSSStyleRule => 'selectorText' in rule);
    expect(rules.filter(rule => rule.selectorText.startsWith('.settings__row') &&
      (indicator!.matches(rule.selectorText) || label.matches(rule.selectorText))).map(rule => rule.selectorText)).toEqual([]);
    fireEvent.click(within(group).getByRole('radio', { name: 'English' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, language: 'en' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Español' }));
    expect(onChange).toHaveBeenLastCalledWith(initial);
  } finally { style.remove(); }
});

it.each([
  ['es', 'Ajustes', 'Volver'],
  ['en', 'Settings', 'Back'],
] as const)('places the working back action before the settings title in a PageHeader (%s)', (locale, title, back) => {
  const { onClose } = setup(locale);
  const heading = screen.getByRole('heading', { level: 1, name: title });
  const header = heading.closest('header')!;
  const button = within(header).getByRole('button', { name: back });
  expect(header.classList.contains('eg-page-header')).toBe(true);
  expect(button.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(button.getAttribute('title')).toBe(back);
  fireEvent.click(button);
  expect(onClose).toHaveBeenCalledOnce();
});
