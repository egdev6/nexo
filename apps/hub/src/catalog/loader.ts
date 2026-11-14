import { invoke } from '@tauri-apps/api/core';
import { isHttpsUrl, parseCatalog, type Catalog } from './format';

// T4: the maintainer sets the stable, reviewed public HTTPS URL after publication.
export const OFFICIAL_CATALOG_URL: string | undefined = 'https://egdev6.github.io/nexo-catalog/catalog.json';
export const OFFICIAL_CATALOG_V2_URL: string | undefined = 'https://egdev6.github.io/nexo-catalog/v2/catalog.json';
export const CATALOG_TIMEOUT_MS = 8000;

export interface CatalogCache { read(): Promise<string | null>; write(text: string): Promise<void> }
export interface CatalogResponse { ok: boolean; url: string; redirected: boolean; text(): Promise<string> }
export type CatalogFetcher = (url: string, options: { signal: AbortSignal; redirect: 'error' }) => Promise<CatalogResponse>;
export interface CatalogState {
  status: 'loading' | 'ready' | 'empty' | 'offline' | 'error';
  catalog?: Catalog;
  stale?: boolean;
  reason?: 'unconfigured' | 'response' | 'cache';
}

export const diskCache: CatalogCache = {
  read: () => invoke<string | null>('read_catalog_cache'),
  write: text => invoke<void>('write_catalog_cache', { input: text }),
};
export const diskCacheV2: CatalogCache = {
  read: () => invoke<string | null>('read_catalog_v2_cache'),
  write: text => invoke<void>('write_catalog_cache', { input: text }),
};
export const webFetcher: CatalogFetcher = (url, options) => fetch(url, options);

class InvalidResponse extends Error {}
function endpointIsHttps(endpoint: string): boolean { return isHttpsUrl(endpoint); }

type CacheTransaction = { generation: number; writes: Promise<void> };
const cacheTransactions = new WeakMap<CatalogCache, CacheTransaction>();
const versionedTransactions = new WeakMap<CatalogCache, number>();
function beginCacheTransaction(cache: CatalogCache): [CacheTransaction, number] {
  let transaction = cacheTransactions.get(cache);
  if (!transaction) {
    transaction = { generation: 0, writes: Promise.resolve() };
    cacheTransactions.set(cache, transaction);
  }
  return [transaction, ++transaction.generation];
}
async function writeCurrent(cache: CatalogCache, transaction: CacheTransaction, generation: number, text: string): Promise<void> {
  const write = transaction.writes.then(async () => {
    if (generation === transaction.generation) await cache.write(text);
  });
  transaction.writes = write.catch(() => {});
  await write;
}

/** Startup/retry transaction. A failed response never replaces the last valid cache. */
export async function loadCatalog(endpoint: string | undefined, cache: CatalogCache, fetcher: CatalogFetcher, timeoutMs = CATALOG_TIMEOUT_MS, version: 1 | 2 = 1): Promise<CatalogState> {
  const [transaction, generation] = beginCacheTransaction(cache);
  let previous: Catalog | undefined;
  try {
    const text = await cache.read();
    if (text !== null) {
      const parsed = parseCatalog(JSON.parse(text));
      if (parsed.schemaVersion === version) previous = parsed;
    }
  } catch { /* Missing, corrupt or unavailable caches are not authoritative. */ }
  if (!endpoint || !endpointIsHttps(endpoint)) return { status: 'error', catalog: previous, stale: !!previous, reason: 'unconfigured' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      const response = await fetcher(endpoint, { signal: controller.signal, redirect: 'error' });
      if (!response.ok || response.redirected || !endpointIsHttps(response.url) || new URL(response.url).origin !== new URL(endpoint).origin) throw new InvalidResponse();
      const text = await response.text();
      let catalog: Catalog;
      try { catalog = parseCatalog(JSON.parse(text)); } catch { throw new InvalidResponse(); }
      if (catalog.schemaVersion !== version) throw new InvalidResponse();
      return { text, catalog };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    const { text, catalog } = await Promise.race([request, timeout]);
    try { await writeCurrent(cache, transaction, generation, text); } catch { return { status: 'error', catalog, reason: 'cache' }; }
    return { status: catalog.apps.length ? 'ready' : 'empty', catalog };
  } catch (error) {
    return { status: error instanceof InvalidResponse ? 'error' : 'offline', catalog: previous, stale: !!previous, reason: error instanceof InvalidResponse ? 'response' : undefined };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Prefer a separately configured v2 feed/cache; retain the old v1 feed and cache for fallback. */
export async function loadVersionedCatalog(
  v2Endpoint: string | undefined, v1Endpoint: string | undefined,
  v2Cache: CatalogCache, v1Cache: CatalogCache, fetcher: CatalogFetcher,
): Promise<CatalogState> {
  const generation = (versionedTransactions.get(v1Cache) ?? 0) + 1;
  versionedTransactions.set(v1Cache, generation);
  const v2 = await loadCatalog(v2Endpoint, v2Cache, fetcher, CATALOG_TIMEOUT_MS, 2);
  if (v2.catalog || versionedTransactions.get(v1Cache) !== generation) return v2;
  const v1 = await loadCatalog(v1Endpoint, v1Cache, fetcher);
  return v1.catalog || v1Endpoint || !v2Endpoint ? v1 : v2;
}
