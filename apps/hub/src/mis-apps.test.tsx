// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Button, Icon, IconButton, Link } from '@egdev/ui';
import postcss from 'postcss';
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

it('uses the decorative DS external-link glyph for installed, connected and local open buttons', async () => {
  await show();
  const reference = render(<IconButton label="reference" variant="ghost" icon={<Icon name="external-link" />} />).container.querySelector('svg')!;
  for (const name of ['Official', 'Plugin', 'Local One']) {
    const svg = card(name).getByRole('button', { name: `Abrir ${name}` }).querySelector('svg')!;
    expect(svg.isEqualNode(reference)).toBe(true);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  }
});

it('excludes unknown and absent catalog apps while keeping detected and manual apps', async () => {
  const unknown = { ...official, id: 'quorb', name: 'Quorb', installed: false, statusKnown: false, installationState: 'unknown' as const, installationReason: 'Sin datos de detección en el catálogo' };
  const contradictory = { ...unknown, id: 'uncertain', name: 'Uncertain', installed: true, statusKnown: true };
  render(<FlyoutPanel apps={[official, absent, unknown, contradictory]} news={[]} installedStateKnown={false} onAppsRefresh={() => {}} />);
  await screen.findByText('Local One');
  expect(screen.getByText('Official')).toBeTruthy();
  expect(screen.queryByText('Pizarra')).toBeNull();
  expect(screen.queryByText('Quorb')).toBeNull();
  expect(screen.queryByText('Uncertain')).toBeNull();
});

it('keeps an unknown catalog app when connected without a fabricated installed version', async () => {
  const unknown = { ...official, id: 'quorb', name: 'Quorb', installed: false, statusKnown: false, installationState: 'unknown' as const, installationReason: 'Sin datos de detección en el catálogo', version: undefined };
  render(<FlyoutPanel apps={[unknown]} news={[]} installedStateKnown={false} onAppsRefresh={() => {}} />);
  await waitFor(() => expect(native.publish).toBeTypeOf('function'));
  act(() => native.publish!({ revision: 1, apps: [{ app: { id: 'quorb', name: 'Quorb', version: '3.0.0' }, capabilities: ['show'], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  fireEvent.click(toggle('Quorb'));
  expect(card('Quorb').getByText(/Versión comunicada: 3.0.0/)).toBeTruthy();
  expect(card('Quorb').queryByText(/versión no disponible|Apertura no disponible|Sin datos de detección/)).toBeNull();
  fireEvent.click(card('Quorb').getByRole('button', { name: 'Abrir Quorb' }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('open_official_app', { id: 'quorb' }));
});

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
  const reference = render(<><IconButton label="secondary reference" variant="secondary" icon={<Icon name="download" />} /><IconButton label="ghost reference" variant="ghost" icon={<Icon name="arrow-down" />} /></>);
  expect(update.querySelector('svg')?.isEqualNode(reference.container.querySelector('svg'))).toBe(true);
  expect(update.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
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

it('uses a decorative running StatusDot beside the connected text', async () => {
  await show();
  const connected = card('Plugin').getByText('Conectada');
  expect(connected.querySelector('.eg-status-dot[data-state="running"][aria-hidden="true"]')).toBeTruthy();
});

it('uses a level-two PageHeader for local app refresh', async () => {
  await show();
  const header = screen.getByRole('heading', { name: 'Apps locales', level: 2 }).closest('header');
  expect(header?.classList.contains('eg-page-header')).toBe(true);
  expect(within(header!).getByRole('button', { name: 'Actualizar apps locales' })).toBeTruthy();
});

it('shows version links, badge-first update, social links and plugin close in details only', async () => {
  await show();
  expect(screen.queryByText(/Instalada: 1.0.0/)).toBeNull();
  fireEvent.click(toggle('Official'));
  const details = card('Official');
  const social = details.getByRole('list', { name: 'Enlaces sociales' });
  expect(social.classList.contains('flex-wrap')).toBe(true);
  expect(social.classList.contains('gap-2')).toBe(true);
  expect(social.parentElement?.classList.contains('eg-cluster')).toBe(true);
  expect(social.parentElement?.classList.contains('detail-social')).toBe(true);
  for (const link of within(social).getAllByRole('link')) {
    expect(link.classList.contains('border-border-hairline-strong')).toBe(true);
    const icon = link.querySelector('svg');
    expect(icon?.getAttribute('color')).toBe('var(--color-fg-brand-default)');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.classList.contains('stroke-current')).toBe(true);
  }
  expect(css).not.toContain('.detail-inner .eg-social');
  expect(css).not.toContain('.eg-social__list');
  expect(details.getByText(/Versión instalada:/)).toBeTruthy();
  const installedLink = details.getByRole('link', { name: '1.0.0' });
  expect(installedLink.classList.contains('eg-link')).toBe(true);
  expect(installedLink.getAttribute('href')).toBe('https://github.com/egdev6/official/releases/tag/v1.0.0');
  const reference = render(<Link href="https://example.com">reference</Link>).container.querySelector('svg')!;
  expect(reference.getAttribute('aria-hidden')).toBe('true');
  expect(installedLink.querySelector('svg')?.isEqualNode(reference)).toBe(true);
  const next = details.getByRole('link', { name: '2.0.0' });
  expect(next.getAttribute('href')).toBe('https://github.com/egdev6/official/releases/tag/v2.0.0');
  expect(next.querySelector('svg')?.isEqualNode(reference)).toBe(true);
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

it('preserves shared external-link errors and clears them on a later successful social click', async () => {
  await show();
  fireEvent.click(toggle('Official'));
  const details = card('Official');
  native.invoke.mockRejectedValueOnce(new Error('private diagnostic'));
  fireEvent.click(details.getByRole('link', { name: '1.0.0' }));
  const alert = await details.findByRole('alert');
  expect(alert.textContent).toBe('No se pudo abrir el enlace.');
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(alert.dataset.size).toBe('sm');
  fireEvent.click(details.getByRole('link', { name: /GitHub/i }));
  await waitFor(() => expect(details.queryByRole('alert')).toBeNull());
  expect(native.invoke).toHaveBeenLastCalledWith('open_external', { url: 'https://github.com/egdev6/official' });
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

it('uses semantic DS text for secondary, warning and muted app copy', async () => {
  await show();
  const status = card('Official').getByText('Estado de ejecución desconocido');
  expect(status.classList.contains('eg-text')).toBe(true);
  expect(status.classList.contains('text-fg-secondary')).toBe(true);
  fireEvent.click(toggle('Official'));
  const description = card('Official').getByText('Official app');
  expect(description.tagName).toBe('P');
  expect(description.classList.contains('eg-text')).toBe(true);
  expect(description.classList.contains('text-fg-secondary')).toBe(true);
  fireEvent.click(toggle('Local One'));
  const warning = card('Local One').getByText('Ejecutable ausente o inaccesible');
  expect(warning.classList.contains('eg-text')).toBe(true);
  expect(warning.classList.contains('text-status-warning')).toBe(true);
  expect((card('Local One').getByRole('button', { name: 'Abrir Local One' }) as HTMLButtonElement).disabled).toBe(true);
  const foot = screen.getByText('Las apps locales se cierran desde la propia app.');
  expect(foot.classList.contains('eg-text')).toBe(true);
  expect(foot.classList.contains('text-fg-muted')).toBe(true);
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
  const heading = screen.getByRole('heading', { name: 'Instaladas', level: 2 }).closest('header')!;
  expect(heading.classList.contains('eg-page-header')).toBe(true);
  expect(within(heading).getByRole('button', { name: 'Actualizar apps' })).toBeTruthy(); expect(heading.textContent).not.toMatch(/\d/);
  const localHeader = screen.getByRole('heading', { name: 'Apps locales', level: 2 }).closest('header')!;
  expect(localHeader.classList.contains('eg-page-header')).toBe(true);
  expect(within(localHeader).getByRole('button', { name: 'Actualizar apps locales' })).toBeTruthy();
  const connected = card('Plugin').getByText('Conectada');
  expect(connected.querySelector('.eg-status-dot[data-state="running"][aria-hidden="true"]')).toBeTruthy();
  fireEvent.click(within(heading).getByRole('button', { name: 'Actualizar apps' })); expect(refresh).toHaveBeenCalledOnce();
});

it.each([
  ['Conectadas', 'Plugin'],
  ['Instaladas', 'Official'],
  ['Apps locales', 'Local One'],
])('keeps the %s section header spaced from its app card', async (section, app) => {
  await show();
  const header = screen.getByRole('heading', { name: section, level: 2 }).closest('header')!;
  const wrapper = header.parentElement!;
  expect(wrapper.classList.contains('apps-section-header')).toBe(true);
  expect(wrapper.nextElementSibling).toBe(screen.getByText(app).closest('.app-card'));
  const rule = postcss.parse(css).nodes.find(node => node.type === 'rule' && node.selector === '.apps-section-header');
  const margin = rule?.type === 'rule' ? rule.nodes.find(node => node.type === 'decl' && node.prop === 'margin') : undefined;
  expect(margin?.type === 'decl' ? margin.value : undefined).toBe('var(--space-2) 0 var(--space-3)');
});

it.each([
  ['Official', 'Abrir Official', 'open_official_app', 'official', /Official app/],
  ['Plugin', 'Abrir Plugin', 'open_official_app', 'plugin', /Versión comunicada: 9\.0\.0/],
  ['Local One', 'Reparar Local One', 'local_app_repair', 'one', /Añadida manualmente/],
])('uses independent DS header actions and an accessible disclosure for %s', async (name, actionName, command, id, detail) => {
  await show();
  const trigger = screen.getByRole('button', { name: new RegExp(`^${name}`), expanded: false });
  const action = screen.getByRole('button', { name: actionName });
  expect(trigger.parentElement?.classList.contains('eg-collapsible__header')).toBe(true);
  expect(trigger.nextElementSibling?.contains(action)).toBe(true);
  expect(trigger.classList.contains('transition-none')).toBe(true);
  expect(trigger.contains(action)).toBe(false);
  fireEvent.click(action);
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith(command, { id }));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText(detail)).toBeNull();
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const contentId = trigger.getAttribute('aria-controls');
  expect(contentId).toBeTruthy();
  expect(document.getElementById(contentId!)?.contains(screen.getByText(detail))).toBe(true);
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText(detail)).toBeNull();
});

it('keeps reduced motion while removing the custom row positioning and disclosure animation', () => {
  expect(css).not.toMatch(/\.app-row:has\(\s*>\s*\.row-actions/);
  expect(css).not.toMatch(/--header-action-width|app-detail-(open|close)/);
  expect(css).not.toMatch(/\.app-row\s*>\s*\.eg-collapsible__trigger/);
  expect(css).not.toMatch(/\.app-card\s*>\s*\.eg-collapsible__content/);
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  expect(css).toMatch(/animation:\s*none\s*!important/);
});

it('wraps reported menu actions in a full-width growing DS cluster', async () => {
  await show();
  const labels = ['Abrir el panel', 'Abrir el prompter', 'Abrir el dock', 'Abrir en el navegador', 'Unaetiquetamuylargaparacomprobareldesbordamiento'];
  act(() => native.publish!({ revision: 2, apps: [{ app: { id: 'plugin', name: 'Plugin', version: '9.0.0' }, capabilities: ['show', 'menu'], unified: true, responsive: true, generation: 3, menu_revision: 4, menu: labels.map((label, index) => ({ id: `action-${index}`, label, enabled: true })) }] }));
  fireEvent.click(toggle('Plugin'));
  const buttons = labels.map(name => card('Plugin').getByRole('button', { name }));
  const list = buttons[0].closest('ul')!;
  for (const name of ['eg-cluster', 'flex', 'flex-wrap', 'gap-1']) expect(list.classList.contains(name)).toBe(true);
  expect(Array.from(list.children)).toHaveLength(labels.length);
  const reference = render(<Button type="button" size="sm" variant="neutral" labelWrap>reference</Button>).container.querySelector('button')!;
  for (const button of buttons) {
    expect(button.parentElement?.parentElement).toBe(list);
    expect(button.classList.contains('registry-menu__action')).toBe(true);
    for (const className of reference.classList) expect(button.classList.contains(className)).toBe(true);
  }
  const declarations = (selector: string) => {
    const rule = postcss.parse(css).nodes.find(node => node.type === 'rule' && node.selector === selector);
    return Object.fromEntries(rule?.type === 'rule' ? rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]) : []);
  };
  expect(declarations('.registry-menu > li')).toMatchObject({ flex: '1 1 auto', 'min-width': '0', 'max-width': '100%' });
  expect(declarations('.registry-menu__action').width).toBe('100%');
});

it('runs a reported menu item through the hub, keeps disabled items inert and reports failures', async () => {
  await show();
  act(() => native.publish!({ revision: 2, apps: [{ app: { id: 'plugin', name: 'Plugin', version: '9.0.0' }, capabilities: ['show', 'quit', 'menu'], unified: true, responsive: true, generation: 3, menu_revision: 4, menu: [
    { id: 'open-panel', label: 'Abrir el panel', enabled: true },
    { id: 'pause', label: 'Pausar', enabled: false, checked: true },
  ] }] }));
  fireEvent.click(toggle('Plugin'));
  fireEvent.click(card('Plugin').getByRole('button', { name: 'Abrir el panel' }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('activate_connected_menu_item', { id: 'plugin', generation: 3, menuRevision: 4, itemId: 'open-panel' }));
  const disabled = card('Plugin').getByRole('button', { name: /Pausar.*desactivada.*marcada/i });
  expect(disabled.hasAttribute('disabled')).toBe(true);
  fireEvent.click(disabled);
  expect(native.invoke.mock.calls.filter(([command]) => command === 'activate_connected_menu_item')).toHaveLength(1);
  native.invoke.mockRejectedValueOnce('La app ya no está disponible.');
  fireEvent.click(card('Plugin').getByRole('button', { name: 'Abrir el panel' }));
  expect(await screen.findByText('La app ya no está disponible.')).toBeTruthy();
});

it('rescans installed apps when a connected app leaves the hub, and again while it finishes exiting', async () => {
  const refresh = await show();
  refresh.mockClear();
  act(() => native.publish!({ revision: 2, apps: [{ app: { id: 'plugin', name: 'Plugin', version: '9.0.1' }, capabilities: ['show', 'quit'], unified: true, responsive: true, generation: 1, menu_revision: 0, menu: [] }] }));
  expect(refresh).not.toHaveBeenCalled();
  vi.useFakeTimers();
  try {
    act(() => native.publish!({ revision: 3, apps: [] }));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(refresh).toHaveBeenCalledTimes(3);
    act(() => { vi.advanceTimersByTime(60000); });
    expect(refresh).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
