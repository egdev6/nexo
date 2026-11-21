// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../i18n/use-locale';
import { LocalManagement } from '../settings/local-management';
import { localAppIcon, type LocalAppRow } from './index';
import { LocalAppsView } from './view';
import { mockImageLoading } from '../test-helpers/image-loading';

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));

const png = 'data:image/png;base64,iVBORw0KGgo=';
const ico = 'data:image/x-icon;base64,AAABAA==';
const path = 'C:\\Nexo\\local-icons\\icon-old.png';
let row: LocalAppRow;
let iconResponse: string | null;
let cancel: boolean;
let failedSources: Set<string>;
let images: HTMLImageElement[];

beforeEach(() => {
  failedSources = new Set();
  images = mockImageLoading(failedSources);
  row = { id: 'local:manual:1', source: 'local', name: 'Editor', state: 'ready', origin: { kind: 'manual', id: 'manual-1' }, iconPath: path };
  iconResponse = png;
  cancel = false;
  bridge.invoke.mockReset();
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_settings') return { settings: { sources: [] } };
    if (command === 'local_apps_list') return [{ ...row }];
    if (command === 'local_app_icon') return iconResponse;
    if (command === 'local_app_pick_icon') {
      if (cancel) return null;
      iconResponse = ico;
      return { app: { id: 'manual-1', name: 'Editor', executable: 'C:\\Editor.exe', icon: 'icon-new.ico' }, duplicate: false };
    }
    return null;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type View = 'apps' | 'settings';
function mount(view: View) {
  return render(<LocaleProvider locale="en">{view === 'apps' ? <LocalAppsView names={[]} /> : <LocalManagement />}</LocaleProvider>);
}
function entry(name: string, view: View): HTMLElement {
  const element = screen.getByText(name).closest(view === 'apps' ? '.app-card' : '.settings__local-entry');
  if (!(element instanceof HTMLElement)) throw new Error('Missing local row');
  return element;
}
function avatar(name: string, view: View): HTMLElement {
  const element = entry(name, view).querySelector('.eg-app-icon');
  if (!(element instanceof HTMLElement)) throw new Error('Missing local avatar');
  return element;
}
async function loaded(view: View) {
  await screen.findByText('Editor');
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('local_app_icon', { id: 'manual-1' }));
  await act(async () => {});
  return entry('Editor', view);
}

it('requests native icon data using only the opaque app ID', async () => {
  expect(await localAppIcon('manual-1')).toBe(png);
  expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('local_app_icon', { id: 'manual-1' });
  iconResponse = null;
  expect(await localAppIcon('manual-1')).toBeNull();
});

it.each(['apps', 'settings'] as const)('%s renders PNG and ICO local icons as decorative images', async (view) => {
  mount(view);
  const editor = await loaded(view);
  expect(avatar('Editor', view).getAttribute('aria-hidden')).toBe('true');
  await waitFor(() => expect(editor.querySelector('img')?.getAttribute('src')).toBe(png));
  expect(editor.querySelector('img')?.getAttribute('alt')).toBe('');
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'local_app_icon')).toEqual([['local_app_icon', { id: 'manual-1' }]]);
  cleanup();
  iconResponse = ico;
  mount(view);
  const editorAgain = await loaded(view);
  await waitFor(() => expect(editorAgain.querySelector('img')?.getAttribute('src')).toBe(ico));
  expect(editorAgain.querySelector('img')?.getAttribute('alt')).toBe('');
});

it.each(['apps', 'settings'] as const)('%s falls back to the letter when native data is null', async (view) => {
  iconResponse = null;
  mount(view);
  const editor = await loaded(view);
  expect(editor.querySelector('img')).toBeNull();
  expect(avatar('Editor', view).textContent).toBe('E');
});

it.each(['apps', 'settings'] as const)('%s rejects remote URLs and other data MIME types without inserting an image', async (view) => {
  for (const unsafe of ['https://example.test/icon.png', 'file:///C:/icon.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png-not-real;base64,AAAA']) {
    iconResponse = unsafe;
    mount(view);
    const editor = await loaded(view);
    expect(editor.querySelector('img')).toBeNull();
    expect(avatar('Editor', view).textContent).toBe('E');
    cleanup();
    bridge.invoke.mockClear();
  }
});

it.each(['apps', 'settings'] as const)('%s falls back to the letter if native icon loading fails', async (view) => {
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'local_app_icon') throw new Error('unavailable');
    return invoke(command);
  });
  mount(view);
  const editor = await loaded(view);
  expect(editor.querySelector('img')).toBeNull();
  expect(avatar('Editor', view).textContent).toBe('E');
});

it.each(['apps', 'settings'] as const)('%s falls back to the uppercase letter when the image fails to load', async (view) => {
  failedSources.add(png);
  row.name = 'editor';
  mount(view);
  await screen.findByText('editor');
  await waitFor(() => expect(images.some((image) => image.getAttribute('src') === png)).toBe(true));
  expect(avatar('editor', view).textContent).toBe('E');
  expect(entry('editor', view).querySelector('img')).toBeNull();
});

it('refetches after a successful icon picker even when the list path is unchanged, and shows it on reopening Mis apps', async () => {
  const settings = mount('settings');
  const editor = await loaded('settings');
  await waitFor(() => expect(editor.querySelector('img')?.getAttribute('src')).toBe(png));
  fireEvent.click(screen.getByRole('button', { name: 'Change icon of Editor' }));
  await waitFor(() => expect(editor.querySelector('img')?.getAttribute('src')).toBe(ico));
  expect(bridge.invoke).toHaveBeenCalledWith('local_app_pick_icon', { id: 'manual-1' });
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'local_app_icon')).toEqual([
    ['local_app_icon', { id: 'manual-1' }],
    ['local_app_icon', { id: 'manual-1' }],
  ]);
  settings.unmount();
  mount('apps');
  const appsEditor = await loaded('apps');
  await waitFor(() => expect(appsEditor.querySelector('img')?.getAttribute('src')).toBe(ico));
});

it('keeps the current icon and does not refetch when the picker is cancelled', async () => {
  cancel = true;
  mount('settings');
  const editor = await loaded('settings');
  await waitFor(() => expect(editor.querySelector('img')?.getAttribute('src')).toBe(png));
  fireEvent.click(screen.getByRole('button', { name: 'Change icon of Editor' }));
  await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('local_app_pick_icon', { id: 'manual-1' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Change icon of Editor' }) as HTMLButtonElement).disabled).toBe(false));
  expect(editor.querySelector('img')?.getAttribute('src')).toBe(png);
  expect(bridge.invoke.mock.calls.filter(([command]) => command === 'local_app_icon')).toHaveLength(1);
});

it('ignores an older icon response that completes after a replacement', async () => {
  let resolveOld!: (value: string) => void;
  let reads = 0;
  const invoke = bridge.invoke.getMockImplementation()!;
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'local_app_icon' && ++reads === 1)
      return new Promise<string>((resolve) => {
        resolveOld = resolve;
      });
    return invoke(command);
  });
  mount('settings');
  const editor = await loaded('settings');
  expect(editor.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Change icon of Editor' }));
  await waitFor(() => expect(editor.querySelector('img')?.getAttribute('src')).toBe(ico));
  await act(async () => resolveOld(png));
  expect(editor.querySelector('img')?.getAttribute('src')).toBe(ico);
});
