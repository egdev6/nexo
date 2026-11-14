import { invoke } from '@tauri-apps/api/core';
import { isHttpsUrl, parseCatalog, type Catalog } from './format';

// T4: the maintainer sets the stable, reviewed public HTTPS URL after publication.
export const OFFICIAL_CATALOG_URL: string | undefined = undefined;
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
export const webFetcher: CatalogFetcher = (url, options) => fetch(url, options);

class InvalidResponse extends Error {}
function endpointIsHttps(endpoint: string): boolean { return isHttpsUrl(endpoint); }

/** Startup/retry transaction. A failed response never replaces the last valid cache. */
export async function loadCatalog(endpoint: string | undefined, cache: CatalogCache, fetcher: CatalogFetcher, timeoutMs = CATALOG_TIMEOUT_MS): Promise<CatalogState> {
  let previous: Catalog | undefined;
  try {
    const text = await cache.read();
    if (text !== null) previous = parseCatalog(JSON.parse(text));
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
      return { text, catalog };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    const { text, catalog } = await Promise.race([request, timeout]);
    try { await cache.write(text); } catch { return { status: 'error', catalog, reason: 'cache' }; }
    return { status: catalog.apps.length ? 'ready' : 'empty', catalog };
  } catch (error) {
    return { status: error instanceof InvalidResponse ? 'error' : 'offline', catalog: previous, stale: !!previous, reason: error instanceof InvalidResponse ? 'response' : undefined };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
