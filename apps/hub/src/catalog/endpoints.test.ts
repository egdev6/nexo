import { describe, expect, it } from 'vitest';
import tauriConfig from '../../src-tauri/tauri.conf.json?raw';
import * as loader from './loader';
const { OFFICIAL_CATALOG_URL } = loader;

const ORIGIN = 'https://egdev6.github.io';

describe('official catalog endpoints', () => {
  it('points at the public catalog published on GitHub Pages', () => {
    expect(OFFICIAL_CATALOG_URL).toBe(`${ORIGIN}/nexo-catalog/v4/catalog.json`);
    expect(loader).not.toHaveProperty('OFFICIAL_CATALOG_V2_URL');
    expect(loader).not.toHaveProperty('OFFICIAL_CATALOG_V3_URL');
  });

  it('limits the webview to the catalog origin for fetches and images', () => {
    const config = JSON.parse(tauriConfig);
    const csp: string = config.app.security.csp;
    const directive = (name: string) => csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `)) ?? '';
    expect(directive('connect-src').split(/\s+/)).toEqual(['connect-src', 'ipc:', 'http://ipc.localhost', ORIGIN]);
    expect(directive('img-src').split(/\s+/)).toEqual(['img-src', "'self'", 'data:', ORIGIN]);
  });
});
