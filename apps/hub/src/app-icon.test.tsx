// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);
import { AppIcon } from './App';

const base = { id: 'quorb', name: 'Quorb', installed: true, running: false, integration: 'none', description: '' } as const;

it('shows the catalog logo of an official app', () => {
  const { container } = render(<AppIcon app={{ ...base, iconUrl: 'https://egdev6.github.io/nexo-catalog/icons/quorb.png' }} />);
  const icon = container.querySelector('.app-icon')!;
  expect(icon.getAttribute('aria-hidden')).toBe('true');
  expect(icon.querySelector('img')?.getAttribute('src')).toBe('https://egdev6.github.io/nexo-catalog/icons/quorb.png');
  expect(icon.querySelector('img')?.getAttribute('alt')).toBe('');
  expect(icon.textContent).toBe('');
});

it('falls back to the initial when the logo fails to load or is missing', () => {
  const { container, rerender } = render(<AppIcon app={{ ...base, iconUrl: 'https://egdev6.github.io/nexo-catalog/icons/quorb.png' }} />);
  fireEvent.error(container.querySelector('.app-icon img')!);
  expect(container.querySelector('.app-icon img')).toBeNull();
  expect(container.querySelector('.app-icon')?.textContent).toBe('Q');
  rerender(<AppIcon app={{ ...base, id: 'local-x', name: 'Mi app' }} />);
  expect(container.querySelector('.app-icon img')).toBeNull();
  expect(container.querySelector('.app-icon')?.textContent).toBe('M');
});
