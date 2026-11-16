// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FlyoutPanel } from '../App';
import { CatalogView } from '../catalog';
import { NewsPopup } from '../news';
import { SettingsView } from '../settings';
import { defaultSettings } from '../sample';
import { LocaleProvider } from './use-locale';
import type { HubApp, Language, NewsItem } from '../model';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));

const items: NewsItem[] = [
  { id: 'n:outside:first', appId: 'outside', badge: 'Nuevo', title: 'Título original', text: 'Texto original', cta: 'Ver en el catálogo' },
  { id: 'n:outside:second', appId: 'outside', badge: 'Actualización', title: 'Segundo', text: 'Texto segundo', cta: 'Ver en el catálogo' },
];
const app: HubApp = { id: 'outside', name: 'Exterior', description: 'Descripción original', source: 'official', integration: 'local', installed: true, running: false };
let saved: typeof defaultSettings & { firstRunComplete: boolean; sources: { id: string; label: string; kind: string }[]; newsVisit?: { lastVisitAt: string; seenKeys: string[] } | null };
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  saved = { ...defaultSettings, language: 'en', firstRunComplete: true, sources: [{ id: 'official', label: 'Catálogo oficial egdev', kind: 'official' }] };
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'get_settings') return { state: 'ready', settings: { ...saved } };
    if (command === 'get_flyout_state') return { visible: true, sequence: 1, cycle: 1, at: '2026-05-31T12:00:00Z' };
    if (command === 'save_settings') { saved = { ...saved, ...args?.patch }; return { ...saved }; }
    if (command === 'plugin:autostart|is_enabled' || command === 'backdrop_available') return false;
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  ['es', 'Novedades al abrir', 'Sin ver', 'Se muestra la copia guardada, que puede estar desactualizada.', 'Diapositiva siguiente', 'Ver en el catálogo: Segundo'],
  ['en', 'News on opening', 'Unseen', 'Showing the saved copy, which may be outdated.', 'Next slide', 'View in catalog: Segundo'],
] as const)('localizes real-news chrome and preserves source content in %s', (locale, title, unseen, stale, next, cta) => {
  const onShown = vi.fn(); const onCatalog = vi.fn();
  render(<LocaleProvider locale={locale}><main><NewsPopup items={items} open stale dontShow={false} onClose={() => {}} onDontShowChange={() => {}} onShown={onShown} onCatalog={onCatalog} /></main></LocaleProvider>);
  const dialog = screen.getByRole('dialog', { name: title });
  expect(within(dialog).getByText('Título original')).toBeTruthy();
  expect(within(dialog).getByText('Texto original')).toBeTruthy();
  expect(within(dialog).getByText(unseen)).toBeTruthy();
  expect(within(dialog).getByText(stale).getAttribute('role')).toBe('status');
  fireEvent.click(within(dialog).getByRole('button', { name: next }));
  expect(onShown).toHaveBeenLastCalledWith(items[1]);
  fireEvent.click(within(dialog).getByRole('button', { name: cta }));
  expect(onCatalog).toHaveBeenCalledExactlyOnceWith('outside');
});

it.each([
  ['es', 'Mostrar novedades al abrir', 'Muestra las novedades del catálogo oficial cada vez que abres el panel.', 'Esta aplicación ya no está disponible en el catálogo.', 'Reintentar catálogo'],
  ['en', 'Show news on opening', 'Shows official catalog news whenever you open the panel.', 'This application is no longer available in the catalog.', 'Retry catalog'],
] as const)('localizes the #10 settings hint and missing catalog target in %s', (locale, label, hint, missing, retry) => {
  const retryFn = vi.fn();
  const { unmount } = render(<LocaleProvider locale={locale}><SettingsView settings={{ ...defaultSettings, language: locale }} onChange={() => {}} onClose={() => {}} /></LocaleProvider>);
  const toggle = screen.getByRole('switch', { name: label });
  expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe(hint);
  unmount();
  render(<LocaleProvider locale={locale}><CatalogView apps={[]} targetAppId="missing" onRetry={retryFn} /></LocaleProvider>);
  expect(screen.getByRole('alert').textContent).toContain(missing);
  fireEvent.click(screen.getByRole('button', { name: retry }));
  expect(retryFn).toHaveBeenCalledOnce();
});

it('navigates English real news to its installed official app and persists viewed keys', async () => {
  render(<FlyoutPanel apps={[app]} news={items} />);
  const dialog = await screen.findByRole('dialog', { name: 'News on opening' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'View in catalog: Título original' }));
  const target = await screen.findByRole('article', { name: 'Exterior' });
  await waitFor(() => expect(document.activeElement).toBe(target));
  await waitFor(() => expect(saved.newsVisit?.seenKeys).toContain('n:outside:first'));
  expect(saved.newsVisit?.seenKeys).not.toContain('n:outside:second');
  expect(saved.language).toBe('en');
});

it('persists the news opt-out and viewed marker across a live language change and restart', async () => {
  const view = render(<FlyoutPanel apps={[app]} news={items} />);
  const dialog = await screen.findByRole('dialog', { name: 'News on opening' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: "Don't show on opening" }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close news' }));
  await waitFor(() => expect(saved).toMatchObject({ showNewsOnOpen: false, newsVisit: { seenKeys: ['n:outside:first'] } }));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  await waitFor(() => expect(saved.language).toBe('es'));
  expect(saved.newsVisit?.seenKeys).toEqual(['n:outside:first']);
  view.unmount();
  render(<FlyoutPanel apps={[app]} news={items} />);
  expect(await screen.findByRole('button', { name: 'Ajustes' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(saved.showNewsOnOpen).toBe(false);
});

it.each(['es', 'en'] as Language[])('shows visibility diagnostics with localized context in %s', async locale => {
  saved = { ...saved, language: locale, showNewsOnOpen: false };
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'get_flyout_state') throw 'diagnostic';
    return normal(command, args);
  });
  render(<FlyoutPanel apps={[]} news={[]} />);
  const alert = await screen.findByRole('alert');
  await waitFor(() => expect(alert.textContent).toBe(locale === 'en' ? 'Could not check panel visibility: diagnostic' : 'No se pudo comprobar la visibilidad del panel: diagnostic'));
});
