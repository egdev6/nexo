// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FirstRun } from './index';

configure({ getElementError: message => new Error(message?.split('\n')[0] ?? 'Element not found') });
afterEach(cleanup);

it('chooses Spanish only when continuing', () => {
  const onChoose = vi.fn();
  render(<FirstRun onChoose={onChoose} />);
  const spanish = screen.getByRole('radio', { name: 'Español' });
  expect(spanish.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(spanish);
  expect(onChoose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(onChoose).toHaveBeenCalledExactlyOnceWith('es');
});

it('chooses English with the keyboard and continues in English', async () => {
  const onChoose = vi.fn();
  render(<FirstRun onChoose={onChoose} />);
  const spanish = screen.getByRole('radio', { name: 'Español' });
  spanish.focus();
  fireEvent.keyDown(spanish, { key: 'ArrowRight' });
  const english = screen.getByRole('radio', { name: 'English' });
  await waitFor(() => expect(english.getAttribute('aria-checked')).toBe('true'));
  expect(onChoose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(onChoose).toHaveBeenCalledExactlyOnceWith('en');
});
