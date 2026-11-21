// @vitest-environment jsdom
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { readFileSync } from 'node:fs';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { cwd } from 'node:process';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { createAccentTheme } from '@egdev/tokens/accent';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NewsItem } from '../model';
import { LocaleProvider } from '../i18n/use-locale';
import { NewsPopup } from './index';

afterEach(cleanup);

const items: NewsItem[] = [
  { id: 'pizarra-news', appId: 'pizarra', badge: 'Nuevo', title: 'Pizarra', text: 'Tus ideas aquí.', cta: 'Ver en el catálogo' },
  { id: 'cadencia-news', appId: 'cadencia', badge: 'Destacada', title: 'Cadencia', text: 'Tu ritmo aquí.', cta: 'Descubrir' },
];

function setup() {
  const onClose = vi.fn();
  const onDontShowChange = vi.fn();
  function Fixture() {
    const [open, setOpen] = useState(false);
    const [dontShow, setDontShow] = useState(false);
    return (
      <main style={{ position: 'relative' }}>
        <button onClick={() => setOpen(true)}>Abrir novedades</button>
        <section inert>Contenido ya inerte</section>
        <NewsPopup
          items={items}
          open={open}
          dontShow={dontShow}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          onDontShowChange={(value) => {
            onDontShowChange(value);
            setDontShow(value);
          }}
        />
      </main>
    );
  }
  render(<Fixture />);
  return { onClose, onDontShowChange };
}

it('uses the DS dialog title without a header logo and retains the close control', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir novedades' }));
  const dialog = screen.getByRole('dialog', { name: 'Novedades' });
  expect(dialog.classList.contains('eg-dialog')).toBe(true);
  expect(within(dialog).getByRole('heading', { name: 'Novedades' })).toBeTruthy();
  expect(dialog.querySelector('header img')).toBeNull();
  expect(within(dialog).getByRole('button', { name: 'Cerrar novedades' })).toBeTruthy();
});

it('keeps its portal inside the flyout theme scope', () => {
  const variables = createAccentTheme('#123456').variables;
  render(
    <main style={variables as CSSProperties}>
      <NewsPopup items={items} open onClose={vi.fn()} dontShow={false} onDontShowChange={vi.fn()} />
    </main>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Novedades' });
  const main = screen.getByRole('main');
  expect(dialog.closest('main')).toBe(main);
  for (const [name, value] of Object.entries(variables)) expect(main.style.getPropertyValue(name), name).toBe(value);
  expect(within(dialog).getByRole('button', { name: 'Cerrar novedades' })).toBeTruthy();
});

it('renders nothing while closed', () => {
  const { container } = render(<NewsPopup items={items} open={false} onClose={() => {}} dontShow={false} onDontShowChange={() => {}} />);
  expect(container.childElementCount).toBe(0);
});

it('uses DS initial focus and traps focus, then restores the previous focus', async () => {
  const { onClose } = setup();
  const trigger = screen.getByRole('button', { name: 'Abrir novedades' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Novedades' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.closest('main')).toBeTruthy();
  expect(trigger.getAttribute('aria-hidden')).toBe('true');
  const first = within(dialog).getByRole('region', { name: 'Últimas novedades' });
  const close = within(dialog).getByRole('button', { name: 'Cerrar novedades' });
  expect(document.activeElement).toBe(first);
  close.focus();
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(close);
  trigger.focus();
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger.hasAttribute('aria-hidden')).toBe(false);
  expect(screen.getByText('Contenido ya inerte').hasAttribute('inert')).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('hides the focus ring on the automatic entry focus until the keyboard is used or focus leaves', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir novedades' }));
  const dialog = screen.getByRole('dialog', { name: 'Novedades' });
  const region = within(dialog).getByRole('region', { name: 'Últimas novedades' });
  expect(document.activeElement).toBe(region);
  expect(region.hasAttribute('data-entry-focus')).toBe(true);
  fireEvent.keyDown(region, { key: 'ArrowRight' });
  expect(region.hasAttribute('data-entry-focus')).toBe(false);
  const css = readFileSync(`${cwd()}/src/news/news.css`, 'utf8') as string;
  expect(css).toContain(".news-carousel [role='region']:focus-visible:not([data-entry-focus])");
});

it('drops the entry-focus marker when focus leaves the carousel', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir novedades' }));
  const dialog = screen.getByRole('dialog', { name: 'Novedades' });
  const region = within(dialog).getByRole('region', { name: 'Últimas novedades' });
  act(() => within(dialog).getByRole('button', { name: 'Cerrar novedades' }).focus());
  expect(region.hasAttribute('data-entry-focus')).toBe(false);
  act(() => region.focus());
  expect(region.hasAttribute('data-entry-focus')).toBe(false);
});

it('closes with Escape without propagating it and reopens on the latest item', async () => {
  const { onClose } = setup();
  const trigger = screen.getByRole('button', { name: 'Abrir novedades' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Diapositiva siguiente' }));
  expect(screen.getByRole('button', { name: 'Descubrir: Cadencia · muestra' })).toBeTruthy();
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fireEvent(document.activeElement!, event);
  expect(event.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'Ver en el catálogo: Pizarra · muestra' })).toBeTruthy();
});

it('closes on a scrim click and restores focus', async () => {
  const { onClose } = setup();
  const trigger = screen.getByRole('button', { name: 'Abrir novedades' });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Novedades' });
  const scrim = dialog.closest('.eg-dialog-backdrop');
  expect(scrim?.parentElement).toBe(trigger.parentElement);
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.pointerDown(scrim!, { button: 0, pointerType: 'mouse' });
  fireEvent.click(scrim!);
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it('uses manual carousel navigation and associates the external illustrative CTA with the current item', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir novedades' }));
  const carousel = screen.getByRole('region', { name: 'Últimas novedades' });
  const slides = within(carousel)
    .getAllByRole('group', { hidden: true })
    .filter((group) => group.getAttribute('aria-roledescription') === 'diapositiva');
  const [first, second] = slides;
  expect(first.getAttribute('aria-label')).toBe('1 de 2: Pizarra');
  expect(second.getAttribute('aria-label')).toBe('2 de 2: Cadencia');
  expect(first.getAttribute('aria-current')).toBe('true');
  expect(within(first).getByText('Nuevo')).toBeTruthy();
  expect(within(first).getByText('Tus ideas aquí.')).toBeTruthy();
  const initial = screen.getByRole('button', { name: 'Ver en el catálogo: Pizarra · muestra' });
  expect(carousel.contains(initial)).toBe(false);
  expect(initial.getAttribute('data-app-id')).toBe('pizarra');
  fireEvent.click(screen.getByRole('button', { name: 'Diapositiva siguiente' }));
  expect(second.getAttribute('aria-current')).toBe('true');
  expect(first.hasAttribute('aria-current')).toBe(false);
  expect(within(second).getByText('Destacada')).toBeTruthy();
  expect(within(second).getByText('Tu ritmo aquí.')).toBeTruthy();
  const next = screen.getByRole('button', { name: 'Descubrir: Cadencia · muestra' });
  expect(carousel.contains(next)).toBe(false);
  expect(next.getAttribute('data-app-id')).toBe('cadencia');
  fireEvent.click(next);
  expect(second.getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Diapositiva anterior' }));
  expect(first.getAttribute('aria-current')).toBe('true');
  first.focus();
  fireEvent.keyDown(first, { key: 'End' });
  expect(second.getAttribute('aria-current')).toBe('true');
  expect(screen.getByRole('button', { name: 'Descubrir: Cadencia · muestra' })).toBeTruthy();
  fireEvent.keyDown(second, { key: 'Home' });
  expect(first.getAttribute('aria-current')).toBe('true');
});

it('returns focus to a stable panel control if the initial trigger was unmounted', async () => {
  function InitialOpen() {
    const [open, setOpen] = useState(false);
    return (
      <main>
        <button>Cabecera</button>
        {!open && <button onClick={() => setOpen(true)}>Elegir idioma</button>}
        <NewsPopup items={items} open={open} onClose={() => setOpen(false)} dontShow={false} onDontShowChange={() => {}} />
      </main>
    );
  }
  render(<InitialOpen />);
  const trigger = screen.getByRole('button', { name: 'Elegir idioma' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar novedades' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cabecera' })));
});

it.each([
  ['es', 'No mostrar al abrir', 'Novedades'],
  ['en', "Don't show on opening", 'News'],
] as const)('uses a leading choice for the news preference in %s', (locale, name, title) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  function Fixture() {
    const [dontShow, setDontShow] = useState(false);
    return (
      <LocaleProvider locale={locale}>
        <main>
          <NewsPopup
            items={items}
            open
            dontShow={dontShow}
            onClose={onClose}
            onDontShowChange={(value) => {
              onChange(value);
              setDontShow(value);
            }}
          />
        </main>
      </LocaleProvider>
    );
  }
  render(<Fixture />);
  const checkbox = screen.getByRole('checkbox', { name });
  const label = screen.getByText(name).closest('label');
  expect(label?.htmlFor).toBe(checkbox.id);
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(label!);
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  expect(onChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(checkbox);
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  expect(onChange.mock.calls).toEqual([[true], [false]]);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: title })).toBeTruthy();
  const field = checkbox.closest('.eg-field');
  expect(field?.contains(label)).toBe(true);
  expect(field?.classList.contains('grid-cols-[auto_1fr]')).toBe(true);
  expect(field?.firstElementChild).toBe(checkbox);
});

it('binds the no-show preference without closing the popup', () => {
  const { onDontShowChange, onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Abrir novedades' }));
  const checkbox = screen.getByRole('checkbox', { name: 'No mostrar al abrir' });
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(checkbox);
  expect(onDontShowChange).toHaveBeenLastCalledWith(true);
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(checkbox);
  expect(onDontShowChange).toHaveBeenLastCalledWith(false);
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
});
