// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import type { HubApp } from '../model';
import { defaultSettings } from '../sample';
import { projectCatalog } from '../catalog/mapping';

configure({ getElementError: message => new Error(message?.split('\n')[0] ?? 'Element not found') });
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), publish: undefined as undefined | ((snapshot: unknown) => void) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn(async (publish: (snapshot: unknown) => void) => {
  bridge.publish = publish;
  publish({ revision: 1, apps: [{ app: { id: 'external', name: 'Externa', version: '1.0.0' }, capabilities: ['menu'], menu: [{ id: 'pause', label: 'Pausar original', enabled: false, checked: true }], unified: true, responsive: true, generation: 1, menu_revision: 1 }] });
  return () => {};
}), exitHubOnly: vi.fn() }));

const external: HubApp = { id: 'outside', name: 'Exterior', description: 'Descripción original', tagline: 'Texto original', tags: ['Etiqueta original'], source: 'official', integration: 'catalog', installed: false, running: false, statusKnown: false };
let saved: typeof defaultSettings & { firstRunComplete: boolean; sources: { id: string; kind: string; label: string }[] };
let failSave: boolean;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  saved = { ...defaultSettings, firstRunComplete: false, showNewsOnOpen: false, sources: [{ id: 'official', kind: 'official', label: 'Catálogo oficial egdev' }, { id: 'local', kind: 'local', label: 'Mi fuente' }] };
  failSave = false;
  bridge.publish = undefined;
  document.documentElement.lang = 'es';
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'get_settings') return { settings: { ...saved }, state: 'ready' };
    if (command === 'save_settings') { if (failSave) throw new Error('disk full'); saved = { ...saved, ...args?.patch }; return { ...saved }; }
    if (command === 'plugin:autostart|is_enabled' || command === 'backdrop_available') return false;
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  ['nexo.config.save.future', 'Settings from a newer version are read-only.'],
  ['nexo.config.save.corrupt', 'The settings file is corrupt.'],
  ['nexo.config.save.unreadable', 'The settings file cannot be read.'],
])('localizes a rejected native save (%s) without losing pending settings', async (code, detail) => {
  saved = { ...saved, language: 'en', firstRunComplete: true };
  let rejected = true;
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'save_settings' && rejected) throw code;
    return normal(command, args);
  });
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Show news on opening' }));
  expect((await screen.findByRole('alert')).textContent).toBe(`Could not save settings: ${detail} Retry`);
  expect(saved).toMatchObject({ language: 'en', firstRunComplete: true, showNewsOnOpen: false });
  rejected = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(saved.showNewsOnOpen).toBe(true));
});

it.each(['constructor', 'toString', '__proto__'])('keeps the external diagnostic %s verbatim', async diagnostic => {
  saved = { ...saved, language: 'en', firstRunComplete: true };
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'save_settings') throw new Error(diagnostic);
    return normal(command, args);
  });
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Show news on opening' }));
  expect((await screen.findByRole('alert')).textContent).toBe(`Could not save settings: ${diagnostic} Retry`);
  expect(saved.showNewsOnOpen).toBe(false);
});

it('localizes a rejected native save in Spanish as well', async () => {
  saved = { ...saved, firstRunComplete: true };
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'save_settings') throw 'nexo.config.save.future';
    return normal(command, args);
  });
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Mostrar novedades al abrir' }));
  expect((await screen.findByRole('alert')).textContent).toBe('No se pudieron guardar los ajustes: Los ajustes pertenecen a una versión más reciente y son de solo lectura. Reintentar');
  expect(saved.showNewsOnOpen).toBe(false);
});

it('localizes a rejected native recovery in the active language', async () => {
  saved = { ...saved, language: 'en', firstRunComplete: true };
  const before = structuredClone(saved);
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'get_settings') return { settings: { ...saved }, state: 'corrupt' };
    if (command === 'recover_settings') throw 'nexo.config.recoveryNotAllowed';
    return normal(command, args);
  });
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Recover settings with a backup' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not recover settings: This settings file cannot be recovered. Retry'));
  expect(saved).toEqual(before);
  expect(bridge.invoke).toHaveBeenCalledWith('recover_settings');
});

it('hydrates a saved English preference before showing English chrome, without translating app data', async () => {
  saved = { ...saved, language: 'en', firstRunComplete: true };
  render(<App apps={[external]} news={[]} />);
  expect(await screen.findByRole('tab', { name: 'My apps' })).toBeTruthy();
  expect(document.documentElement.lang).toBe('en');
  expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('title')).toBe('Settings');
  expect(screen.getByRole('button', { name: 'Close panel' }).getAttribute('title')).toBe('Close panel');
  expect(screen.getByText(/Pausar original/).textContent).toContain('Pausar original');
  const catalog = screen.getByRole('tab', { name: 'Catalog' });
  fireEvent.mouseDown(catalog, { button: 0 }); fireEvent.click(catalog);
  const card = screen.getByRole('article', { name: 'Exterior' });
  expect(within(card).getByText('Texto original')).toBeTruthy();
  expect(within(card).getByText('Etiqueta original')).toBeTruthy();
});

it('only exposes the list after saving the English first-run choice and restores it on restart', async () => {
  const { unmount } = render(<App apps={[]} news={[]} />);
  expect((await screen.findByRole('radio', { name: 'Español' })).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect(screen.queryByRole('tab', { name: 'My apps' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('tab', { name: 'My apps' })).toBeTruthy();
  expect(saved).toMatchObject({ language: 'en', firstRunComplete: true, sources: [{ id: 'official' }, { id: 'local' }] });
  expect(bridge.invoke).toHaveBeenCalledWith('save_settings', { patch: { language: 'en', firstRunComplete: true } });
  unmount(); render(<App apps={[]} news={[]} />);
  expect(await screen.findByRole('tab', { name: 'My apps' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
});

it('keeps first-run choice local on failure, explains and retries in the selected language', async () => {
  failSave = true;
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'English' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not save settings: disk full');
  expect(screen.queryByRole('tab', { name: 'My apps' })).toBeNull();
  expect(saved).toMatchObject({ language: 'es', firstRunComplete: false });
  expect(document.documentElement.lang).toBe('es');
  failSave = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('tab', { name: 'My apps' })).toBeTruthy();
});

it('retries the currently selected first-run language after the user changes the failed choice', async () => {
  failSave = true;
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'English' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect((await screen.findByRole('alert')).textContent).toContain('disk full');
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  expect(saved).toMatchObject({ language: 'es', firstRunComplete: false });
  failSave = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('tab', { name: 'Mis apps' })).toBeTruthy();
  expect(saved).toMatchObject({ language: 'es', firstRunComplete: true });
});

it('does not flush a failed onboarding choice after the preview changes and the window blurs', async () => {
  failSave = true;
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('radio', { name: 'English' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect((await screen.findByRole('alert')).textContent).toContain('disk full');
  expect(saved).toMatchObject({ language: 'es', firstRunComplete: false });
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  const savesBefore = bridge.invoke.mock.calls.filter(([name]) => name === 'save_settings').length;
  failSave = false;
  await act(async () => { fireEvent.blur(window); await Promise.resolve(); });
  expect(bridge.invoke.mock.calls.filter(([name]) => name === 'save_settings')).toHaveLength(savesBefore);
  expect(saved).toMatchObject({ language: 'es', firstRunComplete: false, sources: [{ id: 'official' }, { id: 'local' }] });
  expect(screen.queryByRole('tab', { name: 'My apps' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(await screen.findByRole('tab', { name: 'Mis apps' })).toBeTruthy();
  expect(saved).toMatchObject({ language: 'es', firstRunComplete: true });
});

it('applies a confirmed language to the native tray, reports refresh failure separately and retries it', async () => {
  saved = { ...saved, firstRunComplete: true };
  let failTray = true;
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'apply_saved_language') { expect(saved.language).toBe('en'); if (failTray) throw new Error('tray failed'); return; }
    return normal(command, args);
  });
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Language saved, but the tray could not be updated: tray failed');
  expect(saved.language).toBe('en');
  expect(document.documentElement.lang).toBe('en');
  const savesBefore = bridge.invoke.mock.calls.filter(([name]) => name === 'save_settings').length;
  failTray = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry tray update' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(bridge.invoke.mock.calls.filter(([name]) => name === 'apply_saved_language')).toHaveLength(2);
  expect(bridge.invoke.mock.calls.filter(([name]) => name === 'save_settings')).toHaveLength(savesBefore);
});

it('never refreshes the native tray for an unsuccessful save', async () => {
  saved = { ...saved, firstRunComplete: true };
  failSave = true;
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect((await screen.findByRole('alert')).textContent).toContain('disk full');
  expect(saved.language).toBe('es');
  expect(bridge.invoke).not.toHaveBeenCalledWith('apply_saved_language');
  failSave = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('apply_saved_language'));
});

it('re-renders an already-visible native quit notice while keeping app refusal text verbatim', async () => {
  saved = { ...saved, firstRunComplete: true };
  render(<App apps={[]} news={[]} />);
  await waitFor(() => expect(bridge.publish).toBeTypeOf('function'));
  act(() => bridge.publish!({ revision: 2, apps: [], notice: {
    message: 'Nexo sigue abierto. Antena: cambios sin guardar; Beta: No respondió en 10 segundos', hub_only_allowed: true,
    detail: { kind: 'quit', all: true, failures: [{ app: 'Antena', outcome: { kind: 'refused', reason: 'cambios sin guardar' } }, { app: 'Beta', outcome: { kind: 'timeout' } }] },
  } }));
  expect((await screen.findByRole('alert')).textContent).toContain('Antena: cambios sin guardar');
  expect(screen.getByRole('button', { name: 'Salir solo de Nexo' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nexo remains open. Antena: cambios sin guardar; Beta: No response within 10 seconds'));
  expect(screen.getByRole('button', { name: 'Exit Nexo only' })).toBeTruthy();
});

it('localizes catalog-generated news chrome but keeps source content unchanged', async () => {
  saved = { ...saved, language: 'en', firstRunComplete: true, showNewsOnOpen: true };
  const catalog = { schemaVersion: 1 as const, apps: [{ id: 'outside', name: 'Exterior', tagline: 'Texto original', description: 'Descripción original', tags: [], installerUrl: 'https://example.com/app.exe', latestJsonUrl: 'https://example.com/latest.json', integrationLevel: 'launch' as const, releasedAt: '2025-01-01T00:00:00Z', featured: false, news: [{ id: 'news', kind: 'new' as const, title: 'Título original', text: 'Noticia original', publishedAt: '2025-01-01T00:00:00Z' }] }] };
  const projection = projectCatalog(catalog);
  const normal = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'get_flyout_state') return { visible: true, sequence: 1, cycle: 1, at: '2026-05-31T12:00:00Z' };
    return normal(command, args);
  });
  render(<App apps={projection.apps} news={projection.news} />);
  const dialog = await screen.findByRole('dialog', { name: 'News on opening' });
  expect(within(dialog).getByText('New')).toBeTruthy();
  expect(within(dialog).getByText('Título original')).toBeTruthy();
  expect(within(dialog).getByText('Noticia original')).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: 'View in catalog: Título original' })).toBeTruthy();
});

it('serializes rapid opposing language choices and an unrelated change without flashing an older locale', async () => {
  saved = { ...saved, firstRunComplete: true };
  const normal = bridge.invoke.getMockImplementation()!;
  let release!: () => void;
  let firstSave = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'save_settings' && firstSave) { firstSave = false; await gate; }
    return normal(command, args);
  });
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(firstSave).toBe(false));
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Mostrar novedades al abrir' }));
  release();
  await waitFor(() => expect(saved).toMatchObject({ language: 'es', showNewsOnOpen: true }));
  // A registry update could have presented the intermediate English save.
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('apply_saved_language'));
  expect(document.documentElement.lang).toBe('es');
  expect(screen.getByRole('radio', { name: 'Español' }).getAttribute('aria-checked')).toBe('true');
});

it('ignores an older native refresh failure after a newer language is saved and applied', async () => {
  saved = { ...saved, firstRunComplete: true };
  const normal = bridge.invoke.getMockImplementation()!;
  let rejectOld!: (error: Error) => void;
  let calls = 0;
  const old = new Promise<void>((_, reject) => { rejectOld = reject; });
  bridge.invoke.mockImplementation(async (command: string, args?: { patch?: Partial<typeof saved> }) => {
    if (command === 'apply_saved_language') { calls++; if (calls === 1) await old; return; }
    return normal(command, args);
  });
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  await waitFor(() => expect(calls).toBe(1));
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  await waitFor(() => expect(calls).toBe(2));
  expect(saved.language).toBe('es');
  await act(async () => { rejectOld(new Error('older refresh failed')); await Promise.resolve(); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.documentElement.lang).toBe('es');
});

it('does not switch the global language on an unsuccessful settings save, and retries the pending choice', async () => {
  saved = { ...saved, firstRunComplete: true };
  failSave = true;
  render(<App apps={[]} news={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect((await screen.findByRole('alert')).textContent).toContain('disk full');
  expect(screen.getByRole('radio', { name: 'Español' }).getAttribute('aria-checked')).toBe('true');
  expect(document.documentElement.lang).toBe('es');
  expect(saved.language).toBe('es');
  failSave = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await waitFor(() => expect(saved.language).toBe('en'));
  expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy();
  expect(document.documentElement.lang).toBe('en');
});
