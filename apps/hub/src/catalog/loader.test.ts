import { describe, expect, it, vi } from 'vitest';
import full from '../../../../crates/nexo-catalog/fixtures/full.json';
import { loadCatalog, type CatalogFetcher } from './loader';

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
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
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
    for (const fetcher of [fetchResponse('', { ok: false }), fetchResponse('{'), fetchResponse('{"schemaVersion":2,"apps":[]}')]) {
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
