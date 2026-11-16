import { describe, expect, it, vi } from 'vitest';
import full from '../../../../crates/nexo-catalog/fixtures/full.json';
import { loadCatalog, loadVersionedCatalog, type CatalogFetcher } from './loader';

const endpoint = 'https://catalog.example.com/catalog.json';
const valid = JSON.stringify(full);
const empty = JSON.stringify({ schemaVersion: 1, apps: [] });
function cache(initial: string | null = null) {
  let stored = initial;
  return { read: vi.fn(async () => stored), write: vi.fn(async (text: string) => { stored = text; }), value: () => stored };
}
function fetchResponse(text: string, options: { ok?: boolean; url?: string; redirected?: boolean } = {}): CatalogFetcher {
  return vi.fn(async () => ({ ok: options.ok ?? true, url: options.url ?? endpoint, redirected: options.redirected ?? false, text: async () => text }));
}

describe('catalog loader', () => {
  it('fetches HTTPS, validates before caching and distinguishes ready from empty', async () => {
    const store = cache(); const fetcher = fetchResponse(valid);
    expect((await loadCatalog(endpoint, store, fetcher)).status).toBe('ready');
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ redirect: 'error', cache: 'no-cache', signal: expect.any(AbortSignal) }));
    expect(store.value()).toBe(valid);
    expect((await loadCatalog(endpoint, store, fetchResponse(empty))).status).toBe('empty');
    expect(store.value()).toBe(empty);
  });
  it('rejects non-HTTPS endpoints and redirects without replacing the cache', async () => {
    const store = cache(valid); const fetcher = fetchResponse(empty);
    expect((await loadCatalog('http://example.com/catalog.json', store, fetcher)).status).toBe('error');
    expect(fetcher).not.toHaveBeenCalled();
    for (const options of [{ redirected: true }, { url: 'http://example.com/catalog.json' }, { url: 'https://other.example.com/catalog.json' }]) {
      const result = await loadCatalog(endpoint, store, fetchResponse(empty, options));
      expect(result.status).toBe('error'); expect(result.catalog?.apps).toHaveLength(1); expect(store.value()).toBe(valid);
    }
  });
  it('distinguishes offline from HTTP, malformed and invalid responses, preserving only a valid cache', async () => {
    const store = cache(valid); const offline: CatalogFetcher = async () => { throw new Error('offline'); };
    expect((await loadCatalog(endpoint, store, offline)).status).toBe('offline');
    for (const fetcher of [fetchResponse('', { ok: false }), fetchResponse('{'), fetchResponse('{"schemaVersion":3,"apps":[]}')]) {
      const result = await loadCatalog(endpoint, store, fetcher);
      expect(result.status).toBe('error'); expect(result.catalog?.apps).toHaveLength(1); expect(store.value()).toBe(valid);
    }
    const corrupt = cache('{broken');
    const failed = await loadCatalog(endpoint, corrupt, offline);
    expect(failed.status).toBe('offline'); expect(failed.catalog).toBeUndefined(); expect(corrupt.value()).toBe('{broken');
  });
  it('recovers on retry and does not confuse a missing official endpoint with sample data', async () => {
    const store = cache();
    expect((await loadCatalog(undefined, store, fetchResponse(valid))).status).toBe('error');
    const offline: CatalogFetcher = async () => { throw new Error('offline'); };
    expect((await loadCatalog(endpoint, store, offline)).status).toBe('offline');
    expect((await loadCatalog(endpoint, store, fetchResponse(valid))).status).toBe('ready');
    expect(store.value()).toBe(valid);
  });
  it('never replaces the v1 cache with a v2 feed', async () => {
    const store = cache(valid);
    const result = await loadCatalog(endpoint, store, fetchResponse('{"schemaVersion":2,"apps":[]}'));
    expect(result.status).toBe('error');
    expect(result.stale).toBe(true);
    expect(result.catalog?.schemaVersion).toBe(1);
    expect(store.value()).toBe(valid);
  });
  it('does not treat a misplaced v1 cache as a v2 cache', async () => {
    const loadVersion = loadCatalog as typeof loadCatalog & ((endpoint: string, store: ReturnType<typeof cache>, fetcher: CatalogFetcher, timeout: number, version: 1 | 2) => ReturnType<typeof loadCatalog>);
    const offline: CatalogFetcher = async () => { throw new Error('offline'); };
    const result = await loadVersion(endpoint, cache(valid), offline, 100, 2);
    expect(result.status).toBe('offline');
    expect(result.catalog).toBeUndefined();
    expect(result.stale).toBe(false);
  });
  it('prefers the v2 feed without changing or fetching the v1 feed', async () => {
    const v2 = '{"schemaVersion":2,"apps":[]}';
    const v2Store = cache(); const v1Store = cache(valid);
    const fetcher = fetchResponse(v2);
    const result = await loadVersionedCatalog(endpoint, 'https://v1.example.com/catalog.json', v2Store, v1Store, fetcher);
    expect(result.status).toBe('empty');
    expect(result.catalog?.schemaVersion).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(v2Store.value()).toBe(v2);
    expect(v1Store.value()).toBe(valid);
  });
  it('falls back to v1 when v2 has no valid cache and preserves both caches on an invalid response', async () => {
    const v2Store = cache(); const v1Store = cache(valid);
    const fetcher: CatalogFetcher = async url => ({ ok: true, url, redirected: false, text: async () => url === endpoint ? '{broken' : valid });
    const result = await loadVersionedCatalog(endpoint, 'https://v1.example.com/catalog.json', v2Store, v1Store, fetcher);
    expect(result.status).toBe('ready');
    expect(result.catalog?.schemaVersion).toBe(1);
    expect(v2Store.value()).toBeNull();
    expect(v1Store.value()).toBe(valid);
  });
  it('marks a valid v2 cache stale on a failed v2 response', async () => {
    const v2 = '{"schemaVersion":2,"apps":[]}';
    const v2Store = cache(v2); const v1Store = cache(valid);
    const offline: CatalogFetcher = async () => { throw new Error('offline'); };
    const result = await loadVersionedCatalog(endpoint, 'https://v1.example.com/catalog.json', v2Store, v1Store, offline);
    expect(result.status).toBe('offline'); expect(result.stale).toBe(true);
    expect(result.catalog?.schemaVersion).toBe(2); expect(v2Store.value()).toBe(v2); expect(v1Store.value()).toBe(valid);
  });
  it('does not let an older overlapping response overwrite the newer valid cache', async () => {
    const store = cache(valid);
    let resolveFirst!: (response: Awaited<ReturnType<CatalogFetcher>>) => void;
    const firstFetcher: CatalogFetcher = () => new Promise(resolve => { resolveFirst = resolve; });
    const first = loadCatalog(endpoint, store, firstFetcher);
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'));
    expect((await loadCatalog(endpoint, store, fetchResponse(empty))).status).toBe('empty');
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
        if (++calls === 1) await new Promise<void>(resolve => { finishFirst = resolve; });
        stored = text;
      },
    };
    const first = loadCatalog(endpoint, store, fetchResponse(valid));
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'));
    const second = loadCatalog(endpoint, store, fetchResponse(empty));
    finishFirst();
    await Promise.all([first, second]);
    expect(stored).toBe(empty);
  });
  it('prevents an older v2 failure from starting a later v1 fallback', async () => {
    const v2Store = cache(); const v1Store = cache();
    let resolveFirst!: (response: Awaited<ReturnType<CatalogFetcher>>) => void;
    let requests = 0;
    const v1 = 'https://v1.example.com/catalog.json';
    const fetcher: CatalogFetcher = url => {
      requests++;
      if (requests === 1) return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve({ ok: true, url, redirected: false, text: async () => url === endpoint ? '{broken' : empty });
    };
    const first = loadVersionedCatalog(endpoint, v1, v2Store, v1Store, fetcher);
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'));
    expect((await loadVersionedCatalog(endpoint, v1, v2Store, v1Store, fetcher)).status).toBe('empty');
    resolveFirst({ ok: true, url: endpoint, redirected: false, text: async () => '{broken' });
    await first;
    expect(requests).toBe(3);
    expect(v1Store.value()).toBe(empty);
  });
  it('prefers a v3 feed and preserves separate v2 and v1 caches', async () => {
    const v3 = '{"schemaVersion":3,"apps":[]}';
    const v3Store = cache(); const v2Store = cache('{"schemaVersion":2,"apps":[]}'); const v1Store = cache(valid);
    const loadV3 = loadVersionedCatalog as typeof loadVersionedCatalog & ((v2: string, v1: string, c2: ReturnType<typeof cache>, c1: ReturnType<typeof cache>, f: CatalogFetcher, v3: string, c3: ReturnType<typeof cache>) => ReturnType<typeof loadVersionedCatalog>);
    const fetcher = fetchResponse(v3);
    const result = await loadV3('https://v2.example.com/catalog.json', 'https://v1.example.com/catalog.json', v2Store, v1Store, fetcher, endpoint, v3Store);
    expect(result.status).toBe('empty'); expect(result.catalog?.schemaVersion).toBe(3);
    expect(v3Store.value()).toBe(v3); expect(v2Store.value()).toBe('{"schemaVersion":2,"apps":[]}'); expect(v1Store.value()).toBe(valid);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('falls back from an invalid v3 response to v2 without replacing any cache', async () => {
    const v2 = '{"schemaVersion":2,"apps":[]}';
    const v3Store = cache(); const v2Store = cache(v2); const v1Store = cache(valid);
    const fetcher: CatalogFetcher = async url => ({ ok: true, url, redirected: false, text: async () => url === endpoint ? '{broken' : v2 });
    const result = await loadVersionedCatalog('https://v2.example.com/catalog.json', 'https://v1.example.com/catalog.json', v2Store, v1Store, fetcher, endpoint, v3Store);
    expect(result.catalog?.schemaVersion).toBe(2); expect(v3Store.value()).toBeNull();
    expect(v2Store.value()).toBe(v2); expect(v1Store.value()).toBe(valid);
  });
  it('keeps a stale v3 cache visible rather than silently replacing it with v2', async () => {
    const v3 = '{"schemaVersion":3,"apps":[]}';
    const v3Store = cache(v3); const v2Store = cache('{"schemaVersion":2,"apps":[]}'); const v1Store = cache(valid);
    const offline: CatalogFetcher = async () => { throw new Error('offline'); };
    const result = await loadVersionedCatalog('https://v2.example.com/catalog.json', 'https://v1.example.com/catalog.json', v2Store, v1Store, offline, endpoint, v3Store);
    expect(result.status).toBe('offline'); expect(result.stale).toBe(true); expect(result.catalog?.schemaVersion).toBe(3);
    expect(v3Store.value()).toBe(v3); expect(v2Store.value()).toBe('{"schemaVersion":2,"apps":[]}'); expect(v1Store.value()).toBe(valid);
  });
  it('bounds a fetcher that never resolves and signals its abort', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher: CatalogFetcher = async (_url, options) => { signal = options.signal; return new Promise(() => {}); };
      const pending = loadCatalog(endpoint, cache(), fetcher, 100);
      await vi.advanceTimersByTimeAsync(100);
      expect((await pending).status).toBe('offline'); expect(signal?.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
