// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HubApp, Language } from '../model';
import { CatalogView, catalogBannerUrl } from './index';
// @ts-ignore Vitest runs in Node; the browser tsconfig excludes Node types.
import { readFileSync } from 'node:fs';
// @ts-ignore Vitest's root is apps/hub.
import { cwd } from 'node:process';
const css = readFileSync(`${cwd()}/src/catalog/catalog.css`, 'utf8') as string;

const native = vi.hoisted(() => ({ invoke: vi.fn(), locale: 'es' as Language }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock('../i18n/use-locale', () => ({ useLocale: () => native.locale }));
beforeEach(() => { native.locale = 'es'; native.invoke.mockReset(); native.invoke.mockResolvedValue(null); });
afterEach(cleanup);

const apps: HubApp[] = [
  { id: 'pizarra', name: 'Pizarra', installed: false, running: false, integration: 'catalog', description: 'Ideas', tagline: 'Ideas a la vista', tags: ['Ideas', 'Organización'], version: '1.2.3', links: { github: 'https://github.com/example', youtube: 'https://youtube.com/example' } },
  { id: 'cadencia', name: 'Cadencia', installed: false, running: false, integration: 'catalog', description: 'Planifica', tagline: 'Tu ritmo', tags: ['Flujo'], links: { github: 'https://github.com/example2' } },
  { id: 'local', name: 'Local', installed: true, running: false, integration: 'local', description: 'Local' },
];

it('shows metadata without tag badges and preserves the sample install action', () => {
  const before = JSON.stringify(apps);
  render(<CatalogView apps={apps} />);
  const pizarra = screen.getByRole('article', { name: 'Pizarra' });
  expect(within(pizarra).getByText('Ideas a la vista')).toBeTruthy();
  expect(within(pizarra).queryByText('Ideas')).toBeNull();
  expect(within(pizarra).queryByText('Organización')).toBeNull();
  expect(within(pizarra).getByText(/1\.2\.3/)).toBeTruthy();
  fireEvent.click(within(pizarra).getByRole('button', { name: 'Instalar Pizarra · muestra' }));
  expect(JSON.stringify(apps)).toBe(before);
  expect(native.invoke).not.toHaveBeenCalled();
  expect(screen.queryByRole('article', { name: 'Local' })).toBeNull();
});

it.each(['pizarra', 'app-42', '0', '-'])('builds the exact banner URL for valid id %s', id => {
  expect(catalogBannerUrl(id)).toBe(`https://egdev6.github.io/nexo-catalog/banners/${id}.webp`);
});

it.each(['', '../secret', 'App', 'app/other', 'app?x', 'app%2fother', 'app\n', ' app', 'á'])('rejects invalid banner id %j', id => {
  expect(catalogBannerUrl(id)).toBeUndefined();
});

it('loads the conventional banner, never the old artwork, and replaces a missing banner with the initial', () => {
  const app = { ...apps[0], source: 'official' as const, artUrl: 'https://example.com/art.png', iconUrl: 'https://example.com/icon.png' };
  render(<CatalogView apps={[app]} />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  const image = card.querySelector('img');
  expect(image?.getAttribute('src')).toBe('https://egdev6.github.io/nexo-catalog/banners/pizarra.webp');
  expect(image?.getAttribute('alt')).toBe('');
  fireEvent.error(image!);
  expect(card.querySelector('img')).toBeNull();
  expect(within(card).getByText('P')).toBeTruthy();
});

it('removes a broken image and shows the app initial', () => {
  render(<CatalogView apps={[{ ...apps[0], artUrl: 'https://example.com/old.png' }]} />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  const image = card.querySelector('img');
  expect(image).toBeTruthy();
  fireEvent.error(image!);
  expect(card.querySelector('img')).toBeNull();
  expect(within(card).getByText('P')).toBeTruthy();
});

it('uses the initial without requesting a banner for an invalid id', () => {
  render(<CatalogView apps={[{ ...apps[0], id: '../escape' }]} />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  expect(card.querySelector('img')).toBeNull();
  expect(within(card).getByText('P')).toBeTruthy();
});

it('uses equal-height cards, cover banners and bottom-pinned actions', () => {
  render(<CatalogView apps={apps} />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  expect(card.querySelector('.catalog-art')).toBeTruthy();
  expect(card.querySelector('.catalog-card-body > .catalog-actions')).toBeTruthy();
  expect(css).toMatch(/\.catalog-grid\s*\{[^}]*grid-auto-rows:\s*1fr/s);
  expect(css).toMatch(/\.catalog-card\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  expect(css).toMatch(/\.catalog-art\s*\{[^}]*width:\s*100%[^}]*height:\s*var\(--space-24\)/s);
  expect(css).toMatch(/\.catalog-art img\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover/s);
  expect(css).toMatch(/\.catalog-card-body\s*\{[^}]*display:\s*flex[^}]*flex:\s*1[^}]*flex-direction:\s*column/s);
  expect(css).toMatch(/\.catalog-actions\s*\{[^}]*margin-top:\s*auto/s);
});

it('opens only present social links through the native policy for official and sample cards', async () => {
  const official = { ...apps[0], source: 'official' as const, statusKnown: false };
  const empty = { ...apps[0], id: 'no-links', name: 'No Links', links: undefined };
  const location = window.location.href;
  render(<CatalogView apps={[official, apps[1], empty]} />);
  const pizarra = screen.getByRole('article', { name: 'Pizarra' });
  const social = within(pizarra).getByRole('list', { name: 'Enlaces sociales' });
  expect(pizarra.querySelector('p')!.compareDocumentPosition(social) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(social.compareDocumentPosition(pizarra.querySelector('.catalog-actions')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fireEvent.click(within(social).getByRole('link', { name: /GitHub/i }))).toBe(false);
  expect(fireEvent.click(within(social).getByRole('link', { name: /YouTube/i }))).toBe(false);
  const cadencia = screen.getByRole('article', { name: 'Cadencia' });
  expect(within(cadencia).queryByRole('link', { name: /YouTube/i })).toBeNull();
  fireEvent.click(within(cadencia).getByRole('link', { name: /GitHub/i }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(3));
  expect(native.invoke).toHaveBeenNthCalledWith(1, 'open_external', { url: apps[0].links!.github });
  expect(native.invoke).toHaveBeenNthCalledWith(2, 'open_external', { url: apps[0].links!.youtube });
  expect(native.invoke).toHaveBeenNthCalledWith(3, 'open_external', { url: apps[1].links!.github });
  const noLinks = screen.getByRole('article', { name: 'No Links' });
  expect(within(noLinks).queryByRole('list', { name: /social/i })).toBeNull();
  expect(within(noLinks).queryByRole('link')).toBeNull();
  expect(within(noLinks).getAllByRole('button')).toHaveLength(1);
  expect(window.location.href).toBe(location);
});

it.each([['es', 'No se pudo abrir el enlace.'], ['en', 'Could not open the link.']] as const)('reports native social-link failures in %s and clears them on retry', async (locale, message) => {
  native.locale = locale;
  native.invoke.mockRejectedValueOnce(new Error('private diagnostic'));
  render(<CatalogView apps={[apps[0]]} />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  const link = within(card).getByRole('link', { name: /GitHub/i });
  fireEvent.click(link);
  const alert = await within(card).findByRole('alert');
  expect(alert.textContent).toBe(message);
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(alert.dataset.size).toBe('sm');
  fireEvent.click(link);
  await waitFor(() => expect(within(card).queryByRole('alert')).toBeNull());
  expect(native.invoke).toHaveBeenCalledTimes(2);
});

it.each([{ entries: [] }, { entries: [apps[2]] }])('shows the empty catalog without fabricating an error or install action', ({ entries }) => {
  render(<CatalogView apps={entries} />);
  expect(screen.getByText('No hay aplicaciones disponibles en el catálogo.')).toBeTruthy();
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.queryByRole('button', { name: /Instalar/ })).toBeNull();
});

it('shows a loading message rather than an empty result', () => {
  render(<CatalogView apps={[]} state="loading" />);
  expect(screen.getByRole('status').textContent).toMatch(/cargando/i);
  expect(screen.queryByText('No hay aplicaciones disponibles en el catálogo.')).toBeNull();
});

it.each(['offline', 'error'] as const)('shows %s and retries while preserving available cached cards', state => {
  const retry = vi.fn();
  render(<CatalogView apps={[apps[0]]} state={state} onRetry={retry} />);
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toMatch(state === 'offline' ? /sin conexión/i : /error/i);
  expect(alert.classList.contains('eg-notice')).toBe(true);
  expect(within(alert).getByRole('button', { name: /reintentar/i })).toBeTruthy();
  expect(screen.getByRole('article', { name: 'Pizarra' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('uses a retryable Notice when a targeted catalog app is unavailable', () => {
  const retry = vi.fn();
  render(<CatalogView apps={[]} targetAppId="missing" onRetry={retry} />);
  const alert = screen.getByRole('alert');
  expect(alert.classList.contains('eg-notice')).toBe(true);
  fireEvent.click(within(alert).getByRole('button', { name: /reintentar/i }));
  expect(retry).toHaveBeenCalledOnce();
});

it('shows an error without pretending an uncached catalog is empty', () => {
  render(<CatalogView apps={[]} state="error" reason="unconfigured" onRetry={() => {}} />);
  expect(screen.getByRole('alert').textContent).toMatch(/fuente oficial.*no está configurada/i);
  expect(screen.queryByText('No hay aplicaciones disponibles en el catálogo.')).toBeNull();
});

it.each([
  ['es', 'Instalar Pizarra', 'No se puede comprobar si ya está instalada'],
  ['en', 'Install Pizarra', 'Cannot check whether it is already installed.'],
] as const)('explains unknown installation in %s and still requires an official v3 catalog', (locale, label, reason) => {
  native.locale = locale;
  render(<CatalogView apps={[{ ...apps[0], source: 'official', statusKnown: false, installationState: 'unknown' }]} state="ready" />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  const button = within(card).getByRole('button', { name: label }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  const warning = within(card).getByText(reason);
  expect(button.getAttribute('aria-describedby')?.split(/\s+/)).toContain(warning.id);
  expect(within(card).getByText(locale === 'es' ? 'La instalación requiere un catálogo oficial v3.' : 'Installation requires an official v3 catalog.')).toBeTruthy();
  fireEvent.click(button);
  expect(native.invoke).not.toHaveBeenCalled();
});

it('does not enable official installation without a validated v3 catalog', () => {
  render(<CatalogView apps={[{ ...apps[0], source: 'official', statusKnown: true, installationState: 'notInstalled' }]} state="ready" />);
  expect((screen.getByRole('button', { name: 'Instalar Pizarra' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('La instalación requiere un catálogo oficial v3.')).toBeTruthy();
});

it('preserves the disabled official install action alongside discovery links', () => {
  const app: HubApp = { ...apps[0], source: 'official', statusKnown: false };
  render(<CatalogView apps={[app]} state="ready" />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  expect((within(card).getByRole('button', { name: 'Instalar Pizarra' }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(card).getByRole('link', { name: /GitHub/i }).getAttribute('href')).toBe(app.links?.github);
});

it.each([
  ['es', '¿Te resultan útiles estas apps? Dales una estrella en', 'GitHub'],
  ['en', 'Find these apps useful? Give them a star on', 'GitHub'],
] as const)('asks for a GitHub star under the catalog heading in %s and opens the author profile', async (locale, text, link) => {
  native.locale = locale;
  render(<CatalogView apps={apps} />);
  const prompt = screen.getByText(text, { exact: false });
  expect(prompt.closest('.catalog-star')).toBeTruthy();
  const anchor = within(prompt.closest('.catalog-star') as HTMLElement).getByRole('link', { name: new RegExp(link) });
  expect(anchor.getAttribute('href')).toBe('https://github.com/egdev6');
  fireEvent.click(anchor);
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith('open_external', { url: 'https://github.com/egdev6' }));
  expect(declarationsFor('.catalog-star').color).toBe('var(--color-fg-secondary)');
});

function declarationsFor(selector: string) {
  const match = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  return Object.fromEntries((match?.[1] ?? '').split(';').map(part => part.split(':').map(value => value.trim())).filter(pair => pair[0]));
}
