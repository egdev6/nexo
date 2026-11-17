// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FirstRun } from './index';

configure({ getElementError: message => new Error(message?.split('\n')[0] ?? 'Element not found') });
afterEach(cleanup);

it('renders the bilingual intro as a section header with tagged copy and hidden separators', () => {
  render(<FirstRun onChoose={vi.fn()} />);
  // jsdom's accessible-name implementation trims inline spans; verify exact visible spacing below.
  const heading = screen.getByRole('heading', { level: 1, name: /^Elige tu idioma\s*Choose your language$/ });
  const eyebrow = heading.previousElementSibling!;
  const lede = heading.nextElementSibling!;
  for (const [element, spanish, english, separator] of [
    [eyebrow, 'Primer uso ·', 'First launch', ' '],
    [heading, 'Elige tu idioma', 'Choose your language', ' - '],
    [lede, 'Puedes cambiarlo después en Ajustes.', 'You can change it later in Settings.', ' - '],
  ] as const) {
    expect(element.textContent).toBe(`${spanish}${separator}${english}`);
    expect([...element.querySelectorAll('[lang]')].map(run => [run.getAttribute('lang'), run.textContent])).toEqual([
      ['es', spanish], ['en', english],
    ]);
    expect([...element.querySelectorAll('[aria-hidden="true"]')].map(run => run.textContent)).toEqual(
      separator === ' ' ? [] : ['-'],
    );
  }
  expect(heading.parentElement?.classList.contains('eg-section-head')).toBe(true);
});

it('uses text-only SelectTile choices with keyboard preview and confirmation', async () => {
  const onChoose = vi.fn();
  const onPreview = vi.fn();
  render(<FirstRun onChoose={onChoose} onPreview={onPreview} />);
  const group = screen.getByRole('radiogroup', { name: 'Idioma / Language' });
  const spanish = screen.getByRole('radio', { name: 'Español' });
  const english = screen.getByRole('radio', { name: 'English' });
  expect(group.classList.contains('eg-select-tile')).toBe(true);
  expect(group.querySelector('img')).toBeNull();
  expect(spanish.getAttribute('aria-checked')).toBe('true');
  spanish.focus();
  fireEvent.keyDown(spanish, { key: 'ArrowRight' });
  await waitFor(() => expect(english.getAttribute('aria-checked')).toBe('true'));
  expect(onPreview).toHaveBeenLastCalledWith('en');
  expect(onChoose).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Continue' });
  expect(button.getAttribute('lang')).toBe('en');
  fireEvent.click(button);
  expect(onChoose).toHaveBeenCalledExactlyOnceWith('en');
});

it('previews language changes without committing until continuing', () => {
  const onChoose = vi.fn();
  const onPreview = vi.fn();
  render(<FirstRun onChoose={onChoose} onPreview={onPreview} />);
  fireEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect(onPreview).toHaveBeenLastCalledWith('en');
  expect(screen.getByRole('button', { name: 'Continue' }).getAttribute('lang')).toBe('en');
  expect(onChoose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: 'Español' }));
  expect(onPreview.mock.calls).toEqual([['en'], ['es']]);
  expect(onChoose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  expect(onChoose).toHaveBeenCalledExactlyOnceWith('es');
});

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
