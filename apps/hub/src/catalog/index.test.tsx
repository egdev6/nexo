// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { HubApp } from '../model';
import { CatalogView } from './index';

afterEach(cleanup);

const apps: HubApp[] = [
  { id: 'pizarra', name: 'Pizarra', installed: false, running: false, integration: 'catalog', description: 'Ideas', tagline: 'Ideas a la vista', tags: ['Ideas', 'Organización'], version: '1.2.3', links: { github: 'https://github.com/example', youtube: 'https://youtube.com/example' } },
  { id: 'cadencia', name: 'Cadencia', installed: false, running: false, integration: 'catalog', description: 'Planifica', tagline: 'Tu ritmo', tags: ['Flujo'], links: { github: 'https://github.com/example2' } },
  { id: 'local', name: 'Local', installed: true, running: false, integration: 'local', description: 'Local' },
];

it('shows visual catalog cards with their supplied metadata and only available discovery buttons', () => {
  render(<CatalogView apps={apps} />);
  const pizarra = screen.getByRole('article', { name: 'Pizarra' });
  expect(within(pizarra).getByText('Ideas a la vista')).toBeTruthy();
  expect(within(pizarra).getByText('Ideas')).toBeTruthy();
  expect(within(pizarra).getByText('Organización')).toBeTruthy();
  expect(within(pizarra).getByText(/1\.2\.3/)).toBeTruthy();
  expect(within(pizarra).getByRole('button', { name: 'Código en GitHub de Pizarra · muestra' })).toBeTruthy();
  expect(within(pizarra).getByRole('button', { name: 'Ver en YouTube: Pizarra · muestra' })).toBeTruthy();
  const cadencia = screen.getByRole('article', { name: 'Cadencia' });
  expect(within(cadencia).getByText('Tu ritmo')).toBeTruthy();
  expect(within(cadencia).getByText('Flujo')).toBeTruthy();
  expect(within(cadencia).getByRole('button', { name: 'Código en GitHub de Cadencia · muestra' })).toBeTruthy();
  expect(within(cadencia).queryByRole('button', { name: /YouTube/ })).toBeNull();
  expect(within(cadencia).queryByText(/Versión/)).toBeNull();
  expect(screen.queryByRole('article', { name: 'Local' })).toBeNull();
});

it('marks install and discovery as illustrative and leaves data and location unchanged', () => {
  const before = JSON.stringify(apps);
  const location = window.location.href;
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);
  render(<CatalogView apps={apps} />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  fireEvent.click(within(card).getByRole('button', { name: 'Instalar Pizarra · muestra' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Código en GitHub de Pizarra · muestra' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Ver en YouTube: Pizarra · muestra' }));
  expect(JSON.stringify(apps)).toBe(before);
  expect(window.location.href).toBe(location);
  expect(open).not.toHaveBeenCalled();
  expect(within(card).getByRole('button', { name: 'Instalar Pizarra · muestra' })).toBeTruthy();
  expect(screen.getByText(/acciones.*ilustrativas/i)).toBeTruthy();
  open.mockRestore();
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
  expect(screen.getByRole('alert').textContent).toMatch(state === 'offline' ? /sin conexión/i : /error/i);
  expect(screen.getByRole('article', { name: 'Pizarra' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('shows an error without pretending an uncached catalog is empty', () => {
  render(<CatalogView apps={[]} state="error" reason="unconfigured" onRetry={() => {}} />);
  expect(screen.getByRole('alert').textContent).toMatch(/fuente oficial.*no está configurada/i);
  expect(screen.queryByText('No hay aplicaciones disponibles en el catálogo.')).toBeNull();
});

it('disables official installation when its installation state is unknown', () => {
  render(<CatalogView apps={[{ ...apps[0], source: 'official', statusKnown: false }]} state="ready" />);
  expect((screen.getByRole('button', { name: 'Instalar Pizarra' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('No se ha podido comprobar si la app está instalada.')).toBeTruthy();
});

it('does not enable official installation without a validated v3 catalog', () => {
  render(<CatalogView apps={[{ ...apps[0], source: 'official', statusKnown: true, installationState: 'notInstalled' }]} state="ready" />);
  expect((screen.getByRole('button', { name: 'Instalar Pizarra' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('La instalación requiere un catálogo oficial v3.')).toBeTruthy();
});

it('renders validated official artwork and real discovery links without an install action', () => {
  const app: HubApp = { ...apps[0], source: 'official', statusKnown: false, artUrl: 'https://example.com/art.png' };
  render(<CatalogView apps={[app]} state="ready" />);
  const card = screen.getByRole('article', { name: 'Pizarra' });
  expect(card.querySelector('img')?.getAttribute('src')).toBe('https://example.com/art.png');
  expect(within(card).getByRole('link', { name: 'Código en GitHub de Pizarra' }).getAttribute('href')).toBe(app.links?.github);
  expect((within(card).getByRole('button', { name: 'Instalar Pizarra' }) as HTMLButtonElement).disabled).toBe(true);
});
