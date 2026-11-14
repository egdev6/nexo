// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NewsItem } from '../model';
import { NewsPopup } from './index';
import nexoLogo from '../../src-tauri/app-icon.svg';

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
    return <main style={{ position: 'relative' }}>
      <button onClick={() => setOpen(true)}>Abrir novedades</button>
      <section inert>Contenido ya inerte</section>
      <NewsPopup items={items} open={open} dontShow={dontShow}
        onClose={() => { onClose(); setOpen(false); }}
        onDontShowChange={value => { onDontShowChange(value); setDontShow(value); }} />
    </main>;
  }
  render(<Fixture />);
  return { onClose, onDontShowChange };
}

it('renders the Nexo logo in the news header and retains the close control', () => {
  setup(); fireEvent.click(screen.getByRole('button', { name: 'Abrir novedades' }));
  const dialog = screen.getByRole('dialog', { name: 'Novedades al abrir' });
  const mark = dialog.querySelector('header img');
  expect(mark?.getAttribute('src')).toBe(nexoLogo);
  expect(mark?.getAttribute('alt')).toBe('');
  expect(within(dialog).getByRole('button', { name: 'Cerrar novedades' })).toBeTruthy();
});

it('renders nothing while closed', () => {
  const { container } = render(<NewsPopup items={items} open={false} onClose={() => {}} dontShow={false} onDontShowChange={() => {}} />);
  expect(container.childElementCount).toBe(0);
});

it('opens an in-panel labelled modal, traps focus and restores both focus and inert state on close', () => {
  const { onClose } = setup();
  const trigger = screen.getByRole('button', { name: 'Abrir novedades' });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Novedades al abrir' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(dialog.closest('main')).toBeTruthy();
  expect(trigger.hasAttribute('inert')).toBe(true);
  const close = within(dialog).getByRole('button', { name: 'Cerrar novedades' });
  const checkbox = within(dialog).getByRole('checkbox', { name: 'No mostrar al abrir' });
  expect(document.activeElement).toBe(close);
  close.focus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(checkbox);
  fireEvent.keyDown(checkbox, { key: 'Tab' });
  expect(document.activeElement).toBe(close);
  trigger.focus();
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger.hasAttribute('inert')).toBe(false);
  expect(screen.getByText('Contenido ya inerte').hasAttribute('inert')).toBe(true);
  expect(document.activeElement).toBe(trigger);
});

it('closes with Escape without propagating it and reopens on the latest item', () => {
  const { onClose } = setup();
  const trigger = screen.getByRole('button', { name: 'Abrir novedades' });
  trigger.focus(); fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Diapositiva siguiente' }));
  expect(screen.getByRole('button', { name: 'Descubrir: Cadencia · muestra' })).toBeTruthy();
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fireEvent(document.activeElement!, event);
  expect(event.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'Ver en el catálogo: Pizarra · muestra' })).toBeTruthy();
});

it('uses manual carousel navigation and associates the external illustrative CTA with the current item', () => {
  setup(); fireEvent.click(screen.getByRole('button', { name: 'Abrir novedades' }));
  const carousel = screen.getByRole('group', { name: 'Últimas novedades' });
  const first = within(carousel).getByRole('group', { name: '1 de 2: Pizarra' });
  const second = within(carousel).getByRole('group', { name: '2 de 2: Cadencia' });
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
  first.focus(); fireEvent.keyDown(first, { key: 'End' });
  expect(second.getAttribute('aria-current')).toBe('true');
  expect(screen.getByRole('button', { name: 'Descubrir: Cadencia · muestra' })).toBeTruthy();
  fireEvent.keyDown(second, { key: 'Home' });
  expect(first.getAttribute('aria-current')).toBe('true');
});

it('returns focus to a stable panel control if the initial trigger was unmounted', () => {
  function InitialOpen() {
    const [open, setOpen] = useState(false);
    return <main><button>Cabecera</button>{!open && <button onClick={() => setOpen(true)}>Elegir idioma</button>}
      <NewsPopup items={items} open={open} onClose={() => setOpen(false)} dontShow={false} onDontShowChange={() => {}} />
    </main>;
  }
  render(<InitialOpen />);
  const trigger = screen.getByRole('button', { name: 'Elegir idioma' });
  trigger.focus(); fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar novedades' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cabecera' }));
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
