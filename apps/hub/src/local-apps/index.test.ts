import { beforeEach, expect, it, vi } from 'vitest';
import { addLocalApp, openLocalApp, removeLocalApp, repairLocalApp, updateLocalApp, type LocalAppErrorCode } from './index';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => { invoke.mockReset(); });

it('adds through the native picker without sending a path, preserving cancel and duplicate warning', async () => {
  invoke.mockResolvedValueOnce(null).mockResolvedValueOnce({ app: { id: 'manual', name: 'App', executable: 'C:\\App.exe', icon: null }, duplicate: true });
  expect(await addLocalApp()).toBeNull();
  expect(await addLocalApp()).toEqual({ app: { id: 'manual', name: 'App', executable: 'C:\\App.exe', icon: null }, duplicate: true });
  expect(invoke.mock.calls).toEqual([['local_app_add'], ['local_app_add']]);
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

it('opens by opaque key without a path or arguments and propagates native error codes', async () => {
  const code: LocalAppErrorCode = 'nexo.local.missing';
  invoke.mockRejectedValue(code);
  await expect(openLocalApp('manual')).rejects.toBe(code);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('local_app_open', { id: 'manual' });
});
