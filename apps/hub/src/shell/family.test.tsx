// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Icon, IconButton } from '@egdev/ui';
import { afterEach, expect, it, vi } from 'vitest';
import { FlyoutPanel } from '../App';
import { defaultSettings } from '../sample';
import { hideFlyout } from '../window';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock('../settings/use-settings', () => ({ useSettings: () => ({
  settings: { ...defaultSettings, firstRunComplete: true, showNewsOnOpen: false, opacity: 63, blur: 12 },
  fileState: 'ready', languageDraft: null,
}) }));
vi.mock('../settings', () => ({ SettingsView: () => <section aria-label="Ajustes">Ajustes abiertos</section> }));
vi.mock('../news/use-flyout', () => ({ useFlyoutVisibility: () => ({ visibility: null, lastShow: null, error: null }) }));
vi.mock('../shell/registry', () => ({ subscribeRegistry: vi.fn().mockResolvedValue(() => {}), exitHubOnly: vi.fn() }));
vi.mock('../window', () => ({ backdropAvailable: vi.fn().mockResolvedValue(false), hideFlyout: vi.fn() }));
vi.mock('../local-apps/view', () => ({ LocalAppsView: () => null }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('uses the design-system ghost variant for both header icon buttons', () => {
  render(<><FlyoutPanel apps={[]} news={[]} /><IconButton label="Referencia" variant="ghost" icon={<Icon name="close" />} /></>);
  const header = screen.getByRole('heading', { name: 'Nexo' }).closest('header')!;
  const expected = screen.getByRole('button', { name: 'Referencia' }).className;
  expect(['Ajustes', 'Cerrar panel'].map(name => within(header).getByRole('button', { name }).className)).toEqual([expected, expected]);
});

it('keeps header actions and the configured opacity and blur', () => {
  render(<FlyoutPanel apps={[]} news={[]} />);
  const panel = screen.getByRole('main');
  expect(panel.style.getPropertyValue('--hub-opacity')).toBe('0.63');
  expect(panel.style.getPropertyValue('--hub-blur')).toBe('12px');
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
  expect(screen.getByRole('region', { name: 'Ajustes' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
  expect(hideFlyout).toHaveBeenCalledTimes(1);
});
