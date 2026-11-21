import { describe, expect, it, vi } from 'vitest';
import v4 from '../../../../crates/nexo-catalog/fixtures/v4.json';
import parity from '../../../../crates/nexo-catalog/fixtures/parity-v4.json';
import { loadCatalog, type CatalogFetcher } from './loader';

const endpoint = 'https://catalog.example.com/catalog.json';
const valid = JSON.stringify(v4);
const empty = JSON.stringify({ schemaVersion: 4, apps: [] });
const platform = 'windows-x86_64';
function cache(initial: string | null = null) {
  let stored = initial;
  return {
    read: vi.fn(async () => stored),
    write: vi.fn(async (text: string) => {
      stored = text;
    }),
    value: () => stored,
  };
}
function fetchResponse(text: string, options: { ok?: boolean; url?: string; redirected?: boolean } = {}): CatalogFetcher {
  return vi.fn(async () => ({ ok: options.ok ?? true, url: options.url ?? endpoint, redirected: options.redirected ?? false, text: async () => text }));
}

describe('v4 catalog loader', () => {
  it('fetches once, caches raw v4 and returns the selected platform projection', async () => {
    const store = cache();
    const fetcher = fetchResponse(valid);
    const result = await loadCatalog(endpoint, store, fetcher, platform);
    expect(result).toEqual({ status: 'ready', catalog: parity.projections[platform] });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      expect.objectContaining({ redirect: 'error', cache: 'no-cache', signal: expect.any(AbortSignal) }),
    );
    expect(store.write).toHaveBeenCalledExactlyOnceWith(valid);
    expect(store.value()).toBe(valid);
    expect((await loadCatalog(endpoint, store, fetchResponse(empty), platform)).status).toBe('empty');
    expect(store.value()).toBe(empty);
  });
  it('projects the v4 cache when offline without changing it', async () => {
    const store = cache(valid);
    const offline: CatalogFetcher = async () => {
      throw new Error('offline');
    };
    expect(await loadCatalog(endpoint, store, offline, 'darwin-aarch64')).toEqual({
      status: 'offline',
      stale: true,
      catalog: parity.projections['darwin-aarch64'],
      reason: undefined,
    });
    expect(store.write).not.toHaveBeenCalled();
    expect(store.value()).toBe(valid);
  });
  it('returns an empty catalog for a null platform while caching the raw document', async () => {
    const store = cache();
    expect(await loadCatalog(endpoint, store, fetchResponse(valid), null)).toEqual({ status: 'empty', catalog: { schemaVersion: 4, apps: [] } });
    expect(store.value()).toBe(valid);
  });
  it('rejects old and invalid responses without replacing the valid v4 cache', async () => {
    const store = cache(valid);
    const invalid = structuredClone(v4);
    invalid.apps[0].platforms['darwin-aarch64']!.version = '1.2';
    for (const text of ['{', JSON.stringify(invalid), ...[1, 2, 3].map((schemaVersion) => JSON.stringify({ schemaVersion, apps: [] }))]) {
      const result = await loadCatalog(endpoint, store, fetchResponse(text), 'darwin-aarch64');
      expect(result).toEqual({ status: 'error', stale: true, reason: 'response', catalog: parity.projections['darwin-aarch64'] });
      expect(store.write).not.toHaveBeenCalled();
      expect(store.value()).toBe(valid);
    }
  });
  it('never treats corrupt or old caches as v4', async () => {
    const offline: CatalogFetcher = async () => {
      throw new Error('offline');
    };
    for (const text of ['{broken', ...[1, 2, 3].map((schemaVersion) => JSON.stringify({ schemaVersion, apps: [] }))]) {
      const store = cache(text);
      expect(await loadCatalog(endpoint, store, offline, platform)).toEqual({ status: 'offline', catalog: undefined, stale: false, reason: undefined });
      expect(store.write).not.toHaveBeenCalled();
      expect(store.value()).toBe(text);
    }
  });
  it('rejects non-HTTPS endpoints, HTTP errors and redirects without replacing the cache', async () => {
    const store = cache(valid);
    const fetcher = fetchResponse(empty);
    expect(await loadCatalog('http://example.com/catalog.json', store, fetcher, platform)).toMatchObject({
      status: 'error',
      reason: 'unconfigured',
      stale: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
    for (const options of [
      { ok: false },
      { redirected: true },
      { url: 'http://example.com/catalog.json' },
      { url: 'https://other.example.com/catalog.json' },
    ]) {
      expect(await loadCatalog(endpoint, store, fetchResponse(empty, options), platform)).toMatchObject({
        status: 'error',
        reason: 'response',
        stale: true,
        catalog: parity.projections[platform],
      });
      expect(store.write).not.toHaveBeenCalled();
      expect(store.value()).toBe(valid);
    }
  });
  it('recovers on retry and reports a cache write failure', async () => {
    const store = cache();
    const offline: CatalogFetcher = async () => {
      throw new Error('offline');
    };
    expect((await loadCatalog(undefined, store, fetchResponse(valid), platform)).status).toBe('error');
    expect((await loadCatalog(endpoint, store, offline, platform)).status).toBe('offline');
    expect((await loadCatalog(endpoint, store, fetchResponse(valid), platform)).status).toBe('ready');
    store.write.mockRejectedValueOnce(new Error('disk'));
    expect(await loadCatalog(endpoint, store, fetchResponse(empty), platform)).toEqual({
      status: 'error',
      reason: 'cache',
      catalog: { schemaVersion: 4, apps: [] },
    });
    expect(store.value()).toBe(valid);
  });
  it('does not let an older overlapping response overwrite the newer valid cache', async () => {
    const store = cache(valid);
    let resolveFirst!: (response: Awaited<ReturnType<CatalogFetcher>>) => void;
    const firstFetcher: CatalogFetcher = () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      });
    const first = loadCatalog(endpoint, store, firstFetcher, platform);
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'));
    expect((await loadCatalog(endpoint, store, fetchResponse(empty), platform)).status).toBe('empty');
    resolveFirst({ ok: true, url: endpoint, redirected: false, text: async () => valid });
    await first;
    expect(store.value()).toBe(empty);
  });
  it('serializes overlapping writes that have already started', async () => {
    let finishFirst!: () => void;
    let stored: string | null = null;
    let calls = 0;
    const store = {
      read: async () => stored,
      write: async (text: string) => {
        if (++calls === 1)
          await new Promise<void>((resolve) => {
            finishFirst = resolve;
          });
        stored = text;
      },
    };
    const first = loadCatalog(endpoint, store, fetchResponse(valid), platform);
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'));
    const second = loadCatalog(endpoint, store, fetchResponse(empty), platform);
    finishFirst();
    await Promise.all([first, second]);
    expect(stored).toBe(empty);
  });
  it('bounds a fetcher that never resolves and signals its abort', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher: CatalogFetcher = async (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      };
      const pending = loadCatalog(endpoint, cache(), fetcher, platform, 100);
      await vi.advanceTimersByTimeAsync(100);
      expect((await pending).status).toBe('offline');
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
