// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Icon, IconButton } from '@egdev/ui';
// @ts-ignore The browser tsconfig excludes Node types; Vitest runs in Node.
import { readFileSync } from 'node:fs';
// @ts-ignore Vitest's root is apps/hub.
import { cwd } from 'node:process';
import { FlyoutPanel } from './App';
import { defaultSettings } from './sample';
import type { HubApp, Language } from './model';
import type { Catalog } from './catalog/format';
import type { RegistrySnapshot } from './shell/registry';
const css = readFileSync(`${cwd()}/src/style.css`, 'utf8') as string;

const native = vi.hoisted(() => ({ invoke: vi.fn(), update: vi.fn(), listen: vi.fn(), publish: undefined as undefined | ((snapshot: RegistrySnapshot) => void), locale: 'es' as Language }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('./catalog/install', () => ({ updateApp: native.update, installApp: vi.fn(), cancelInstall: vi.fn(), onInstallProgress: native.listen }));
vi.mock('./settings/use-settings', () => ({ useSettings: () => ({ settings: { ...defaultSettings, language: native.locale, firstRunComplete: true, showNewsOnOpen: false, sources: [] }, fileState: 'ready', languageDraft: null, autostart: {}, recordVisit: vi.fn(), getVisit: () => null }) }));
vi.mock('./news/use-flyout', () => ({ useFlyoutVisibility: () => ({ visibility: null, lastShow: null, error: null }) }));
vi.mock('./shell/registry', () => ({ subscribeRegistry: vi.fn(async (publish: (snapshot: RegistrySnapshot) => void) => { native.publish = publish; return () => {}; }), exitHubOnly: vi.fn() }));
vi.mock('./window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));

const official: HubApp = { id: 'official', name: 'Official', description: 'Official app', source: 'official', integration: 'complete', installed: true, running: false, statusKnown: true, installationState: 'installed', canOpen: true, version: '1.0.0', links: { github: 'https://github.com/egdev6/official', youtube: 'https://www.youtube.com/@egdev' } };
const connected: HubApp = { ...official, id: 'plugin', name: 'Plugin', links: { github: 'https://github.com/other/plugin' } };
const catalog: Catalog = { schemaVersion: 3, apps: [official, connected].map(app => ({ id: app.id, name: app.name, tagline: '', description: '', tags: [], installerUrl: 'https://github.com/egdev6/official/setup.exe', latestJsonUrl: 'https://github.com/egdev6/official/latest.json', integrationLevel: 'full' as const, releasedAt: '2025-01-01T00:00:00Z', featured: false, news: [], version: '2.0.0', updaterPublicKey: 'key' })) };
const rows = [{ id: 'local:manual:1', source: 'local', name: 'Local One', state: 'missingExecutable', executable: 'C:\\Apps\\Local.exe', origin: { kind: 'manual', id: 'one' }, duplicateOf: 'official' }];
const absent: HubApp = { ...official, id: 'pizarra', name: 'Pizarra', installed: false, installationState: 'notInstalled' };
const card = (name: string) => within(screen.getByText(name).closest('.app-card') as HTMLElement);
const toggle = (name: string) => {
  const button = card(name).getAllByRole('button').find(element => element.hasAttribute('aria-expanded'));
  if (!button) throw new Error(`Missing trigger for ${name}`);
  return button;
};
async function show() {
  const refresh = vi.fn();
  render(<FlyoutPanel apps={[official, connected, absent]} news={[]} catalogState={{ status: 'ready', catalog }} onAppsRefresh={refresh} />);
  await screen.findByText('Local One');
  await waitFor(() => expect(native.publish).toBeTypeOf('function'));
  act(() => native.publish!({ revision: 1, apps: [{ app: { id: 'plugin', name: 'Plugin', version: '9.0.0' }, capabilities: ['show', 'quit'], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  return refresh;
}
beforeEach(() => {
  native.locale = 'es'; native.publish = undefined; native.invoke.mockReset(); native.update.mockReset(); native.listen.mockReset();
  native.listen.mockResolvedValue(() => {}); native.update.mockResolvedValue({ status: 'cancelled' });
  native.invoke.mockImplementation(async (command: string) => command === 'local_apps_list' ? rows : command === 'open_official_app' ? 'Inicio solicitado; no hay confirmación de ejecución' : null);
});
afterEach(cleanup);

it('starts closed and keeps a single open row across connected, installed and local sections', async () => {
  await show();
  for (const name of ['Plugin', 'Official', 'Local One']) expect(toggle(name).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle('Plugin')); expect(toggle('Plugin').getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(toggle('Official')); expect(toggle('Plugin').getAttribute('aria-expanded')).toBe('false'); expect(toggle('Official').getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(toggle('Local One')); expect(toggle('Official').getAttribute('aria-expanded')).toBe('false'); expect(toggle('Local One').getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(toggle('Local One')); expect(toggle('Local One').getAttribute('aria-expanded')).toBe('false');
});

it('uses sibling icon actions without toggling, starts only keyed updates, and preserves local repair', async () => {
  await show();
  const trigger = toggle('Official');
  const update = card('Official').getByRole('button', { name: 'Actualizar a v2.0.0' });
  const open = card('Official').getByRole('button', { name: 'Abrir Official' });
  render(<><IconButton label="secondary reference" variant="secondary" icon={<Icon name="arrow-down" />} /><IconButton label="ghost reference" variant="ghost" icon={<Icon name="arrow-down" />} /></>);
  expect(update.className).toBe(screen.getByRole('button', { name: 'secondary reference' }).className);
  expect(open.className).toBe(screen.getByRole('button', { name: 'ghost reference' }).className);
  expect(trigger.contains(update)).toBe(false); expect(trigger.contains(open)).toBe(false);
  await waitFor(() => expect((update as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(update); await waitFor(() => expect(native.update).toHaveBeenCalledExactlyOnceWith('official'));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(open); await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('open_official_app', { id: 'official' }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(card('Local One').getByRole('button', { name: 'Reparar Local One' }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('local_app_repair', { id: 'one' }));
  expect(toggle('Local One').getAttribute('aria-expanded')).toBe('false');
});

it('shows version links, badge-first update, social links and plugin close in details only', async () => {
  await show();
  expect(screen.queryByText(/Instalada: 1.0.0/)).toBeNull();
  fireEvent.click(toggle('Official'));
  const details = card('Official');
  expect(details.getByText(/Versión instalada:/)).toBeTruthy();
  const installedLink = details.getByRole('link', { name: '1.0.0' });
  expect(installedLink.getAttribute('href')).toBe('https://github.com/egdev6/official/releases/tag/v1.0.0');
  const next = details.getByRole('link', { name: '2.0.0' });
  expect(next.getAttribute('href')).toBe('https://github.com/egdev6/official/releases/tag/v2.0.0');
  expect(next.parentElement?.textContent).toMatch(/Nueva versión\s*2\.0\.0/);
  fireEvent.click(installedLink); await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('open_external', { url: 'https://github.com/egdev6/official/releases/tag/v1.0.0' }));
  fireEvent.click(details.getByRole('link', { name: /GitHub/i }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('open_external', { url: 'https://github.com/egdev6/official' }));
  fireEvent.click(details.getByRole('link', { name: /YouTube/i }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('open_external', { url: 'https://www.youtube.com/@egdev' }));
  fireEvent.click(toggle('Plugin'));
  expect(card('Plugin').queryByRole('link', { name: '1.0.0' })).toBeNull();
  fireEvent.click(card('Plugin').getByRole('button', { name: 'Cerrar Plugin' }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('close_connected_app', { id: 'plugin' }));
});

it('does not offer updates for equal, older or unkeyed versions and explains unverifiable versions', async () => {
  const refresh = vi.fn();
  const state = { ...catalog, apps: catalog.apps.map(item => ({ ...item, updaterPublicKey: undefined })) };
  const view = render(<FlyoutPanel apps={[official]} news={[]} catalogState={{ status: 'ready', catalog: state }} onAppsRefresh={refresh} />);
  await screen.findByText('Official');
  expect(card('Official').queryByRole('button', { name: /Actualizar.*v/ })).toBeNull();
  fireEvent.click(toggle('Official'));
  expect(card('Official').getByText(/falta la clave de verificación/)).toBeTruthy();
  expect(card('Official').queryByText('Nueva versión')).toBeNull();
  for (const version of ['1.0.0', '0.9.0']) {
    view.rerender(<FlyoutPanel apps={[official]} news={[]} catalogState={{ status: 'ready', catalog: { ...catalog, apps: catalog.apps.map(item => ({ ...item, version })) } }} onAppsRefresh={refresh} />);
    expect(card('Official').queryByRole('button', { name: /Actualizar.*v/ })).toBeNull();
    expect(card('Official').queryByText('Nueva versión')).toBeNull();
  }
  expect(native.update).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
});

it('keeps local path, provenance, warnings and close hint in its detail', async () => {
  await show(); fireEvent.click(toggle('Local One'));
  const local = card('Local One');
  expect(local.getByText('Local')).toBeTruthy(); expect(local.getByText('C:\\Apps\\Local.exe')).toBeTruthy();
  expect(local.getByText('Añadida manualmente')).toBeTruthy(); expect(local.getByText('Posible duplicado de Official')).toBeTruthy();
  expect(local.getByText('Ejecutable ausente o inaccesible')).toBeTruthy();
  expect(local.getByText('Para cerrar una app sin plugin, hazlo desde la propia app.')).toBeTruthy();
  expect((local.getByRole('button', { name: 'Abrir Local One' }) as HTMLButtonElement).disabled).toBe(true);
});

it('removes the catalog preview and news notice and puts refresh in the installed header without counts', async () => {
  const refresh = await show();
  expect(screen.queryByText('También en el catálogo')).toBeNull(); expect(screen.queryByText('Pizarra en Novedades')).toBeNull(); expect(screen.queryByText('Pizarra')).toBeNull();
  const heading = screen.getByRole('heading', { name: 'Instaladas' }).parentElement!;
  expect(within(heading).getByRole('button', { name: 'Actualizar apps' })).toBeTruthy(); expect(heading.textContent).not.toMatch(/\d/);
  fireEvent.click(within(heading).getByRole('button', { name: 'Actualizar apps' })); expect(refresh).toHaveBeenCalledOnce();
});

it('uses a short disclosure animation with a reduced-motion override', () => {
  expect(css).toMatch(/@keyframes\s+app-detail-open/); expect(css).toMatch(/@keyframes\s+app-detail-close/);
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce/); expect(css).toMatch(/animation:\s*none\s*!important/);
});
