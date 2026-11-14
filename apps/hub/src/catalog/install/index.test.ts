import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelInstall, installApp, onInstallProgress } from './index';

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));

beforeEach(() => { native.invoke.mockReset(); native.listen.mockReset(); });

describe('install client', () => {
  it('passes only the official id and preserves native install outcomes and errors', async () => {
    for (const result of [{ status: 'installed', version: '1.2.3' }, { status: 'installerFailed', code: 42 }, { status: 'cleanupFailed' }]) {
      native.invoke.mockResolvedValueOnce(result);
      await expect(installApp('minimal')).resolves.toEqual(result);
    }
    expect(native.invoke).toHaveBeenCalledTimes(3);
    expect(native.invoke).toHaveBeenCalledWith('install_app', { id: 'minimal' });
    native.invoke.mockRejectedValueOnce('native error');
    await expect(installApp('minimal')).rejects.toBe('native error');
  });
  it('passes cancellation through without confusing the native outcomes', async () => {
    for (const result of ['cancelled', 'tooLate', 'notRunning', 'cleanupFailed']) {
      native.invoke.mockResolvedValueOnce(result);
      await expect(cancelInstall('minimal')).resolves.toBe(result);
    }
    expect(native.invoke).toHaveBeenCalledTimes(4);
    expect(native.invoke).toHaveBeenCalledWith('cancel_install', { id: 'minimal' });
    native.invoke.mockRejectedValueOnce('native error');
    await expect(cancelInstall('minimal')).rejects.toBe('native error');
  });
  it('unwraps typed progress payloads and returns the native unsubscribe function', async () => {
    const unlisten = vi.fn();
    native.listen.mockResolvedValueOnce(unlisten);
    const callback = vi.fn();
    expect(await onInstallProgress(callback)).toBe(unlisten);
    expect(native.listen).toHaveBeenCalledTimes(1);
    expect(native.listen.mock.calls[0][0]).toBe('install-progress');
    const receive = native.listen.mock.calls[0][1];
    const payload = { id: 'minimal', phase: 'downloading', received: 17, total: 100 };
    receive({ event: 'install-progress', payload });
    expect(callback).toHaveBeenCalledExactlyOnceWith(payload);
    unlisten();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
