import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildArtboards } from './build';

it('generates self-contained Windows captures for each real component state and settings tab', async () => {
  const boards = await buildArtboards();
  expect(boards.map(board => board.file)).toEqual([
    '01-mis-apps.html', '02-catalogo.html', '03-novedades.html',
    '04a-ajustes-general.html', '04b-ajustes-apariencia.html',
    '04c-ajustes-fuentes-del-catalogo.html', '04d-ajustes-acerca-de.html', '05-primer-uso.html',
  ]);
  const docs = boards.map(board => new DOMParser().parseFromString(board.html, 'text/html'));
  for (const [index, doc] of docs.entries()) {
    expect(doc.documentElement.lang).toBe('es');
    expect(doc.querySelector('.flyout')).toBeTruthy();
    expect(doc.querySelector('.win-taskbar svg')).toBeTruthy();
    const css = doc.querySelector('style')?.textContent ?? '';
    expect(css).toContain('--font-sans: "Barlow", system-ui, sans-serif');
    expect(css).toMatch(/#root\.win-frame\s*\{[^}]*top: 13px; right: 13px; width: 600px; height: 1006px/);
    expect(boards[index].html.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    expect(doc.querySelector('img[src],link[href],script[src]')).toBeNull();
  }
  expect(docs[0].body.textContent).toMatch(/Antena/);
  expect(docs[0].body.textContent).toMatch(/Quorb/);
  expect(docs[0].body.textContent).toMatch(/duplicad/i);
  expect(docs[0].body.textContent).toMatch(/ejecutable/i);
  expect(docs[0].querySelector('.eg-collapsible')).toBeTruthy();
  expect(docs[0].querySelector('.update-notes')).toBeTruthy();
  expect(docs[1].querySelectorAll('.catalog-card')).toHaveLength(3);
  expect(docs[1].querySelector('button[aria-label="Instalar Pizarra"]')?.hasAttribute('disabled')).toBe(false);
  expect(docs[1].querySelector('[role="progressbar"][aria-valuenow="60"]')).toBeTruthy();
  expect(docs[1].body.textContent).toMatch(/Cancelar/);
  expect(docs[1].querySelector('.catalog-install-reason')?.textContent).toContain('Falta la clave');
  expect(docs[2].querySelector('.eg-carousel')).toBeTruthy();
  expect(docs[2].querySelectorAll('.news-slide')).toHaveLength(3);
  for (const [index, name] of ['General', 'Apariencia', 'Fuentes del catálogo', 'Acerca de'].entries()) {
    const selected = docs[index + 3].querySelector('.settings__tabs [role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe(name);
  }
  expect(docs[3].body.textContent).toMatch(/Iniciar con Windows/);
  expect(docs[3].body.textContent).toMatch(/Idioma/);
  expect(docs[4].body.textContent).toMatch(/Color de acento/);
  expect(docs[4].querySelector('[role="slider"][aria-label="Opacidad del fondo"]')).toBeTruthy();
  expect(docs[4].querySelector('[role="slider"][aria-label="Desenfoque del fondo"]')).toBeTruthy();
  expect(docs[5].body.textContent).toMatch(/Catálogo oficial egdev/);
  expect(docs[5].body.textContent).toMatch(/Catálogo de trabajo/);
  expect(docs[5].body.textContent).toMatch(/No se pudo leer la fuente local/);
  expect(docs[5].body.textContent).toMatch(/Apps locales/);
  expect(docs[5].body.textContent).toMatch(/Editor de vídeo/);
  expect(docs[5].body.textContent).toMatch(/Ejecutable ausente o inaccesible/);
  expect(docs[6].body.textContent).toMatch(/Versión 0\.1\.0/);
  expect(docs[7].querySelector('.eg-radio-group')).toBeTruthy();
  expect(docs[7].body.textContent).toMatch(/Continuar/);
  for (const board of boards) writeFileSync(resolve('../../design/nexo-hub-actual', board.file), board.html);
});
