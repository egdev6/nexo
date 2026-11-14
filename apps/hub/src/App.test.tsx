// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { CatalogViewProps, FirstRunProps, NewsPopupProps, SettingsViewProps } from './model';
import { backdropAvailable, hideFlyout } from './window';
import { exitHubOnly, subscribeRegistry } from './shell/registry';
import type { RegistrySnapshot } from './shell/registry';

// Test the shell's public wiring independently of the other area writers.
vi.mock('./catalog', () => ({
  CatalogView: ({ apps }: CatalogViewProps) => <div>Catálogo de prueba: {apps.map(app => app.name).join(', ')}</div>,
}));
vi.mock('./first-run', () => ({
  FirstRun: ({ onChoose }: FirstRunProps) => <section aria-label="Idioma"><button onClick={() => onChoose('es')}>Español</button><button onClick={() => onChoose('en')}>English</button></section>,
}));
vi.mock('./news', () => ({
  NewsPopup: ({ items, open, onClose, dontShow, onDontShowChange }: NewsPopupProps) => open ? <div role="dialog" aria-label="Novedades">
    <p>{items.map(item => item.title).join(' / ')}</p>
    <label><input type="checkbox" checked={dontShow} onChange={event => onDontShowChange(event.target.checked)} />No mostrar al abrir</label>
    <button onClick={onClose}>Cerrar novedades</button>
  </div> : null,
}));
vi.mock('./settings', () => ({
  SettingsView: ({ settings, onChange, onClose }: SettingsViewProps) => <section aria-label="Ajustes">
    <p>Idioma: {settings.language}</p>
    <button onClick={() => onChange({ ...settings, accent: '#3b82f6', compact: true, opacity: 63, blur: 12 })}>Cambiar apariencia</button>
    <button onClick={() => onChange({ ...settings, showNewsOnOpen: !settings.showNewsOnOpen })}>Alternar novedades</button>
    <button onClick={onClose}>Volver</button>
  </section>,
}));
vi.mock('./shell/registry', () => ({
  subscribeRegistry: vi.fn().mockResolvedValue(() => {}),
  exitHubOnly: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./window', () => ({
  backdropAvailable: vi.fn().mockResolvedValue(false),
  hideFlyout: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function enter(language: 'Español' | 'English' = 'Español') {
  const choice = screen.queryByRole('button', { name: language });
  if (choice) fireEvent.click(choice);
}
function closeNews() {
  const close = screen.queryByRole('button', { name: 'Cerrar novedades' });
  if (close) fireEvent.click(close);
}

it('starts with language choice and then shows the installed list, retaining the choice', () => {
  render(<App />);
  expect(screen.getByRole('region', { name: 'Idioma' })).toBeTruthy();
  expect(screen.queryByText('Instaladas')).toBeNull();
  enter('English');
  expect(screen.getByText('Instaladas')).toBeTruthy();
  closeNews();
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  expect(screen.getByText('Idioma: en')).toBeTruthy();
});

it('uses only two tabs, associates panels and passes apps to CatalogView', () => {
  render(<App />); enter(); closeNews();
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map(tab => tab.textContent)).toEqual(['Mis apps', 'Catálogo']);
  expect(screen.queryByRole('tab', { name: 'Novedades' })).toBeNull();
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  fireEvent.mouseDown(catalog, { button: 0 });
  fireEvent.click(catalog);
  expect(catalog.getAttribute('aria-selected')).toBe('true');
  const panel = screen.getByRole('tabpanel');
  expect(panel.getAttribute('aria-labelledby')).toBe(catalog.id);
  expect(within(panel).getByText(/Catálogo de prueba: Antena, Quorb, OBS Studio, Pizarra, Cadencia/)).toBeTruthy();
});

it('preserves keyboard selection and wraparound for the two tabs', async () => {
  render(<App />); enter(); closeNews();
  const apps = screen.getByRole('tab', { name: 'Mis apps' });
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  apps.focus(); fireEvent.keyDown(apps, { key: 'ArrowLeft' });
  await waitFor(() => expect(document.activeElement).toBe(catalog));
  expect(catalog.getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(catalog, { key: 'Home' });
  await waitFor(() => expect(document.activeElement).toBe(apps));
});

it('opens settings with the gear and returns to the selected tab', () => {
  render(<App />); enter(); closeNews();
  const catalog = screen.getByRole('tab', { name: 'Catálogo' });
  fireEvent.mouseDown(catalog, { button: 0 });
  fireEvent.click(catalog);
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  expect(screen.getByRole('region', { name: 'Ajustes' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  expect(screen.getByRole('tab', { name: 'Catálogo' }).getAttribute('aria-selected')).toBe('true');
});

it('shows sample news in the panel on opening and honours the opt-out on reopening', () => {
  render(<App />); enter();
  const main = screen.getByRole('main');
  expect(within(main).getByRole('dialog', { name: 'Novedades' })).toBeTruthy();
  expect(screen.getByText(/Pizarra.*Cadencia/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'No mostrar al abrir' }));
  closeNews();
  fireEvent.focus(window);
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Alternar novedades' }));
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  fireEvent.focus(window);
  expect(screen.getByRole('dialog', { name: 'Novedades' })).toBeTruthy();
});

it('does not open news when the list is empty', () => {
  render(<App news={[]} />); enter();
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
  fireEvent.focus(window);
  expect(screen.queryByRole('dialog', { name: 'Novedades' })).toBeNull();
});

it('applies live appearance settings to the panel root', () => {
  render(<App />); enter(); closeNews();
  const main = screen.getByRole('main');
  expect(main.style.getPropertyValue('--hub-accent')).toBe('#ff0036');
  expect(main.style.getPropertyValue('--hub-density')).toBe('1');
  expect(main.style.getPropertyValue('--hub-opacity')).toBe('0.85');
  expect(main.style.getPropertyValue('--hub-blur')).toBe('24px');
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar apariencia' }));
  expect(main.style.getPropertyValue('--hub-accent')).toBe('#3b82f6');
  expect(main.style.getPropertyValue('--hub-density')).toBe('0.8');
  expect(main.style.getPropertyValue('--hub-opacity')).toBe('0.63');
  expect(main.style.getPropertyValue('--hub-blur')).toBe('12px');
});

it('renders live connections and menus without duplicating sample identities', async () => {
  let publish: ((snapshot: RegistrySnapshot) => void) | undefined;
  const unsubscribe = vi.fn();
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return unsubscribe; });
  const { unmount } = render(<App news={[]} />); enter();
  await waitFor(() => expect(publish).toBeTypeOf('function'));
  act(() => publish!({ revision: 2, apps: [{
    app: { id: 'antena', name: 'Antena', version: '2.0.0' },
    capabilities: ['show', 'menu'], unified: false, responsive: true, generation: 1, menu_revision: 1,
    menu: [{ id: 'pause', label: 'Pausar', enabled: false, checked: true }],
  }, {
    app: { id: 'external', name: 'Nueva app', version: '1.0.0' },
    capabilities: [], unified: true, responsive: false, generation: 2, menu_revision: 0, menu: [],
  }] }));
  expect(screen.getAllByText('Antena')).toHaveLength(1);
  expect(screen.getByText('Nueva app')).toBeTruthy();
  expect(screen.getByText('Conectada')).toBeTruthy();
  expect(screen.getByText(/Sin respuesta.*estado desconocido/i)).toBeTruthy();
  expect(screen.getByText(/Pausar.*desactivada.*marcada/i)).toBeTruthy();
  expect(screen.queryByText(/No está abierta/)).toBeNull();
  act(() => publish!({ revision: 1, apps: [] }));
  expect(screen.getByText('Nueva app')).toBeTruthy();
  unmount();
  await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
});

it('unsubscribes even if the asynchronous subscription resolves after unmount', async () => {
  let resolveSubscription: ((stop: () => void) => void) | undefined;
  const stop = vi.fn();
  vi.mocked(subscribeRegistry).mockReturnValueOnce(new Promise(resolve => { resolveSubscription = resolve; }));
  const { unmount } = render(<App news={[]} />);
  unmount();
  await act(async () => { resolveSubscription!(stop); });
  expect(stop).toHaveBeenCalledOnce();
});

it('explains a blocked hub exit and requires an explicit hub-only choice', async () => {
  let publish: ((snapshot: RegistrySnapshot) => void) | undefined;
  vi.mocked(subscribeRegistry).mockImplementation(async callback => { publish = callback; return () => {}; });
  render(<App news={[]} />); enter();
  await waitFor(() => expect(publish).toBeTypeOf('function'));
  act(() => publish!({ revision: 3, apps: [], notice: { message: 'Antena: cambios sin guardar', hub_only_allowed: true } }));
  expect(screen.getByRole('alert').textContent).toContain('Antena: cambios sin guardar');
  expect(exitHubOnly).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Salir solo de Nexo' }));
  expect(exitHubOnly).toHaveBeenCalledOnce();
});

it('preserves expandable rows, statuses and illustrative actions', () => {
  render(<App />); enter(); closeNews();
  expect(screen.getAllByText(/Estado desconocido/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Actualización disponible/)).toBeTruthy();
  expect(screen.getByText(/App local.*Estado desconocido/)).toBeTruthy();
  const row = screen.getByRole('button', { name: /Antena.*Estado desconocido/ });
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect((screen.getByRole('button', { name: 'Actualizar Antena' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar Antena' }));
  expect(screen.getByText('Instalada: 1.4.0')).toBeTruthy();
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Instalada: 1.4.0')).toBeNull();
  fireEvent.click(row);
  expect(screen.getByText('Disponible: 1.5.0')).toBeTruthy();
  expect(screen.getByText(/acciones.*ilustrativas/i)).toBeTruthy();
});

it('preserves the empty installed state and catalog navigation', () => {
  render(<App apps={[]} news={[]} />); enter();
  expect(screen.getByText('No hay aplicaciones instaladas.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ver catálogo' }));
  expect(screen.getByRole('tab', { name: 'Catálogo' }).getAttribute('aria-selected')).toBe('true');
});

it('hides on close and Escape, except while the news dialog owns Escape', () => {
  render(<App />); enter();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(hideFlyout).not.toHaveBeenCalled();
  closeNews();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  expect(hideFlyout).toHaveBeenCalledTimes(2);
});

it('keeps the opaque fallback and enables native backdrop only when available', async () => {
  vi.mocked(backdropAvailable).mockResolvedValueOnce(true);
  const { unmount } = render(<App />);
  const panel = screen.getByRole('main');
  expect(panel.classList.contains('has-native-backdrop')).toBe(false);
  await waitFor(() => expect(panel.classList.contains('has-native-backdrop')).toBe(true));
  unmount();
  vi.mocked(backdropAvailable).mockResolvedValueOnce(false);
  render(<App />);
  await waitFor(() => expect(backdropAvailable).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('main').classList.contains('has-native-backdrop')).toBe(false);
});
