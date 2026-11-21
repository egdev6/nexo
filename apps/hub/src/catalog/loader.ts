import { invoke } from '@tauri-apps/api/core';
import { isHttpsUrl, parseCatalogV4, projectCatalogV4, type Catalog } from './format';

export const OFFICIAL_CATALOG_URL: string | undefined = 'https://egdev6.github.io/nexo-catalog/v4/catalog.json';
export const CATALOG_TIMEOUT_MS = 8000;

export interface CatalogCache { read(): Promise<string | null>; write(text: string): Promise<void> }
export interface CatalogResponse { ok: boolean; url: string; redirected: boolean; text(): Promise<string> }
export type CatalogFetcher = (url: string, options: { signal: AbortSignal; redirect: 'error'; cache: 'no-cache' }) => Promise<CatalogResponse>;
export interface CatalogState {
  status: 'loading' | 'ready' | 'empty' | 'offline' | 'error';
  catalog?: Catalog;
  stale?: boolean;
  reason?: 'unconfigured' | 'response' | 'cache';
}

export const diskCache: CatalogCache = {
  read: () => invoke<string | null>('read_catalog_v4_cache'),
  write: text => invoke<void>('write_catalog_cache', { input: text }),
};
export const webFetcher: CatalogFetcher = (url, options) => fetch(url, options);

class InvalidResponse extends Error {}
function endpointIsHttps(endpoint: string): boolean { return isHttpsUrl(endpoint); }

type CacheTransaction = { generation: number; writes: Promise<void> };
const cacheTransactions = new WeakMap<CatalogCache, CacheTransaction>();
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
export async function loadCatalog(endpoint: string | undefined, cache: CatalogCache, fetcher: CatalogFetcher, platformKey: string | null, timeoutMs = CATALOG_TIMEOUT_MS): Promise<CatalogState> {
  const [transaction, generation] = beginCacheTransaction(cache);
  let previous: Catalog | undefined;
  try {
    const text = await cache.read();
    if (text !== null) {
      previous = projectCatalogV4(parseCatalogV4(JSON.parse(text)), platformKey);
    }
  } catch { /* Missing, corrupt or unavailable caches are not authoritative. */ }
  if (!endpoint || !endpointIsHttps(endpoint)) return { status: 'error', catalog: previous, stale: !!previous, reason: 'unconfigured' };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      // Revalidate with the server every time: GitHub Pages sends max-age=600, so a cached copy would hide catalog updates for up to 10 minutes.
      const response = await fetcher(endpoint, { signal: controller.signal, redirect: 'error', cache: 'no-cache' });
      if (!response.ok || response.redirected || !endpointIsHttps(response.url) || new URL(response.url).origin !== new URL(endpoint).origin) throw new InvalidResponse();
      const text = await response.text();
      let catalog: Catalog;
      try { catalog = projectCatalogV4(parseCatalogV4(JSON.parse(text)), platformKey); } catch { throw new InvalidResponse(); }
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
