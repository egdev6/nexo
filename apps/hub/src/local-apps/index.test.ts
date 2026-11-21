import { beforeEach, expect, it, vi } from 'vitest';
import {
  cancelLocalSelection,
  createLocalApp,
  listLocalApps,
  openLocalApp,
  pickLocalExecutable,
  pickLocalIconFile,
  pickLocalAppIcon,
  removeLocalApp,
  repairLocalApp,
  updateLocalApp,
  type LocalAppErrorCode,
  type LocalAppRow,
} from './index';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => {
  invoke.mockReset();
});

it('lists local rows without sending paths and rejects a malformed native response', async () => {
  const rows = [
    {
      id: 'local:manual:31',
      source: 'local',
      name: 'App',
      state: 'ready',
      origin: { kind: 'manual', id: '1' },
      iconPath: 'C:\\Nexo\\icon-1.png',
      duplicateOf: 'official-app',
    },
    { id: 'local:manual:32', source: 'local', name: 'Missing', state: 'missingExecutable', origin: { kind: 'manual', id: '2' } },
  ] satisfies LocalAppRow[];
  invoke.mockResolvedValueOnce(rows).mockResolvedValueOnce({});
  expect(await listLocalApps()).toEqual(rows);
  await expect(listLocalApps()).rejects.toThrow('nexo.local.invalidList');
  expect(invoke.mock.calls).toEqual([['local_apps_list'], ['local_apps_list']]);
});

it('selects and creates using native tokens, never a renderer path', async () => {
  const exe = { token: 'exe', path: 'C:\\App.exe', suggestedName: 'App' };
  const icon = { token: 'icon', preview: 'data:image/png;base64,AAAA' };
  const result = { app: { id: 'manual', name: 'App', executable: exe.path, icon: 'icon-1.png' }, duplicate: true };
  invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(exe).mockResolvedValueOnce(icon).mockResolvedValueOnce(result).mockResolvedValueOnce(undefined);
  expect(await pickLocalExecutable()).toBeNull();
  expect(await pickLocalExecutable()).toEqual(exe);
  expect(await pickLocalIconFile()).toEqual(icon);
  expect(await createLocalApp(exe.token, 'App', icon.token)).toEqual(result);
  await cancelLocalSelection();
  expect(invoke.mock.calls).toEqual([
    ['local_app_pick_executable'],
    ['local_app_pick_executable'],
    ['local_app_pick_icon_file'],
    ['local_app_create', { token: 'exe', name: 'App', iconToken: 'icon' }],
    ['local_app_cancel_selection'],
  ]);
});

it('renames only an opaque key and name', async () => {
  const selection = { app: { id: 'manual', name: 'Work', executable: 'C:\\App.exe', icon: null }, duplicate: false };
  invoke.mockResolvedValue(selection);
  expect(await updateLocalApp('manual', 'Work')).toEqual(selection);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('local_app_update', { id: 'manual', name: 'Work' });
});

it('removes only an opaque key', async () => {
  invoke.mockResolvedValue(undefined);
  await expect(removeLocalApp('manual')).resolves.toBeUndefined();
  expect(invoke).toHaveBeenCalledExactlyOnceWith('local_app_remove', { id: 'manual' });
});

it('repairs through the native picker using only an opaque key', async () => {
  invoke.mockResolvedValue(null);
  await expect(repairLocalApp('manual')).resolves.toBeNull();
  expect(invoke).toHaveBeenCalledExactlyOnceWith('local_app_repair', { id: 'manual' });
});

it('selects an icon through the native picker by opaque key, preserving cancel and errors', async () => {
  const selection = { app: { id: 'manual', name: 'App', executable: 'C:\\App.exe', icon: 'icon-1.png' }, duplicate: false };
  invoke.mockResolvedValueOnce(selection).mockResolvedValueOnce(null).mockRejectedValueOnce('nexo.local.invalidIcon');
  expect(await pickLocalAppIcon('manual')).toEqual(selection);
  expect(await pickLocalAppIcon('manual')).toBeNull();
  await expect(pickLocalAppIcon('manual')).rejects.toBe('nexo.local.invalidIcon');
  expect(invoke.mock.calls).toEqual([
    ['local_app_pick_icon', { id: 'manual' }],
    ['local_app_pick_icon', { id: 'manual' }],
    ['local_app_pick_icon', { id: 'manual' }],
  ]);
});

it('opens by opaque key without a path or arguments and propagates native error codes', async () => {
  const code: LocalAppErrorCode = 'nexo.local.missing';
  invoke.mockRejectedValue(code);
  await expect(openLocalApp('manual')).rejects.toBe(code);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('local_app_open', { id: 'manual' });
});
