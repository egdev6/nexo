// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FlyoutPanel } from './App';
import type { HubApp } from './model';
import { defaultSettings } from './sample';
import type { RegistrySnapshot } from './shell/registry';
import { mockImageLoading } from './test-helpers/image-loading';

const native = vi.hoisted(() => ({ publish: undefined as undefined | ((snapshot: RegistrySnapshot) => void) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('./settings/use-settings', () => ({
  useSettings: () => ({
    settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false },
    fileState: 'ready',
    languageDraft: null,
    autostart: {},
    recordVisit: vi.fn(),
    getVisit: () => null,
  }),
}));
vi.mock('./news/use-flyout', () => ({ useFlyoutVisibility: () => ({ visibility: null, lastShow: null, error: null }) }));
vi.mock('./shell/registry', () => ({
  subscribeRegistry: vi.fn(async (publish: (snapshot: RegistrySnapshot) => void) => {
    native.publish = publish;
    return () => {};
  }),
  exitHubOnly: vi.fn(),
}));
vi.mock('./window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));

const url = 'https://example.test/quorb.png';
const base: HubApp = {
  id: 'quorb',
  name: 'Quorb',
  installed: true,
  running: false,
  integration: 'complete',
  description: 'Quorb',
  source: 'official',
  installationState: 'installed',
};
let failedSources: Set<string>;
beforeEach(() => {
  native.publish = undefined;
  failedSources = new Set();
  mockImageLoading(failedSources);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function identity(name: RegExp) {
  const trigger = screen.getByRole('button', { name, expanded: false });
  const icon = trigger.querySelector('.eg-app-icon');
  expect(icon).toBeTruthy();
  expect(icon?.getAttribute('aria-hidden')).toBe('true');
  expect(icon?.getAttribute('aria-label')).toBeNull();
  return icon!;
}

it('shows the catalog logo for an installed app without duplicating its accessible name', async () => {
  render(<FlyoutPanel apps={[{ ...base, iconUrl: url }]} news={[]} />);
  const icon = identity(/^Quorb/);
  await waitFor(() => expect(icon.querySelector('img')?.getAttribute('src')).toBe(url));
  expect(icon.querySelector('img')?.getAttribute('alt')).toBe('');
});

it('uses the uppercase first letter when a logo fails or is missing and recovers on a source change', async () => {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal('Image', function Image() {
    const image = document.createElement('img');
    images.push(image);
    return image;
  });
  const view = render(<FlyoutPanel apps={[{ ...base, name: ' quorb', iconUrl: url }]} news={[]} />);
  const icon = identity(/^quorb/i);
  expect(icon.querySelector('img')).toBeNull();
  expect(icon.textContent).toBe('Q');
  expect(images[0]?.getAttribute('src')).toBe(url);
  await act(async () => {
    fireEvent.error(images[0]);
  });
  expect(icon.querySelector('img')).toBeNull();
  expect(icon.textContent).toBe('Q');
  view.rerender(<FlyoutPanel apps={[{ ...base, name: ' mi app' }]} news={[]} />);
  expect(identity(/^mi app/i).textContent).toBe('M');
  view.rerender(<FlyoutPanel apps={[{ ...base, iconUrl: 'https://example.test/new.png' }]} news={[]} />);
  const replacement = images.at(-1)!;
  expect(replacement.getAttribute('src')).toBe('https://example.test/new.png');
  Object.defineProperties(replacement, { complete: { value: true }, naturalWidth: { value: 100 } });
  await act(async () => {
    fireEvent.load(replacement);
  });
  await waitFor(() =>
    expect(
      identity(/^Quorb/)
        .querySelector('img')
        ?.getAttribute('src'),
    ).toBe('https://example.test/new.png'),
  );
});

it('uses the official catalog identity on a connected row', async () => {
  render(<FlyoutPanel apps={[{ ...base, iconUrl: url }]} news={[]} />);
  await waitFor(() => expect(native.publish).toBeTypeOf('function'));
  act(() =>
    native.publish!({
      revision: 1,
      apps: [
        {
          app: { id: 'quorb', name: 'Quorb', version: '1' },
          capabilities: ['show'],
          unified: true,
          responsive: true,
          generation: 1,
          menu_revision: 0,
          menu: [],
        },
      ],
    }),
  );
  const icon = identity(/^Quorb/);
  await waitFor(() => expect(icon.querySelector('img')?.getAttribute('src')).toBe(url));
  expect(icon.querySelector('img')?.getAttribute('alt')).toBe('');
});
