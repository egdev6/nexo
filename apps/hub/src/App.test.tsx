// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { backdropAvailable, hideFlyout, resizeFlyout } from './window';

vi.mock('./window', () => ({
  backdropAvailable: vi.fn().mockResolvedValue(false),
  hideFlyout: vi.fn().mockResolvedValue(undefined),
  resizeFlyout: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => vi.clearAllMocks());

it('renders the Nexo main landmark', () => {
  render(<App />);
  expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Nexo' })).toBeTruthy();
});

it('switches tabs and associates the selected tab with its panel', () => {
  render(<App />);
  const apps = screen.getByRole('tab', { name: 'Mis apps' });
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  expect(apps.getAttribute('aria-selected')).toBe('true');
  fireEvent.click(catalog);
  expect(catalog.getAttribute('aria-selected')).toBe('true');
  expect(apps.getAttribute('aria-selected')).toBe('false');
  const panel = screen.getByRole('tabpanel');
  expect(panel.getAttribute('aria-labelledby')).toBe(catalog.id);
  expect(within(panel).getByRole('heading', { name: 'Catálogo egdev' })).toBeTruthy();
});

it('navigates and wraps tabs with arrow keys, Home and End', () => {
  render(<App />);
  const apps = screen.getByRole('tab', { name: 'Mis apps' });
  apps.focus();
  fireEvent.keyDown(apps, { key: 'ArrowLeft' });
  const news = screen.getByRole('tab', { name: 'Novedades' });
  expect(document.activeElement).toBe(news);
  expect(news.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(news, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(apps);
  fireEvent.keyDown(apps, { key: 'End' });
  expect(document.activeElement).toBe(news);
  fireEvent.keyDown(news, { key: 'Home' });
  expect(document.activeElement).toBe(apps);
});

it('expands and collapses an app row with aria-expanded', () => {
  render(<App />);
  const row = screen.getByRole('button', { name: /Antena.*En ejecución/ });
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Instalada: 1.4.0')).toBeTruthy();
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Instalada: 1.4.0')).toBeNull();
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Disponible: 1.5.0')).toBeTruthy();
});

it('shows running, update, stopped, local and not-installed statuses', () => {
  render(<App />);
  expect(screen.getByText('En ejecución')).toBeTruthy();
  expect(screen.getByText('Actualización disponible')).toBeTruthy();
  expect(screen.getByText(/Al día.*No está abierta.*Actualizaciones/)).toBeTruthy();
  expect(screen.getByText(/App local.*Solo apertura/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Catálogo' }));
  expect(screen.getAllByText(/No instalada.*Catálogo oficial/)).toHaveLength(2);
});

it('shows the Novedades list with both sample announcements', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Novedades' }));
  const panel = screen.getByRole('tabpanel');
  expect(within(panel).getByRole('heading', { name: 'Novedades del catálogo' })).toBeTruthy();
  expect(within(panel).getByText('Pizarra')).toBeTruthy();
  expect(within(panel).getByText('Cadencia')).toBeTruthy();
  expect(within(panel).getByText('Nuevo')).toBeTruthy();
  expect(within(panel).getByText('Destacada')).toBeTruthy();
});

it('explains an empty installed list and offers the catalog', () => {
  render(<App apps={[]} />);
  expect(screen.getByText('No hay aplicaciones instaladas.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ver catálogo' }));
  expect(screen.getByRole('tab', { name: 'Catálogo' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('No hay aplicaciones en el catálogo.')).toBeTruthy();
});

it('does not pretend sample actions installed or updated an app', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar Antena' }));
  expect(screen.getByText('Instalada: 1.4.0')).toBeTruthy();
  expect(screen.getByText('Actualización disponible')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Catálogo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Instalar Pizarra' }));
  expect(screen.getAllByText(/No instalada.*Catálogo oficial/)).toHaveLength(2);
  expect(screen.getByText(/acciones de apps y ajustes son ilustrativas/i)).toBeTruthy();
});

it('requests window hiding on Escape', () => {
  render(<App />);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(hideFlyout).toHaveBeenCalledTimes(1);
});

it('uses the translucent surface only when the native backdrop is available', async () => {
  vi.mocked(backdropAvailable).mockResolvedValueOnce(true);
  render(<App />);
  const panel = screen.getByRole('main');
  expect(panel.classList.contains('has-native-backdrop')).toBe(false);
  await waitFor(() => expect(panel.classList.contains('has-native-backdrop')).toBe(true));
});

it('keeps the opaque fallback when the native backdrop is unavailable', async () => {
  vi.mocked(backdropAvailable).mockResolvedValueOnce(false);
  render(<App />);
  await waitFor(() => expect(backdropAvailable).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('main').classList.contains('has-native-backdrop')).toBe(false);
});

it('requests a content-driven height again after the content changes', () => {
  let contentHeight = 320;
  let triggerResize = () => {};
  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      triggerResize = () => callback([], this as unknown as ResizeObserver);
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('panel-head')) return 100;
    if (this.classList.contains('scroll-content')) return contentHeight;
    return 0;
  });
  render(<App />);
  expect(resizeFlyout).toHaveBeenLastCalledWith(422);
  contentHeight = 180;
  fireEvent.click(screen.getByRole('button', { name: /Antena.*En ejecución/ }));
  triggerResize();
  expect(resizeFlyout).toHaveBeenLastCalledWith(282);
});
