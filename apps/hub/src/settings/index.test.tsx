// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { HubSettings, Language } from '../model';
import { SettingsView } from './index';
import { LocaleProvider } from '../i18n/use-locale';

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
  language: 'es', startWithWindows: false, showNewsOnOpen: true,
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
  expect(screen.getByText(/Versión 0\.1\.0/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Buscar actualizaciones/ }).hasAttribute('disabled')).toBe(true);
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
  const presets = ['#ff0036', '#ff7a00', '#ffd400', '#22c55e', '#00c2ff', '#3b82f6', '#8b5cf6', '#ff3fb4'];
  for (const accent of presets) {
    const swatch = screen.getByRole('button', { name: new RegExp(accent, 'i') });
    fireEvent.click(swatch);
    expect(swatch.getAttribute('aria-pressed')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, accent });
  }
  expect(onChange).toHaveBeenCalledTimes(8);
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
  expect(screen.getByRole('button', { name: /#ff0036/i }).getAttribute('aria-pressed')).toBe('false');
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

it('describes news on every panel opening without suggesting a nonexistent news view', () => {
  setup();
  const toggle = screen.getByRole('switch', { name: 'Mostrar novedades al abrir' });
  const description = document.getElementById(toggle.getAttribute('aria-describedby')!);
  expect(description?.textContent).toBe('Muestra las novedades del catálogo oficial cada vez que abres el panel.');
});

it('changes language in General and retains all other settings', () => {
  const { onChange } = setup();
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, language: 'en' });
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  expect(onChange).toHaveBeenLastCalledWith(initial);
});

it('keeps the existing back action', () => {
  const { onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(onClose).toHaveBeenCalledOnce();
});
