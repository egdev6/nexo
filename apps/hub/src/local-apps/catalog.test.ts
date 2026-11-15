import { expect, it, vi } from 'vitest';
import * as localApps from './index';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

it('does not expose local catalog commands', () => {
  expect(Object.keys(localApps).filter(name => /catalog/i.test(name))).toEqual([]);
});
