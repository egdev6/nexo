// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { HubSettings, Language } from '../model';
import { LocaleProvider } from '../i18n/use-locale';
import { SettingsView } from './index';

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
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

const initial: HubSettings = {
  language: 'es',
  startWithWindows: false,
  showNewsOnOpen: true,
  hideLocalApps: false,
  accent: '#ff0036',
  compact: false,
  opacity: 85,
  blur: 24,
};
const colors = ['#ff0036', '#ff7a00', '#ffd400', '#22c55e', '#00c2ff', '#3b82f6', '#8b5cf6', '#ff3fb4'];

function setup(locale: Language = 'es', acceptChanges = true) {
  const onChange = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(initial);
    return (
      <SettingsView
        settings={settings}
        onClose={vi.fn()}
        onChange={(next) => {
          onChange(next);
          if (acceptChanges) setSettings(next);
        }}
      />
    );
  }
  render(
    <LocaleProvider locale={locale}>
      <Harness />
    </LocaleProvider>,
  );
  return onChange;
}

function selectTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

it('shows no DS brand edge on any settings panel', () => {
  setup();
  const general = screen.getByRole('region', { name: 'General' });
  expect(general.querySelector('.eg-panel')?.classList.contains('before:bg-fg-brand-default')).toBe(false);
  selectTab('Apariencia');
  const region = screen.getByRole('region', { name: 'Apariencia' });
  const panel = region.querySelector('.eg-panel');
  expect(panel?.getAttribute('data-variant')).toBe('banded');
  expect(panel?.classList.contains('before:bg-fg-brand-default')).toBe(false);
  expect(region.classList.contains('settings__appearance')).toBe(false);
  selectTab('Acerca de');
  for (const name of ['Acerca de', 'Autor']) {
    expect(screen.getByRole('region', { name }).querySelector('.eg-panel')?.classList.contains('before:bg-fg-brand-default')).toBe(false);
  }
});

it.each([
  ['es', 'Apariencia', 'Color de acento', 'Elegir cualquier color de acento', ['rojo', 'naranja', 'amarillo', 'verde', 'cian', 'azul', 'morado', 'rosa']],
  ['en', 'Appearance', 'Accent color', 'Choose any accent color', ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']],
] as const)('exposes localized preset radios and the controlled picker in %s', (locale, appearance, label, customLabel, names) => {
  const onChange = setup(locale);
  selectTab(appearance);
  const fieldset = screen.getByRole('group', { name: label });
  const group = within(fieldset).getByRole('radiogroup', { name: label });
  const output = within(fieldset).getByRole('status');
  const picker = within(fieldset).getByLabelText(customLabel) as HTMLInputElement;
  expect(fieldset.tagName).toBe('FIELDSET');
  expect(fieldset.classList.contains('eg-color-swatch-group')).toBe(true);
  expect(within(group).getAllByRole('radio')).toHaveLength(colors.length);
  expect(picker.type).toBe('color');
  expect(picker.value).toBe(colors[0]);
  expect(output.textContent).toBe(`${label}: ${colors[0]}`);
  fireEvent.click(within(group).getByRole('radio', { name: names[0] }));
  expect(onChange).not.toHaveBeenCalled();
  colors.slice(1).forEach((color, offset) => {
    const radio = within(group).getByRole('radio', { name: names[offset + 1] });
    fireEvent.click(radio);
    expect(radio.getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, accent: color });
    expect(picker.value).toBe(color);
    expect(output.textContent).toBe(`${label}: ${color}`);
  });
  expect(onChange).toHaveBeenCalledTimes(7);
});

it('retains non-preset custom colors, derived tones and the app-owned reset', () => {
  const onChange = setup();
  selectTab('Apariencia');
  const fieldset = screen.getByRole('group', { name: 'Color de acento' });
  const picker = within(fieldset).getByLabelText('Elegir cualquier color de acento') as HTMLInputElement;
  fireEvent.change(picker, { target: { value: '#123456' } });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...initial, accent: '#123456' });
  expect(picker.value).toBe('#123456');
  expect(within(fieldset).getByRole('status').textContent).toBe('Color de acento: #123456');
  const group = within(fieldset).getByRole('radiogroup', { name: 'Color de acento' });
  expect(
    within(group)
      .getAllByRole('radio')
      .every((radio) => radio.getAttribute('aria-checked') === 'false'),
  ).toBe(true);
  const tones = screen.getByRole('group', { name: 'Tonos derivados' });
  for (const tone of ['#256bb1', '#eef3f9', '#96b8da']) expect(within(tones).getByText(tone)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Restablecer rojo egdev' }));
  expect(onChange).toHaveBeenLastCalledWith(initial);
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(picker.value).toBe('#ff0036');
  expect(within(group).getByRole('radio', { name: 'rojo' }).getAttribute('aria-checked')).toBe('true');
  expect(within(fieldset).getByRole('status').textContent).toBe('Color de acento: #ff0036');
});

it('keeps the accepted color when the settings owner rejects requests', () => {
  const onChange = setup('es', false);
  selectTab('Apariencia');
  const group = screen.getByRole('radiogroup', { name: 'Color de acento' });
  fireEvent.click(within(group).getByRole('radio', { name: 'azul' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, accent: '#3b82f6' });
  expect(within(group).getByRole('radio', { name: 'rojo' }).getAttribute('aria-checked')).toBe('true');
  const picker = screen.getByLabelText('Elegir cualquier color de acento') as HTMLInputElement;
  fireEvent.change(picker, { target: { value: '#123456' } });
  expect(onChange).toHaveBeenLastCalledWith({ ...initial, accent: '#123456' });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(picker.value).toBe('#ff0036');
  expect(within(screen.getByRole('group', { name: 'Color de acento' })).getByRole('status').textContent).toBe('Color de acento: #ff0036');
});

it('selects the next preset using radio keyboard navigation', async () => {
  const onChange = setup();
  selectTab('Apariencia');
  const group = screen.getByRole('radiogroup', { name: 'Color de acento' });
  const red = within(group).getByRole('radio', { name: 'rojo' });
  const orange = within(group).getByRole('radio', { name: 'naranja' });
  red.focus();
  fireEvent.keyDown(red, { key: 'ArrowRight' });
  await waitFor(() => expect(document.activeElement).toBe(orange));
  expect(orange.getAttribute('aria-checked')).toBe('true');
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...initial, accent: '#ff7a00' });
});
