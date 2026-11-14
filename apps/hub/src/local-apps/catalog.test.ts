import { beforeEach, expect, it, vi } from 'vitest';
import { bindLocalCatalogEntry, clearLocalCatalog, openLocalCatalogEntry, refreshLocalCatalog, setLocalCatalog, unbindLocalCatalogEntry, type LocalCatalogErrorCode, type LocalCatalogSnapshot } from './index';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => { invoke.mockReset(); });

const key = { sourceId: 'work', appId: 'example-app' };
const snapshot: LocalCatalogSnapshot = { sourceId: 'work', entries: [{ key, source: 'local', name: 'App', tagline: 'Tag', description: 'Description', tags: [] }] };

it('selects or replaces a catalog by source ID without sending paths and preserves cancellation', async () => {
  invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(snapshot);
  expect(await setLocalCatalog()).toBeNull();
  expect(await setLocalCatalog('work')).toEqual(snapshot);
  expect(invoke.mock.calls).toEqual([['local_catalog_set', { sourceId: null }], ['local_catalog_set', { sourceId: 'work' }]]);
});

it('refreshes a source by ID and preserves native validation failures', async () => {
  const code: LocalCatalogErrorCode = 'nexo.local.catalogInvalid';
  invoke.mockResolvedValueOnce(snapshot).mockRejectedValueOnce(code);
  expect(await refreshLocalCatalog('work')).toEqual(snapshot);
  await expect(refreshLocalCatalog('work')).rejects.toBe(code);
  expect(invoke.mock.calls).toEqual([['local_catalog_refresh', { sourceId: 'work' }], ['local_catalog_refresh', { sourceId: 'work' }]]);
});

it('clears only the selected source', async () => {
  invoke.mockResolvedValue(undefined);
  await expect(clearLocalCatalog('work')).resolves.toBeUndefined();
  expect(invoke).toHaveBeenCalledExactlyOnceWith('local_catalog_clear', { sourceId: 'work' });
});

it('binds through the native picker and unbinds with a source-scoped key', async () => {
  invoke.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...key, executable: 'C:\\App.exe' }).mockResolvedValueOnce(undefined);
  expect(await bindLocalCatalogEntry(key)).toBeNull();
  expect(await bindLocalCatalogEntry(key)).toEqual({ ...key, executable: 'C:\\App.exe' });
  await expect(unbindLocalCatalogEntry(key)).resolves.toBeUndefined();
  expect(invoke.mock.calls).toEqual([['local_catalog_bind', { key }], ['local_catalog_bind', { key }], ['local_catalog_unbind', { key }]]);
});

it('opens a bound entry by key only and propagates the distinct unbound error', async () => {
  invoke.mockRejectedValue('nexo.local.unbound');
  await expect(openLocalCatalogEntry(key)).rejects.toBe('nexo.local.unbound');
  expect(invoke).toHaveBeenCalledExactlyOnceWith('local_catalog_open', { key });
});
