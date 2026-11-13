import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import App from './App';

it('shows the Nexo placeholder screen', () => {
  const screen = renderToStaticMarkup(<App />);

  expect(screen).toContain('<h1>Nexo</h1>');
  expect(screen).toContain('Your apps, together.');
});
