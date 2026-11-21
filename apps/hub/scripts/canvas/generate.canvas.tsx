import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { expect, it } from 'vitest';
import { buildArtboards } from './build';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const contrastCss = readFileSync(resolve('scripts/canvas/egdev-family-contrast.css'), 'utf8');
const expectedFonts = [
  ...[400, 500, 600, 700, 800].map((weight) => ({ family: 'Barlow', packageName: 'barlow', weight })),
  ...[400, 600, 700, 800].map((weight) => ({ family: 'Barlow Condensed', packageName: 'barlow-condensed', weight })),
].map(({ family, packageName, weight }) => ({
  family,
  style: 'normal',
  display: 'swap',
  weight: String(weight),
  range:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  src: digest(
    `url(data:font/woff2;base64,${readFileSync(resolve(`node_modules/@fontsource/${packageName}/files/${packageName}-latin-${weight}-normal.woff2`)).toString('base64')}) format('woff2')`,
  ),
}));

it('generates self-contained Windows captures for each real component state and settings tab', async () => {
  const boards = await buildArtboards();
  expect(boards.map((board) => board.file)).toEqual([
    '01-mis-apps.html',
    '02-catalogo.html',
    '03-novedades.html',
    '04a-ajustes-general.html',
    '04b-ajustes-apariencia.html',
    '04c-ajustes-apps-locales.html',
    '04d-ajustes-acerca-de.html',
    '05-primer-uso.html',
  ]);
  const docs = boards.map((board) => new DOMParser().parseFromString(board.html, 'text/html'));
  for (const [index, doc] of docs.entries()) {
    expect(doc.documentElement.lang).toBe('es');
    expect(doc.querySelector('.flyout')).toBeTruthy();
    expect(doc.querySelector('.flyout')?.className).toBe('flyout');
    expect(doc.querySelector('.flyout')?.hasAttribute('data-backdrop')).toBe(false);
    expect(doc.querySelector('.win-taskbar svg')).toBeTruthy();
    const css = doc.querySelector('style')?.textContent ?? '';
    expect(css).toContain('--font-sans: "Barlow", system-ui, sans-serif');
    const fonts: { family: string; style: string; display: string; weight: string; range: string; src: string }[] = [];
    postcss.parse(css).walkAtRules('font-face', (face) => {
      const declarations: Record<string, string> = {};
      face.walkDecls((declaration) => {
        declarations[declaration.prop] = declaration.value;
      });
      fonts.push({
        family: declarations['font-family']?.replace(/^['"]|['"]$/g, ''),
        style: declarations['font-style'],
        display: declarations['font-display'],
        weight: declarations['font-weight'],
        range: declarations['unicode-range'],
        src: digest(declarations.src ?? ''),
      });
    });
    expect(fonts).toHaveLength(expectedFonts.length);
    expect(fonts).toEqual(expectedFonts);
    expect(css.endsWith(contrastCss)).toBe(true);
    expect(contrastCss).toMatch(/#root\.win-frame\s*\{[^}]*top: 0; right: 0; width: 600px; height: 1032px; border-radius: 0;/);
    expect(contrastCss).toMatch(/\.win-frame \.flyout\s*\{[^}]*border: 0; border-radius: 0;/);
    expect(boards[index].html.replaceAll('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    expect(doc.querySelector('img[src],link[href],script[src]')).toBeNull();
  }
  expect(docs[0].body.textContent).toMatch(/Antena/);
  expect(docs[0].body.textContent).toMatch(/Quorb/);
  expect(docs[0].querySelector('.eg-collapsible')).toBeTruthy();
  expect(docs[0].querySelector('.update-notes')).toBeTruthy();
  expect(docs[1].querySelectorAll('.catalog-card')).toHaveLength(3);
  expect(docs[1].querySelector('button[aria-label="Instalar Pizarra"]')?.hasAttribute('disabled')).toBe(false);
  expect(docs[1].querySelector('[role="progressbar"][aria-valuenow="60"]')).toBeTruthy();
  expect(docs[1].body.textContent).toMatch(/Cancelar/);
  expect(docs[1].querySelector('.catalog-install-reason')?.textContent).toContain('Falta la clave');
  expect(docs[2].querySelector('.eg-carousel')).toBeTruthy();
  expect(docs[2].querySelectorAll('.news-slide')).toHaveLength(3);
  for (const [index, name] of ['General', 'Apariencia', 'Apps locales', 'Acerca de'].entries()) {
    const selected = docs[index + 3].querySelector('.settings__tabs [role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe(name);
  }
  expect(docs[3].body.textContent).toMatch(/Iniciar con Windows/);
  expect(docs[3].body.textContent).toMatch(/Idioma/);
  expect(docs[4].body.textContent).toMatch(/Color de acento/);
  expect(docs[4].querySelector('[role="slider"][aria-label="Opacidad del fondo"]')).toBeTruthy();
  expect(docs[4].querySelector('[role="slider"][aria-label="Desenfoque del fondo"]')).toBeTruthy();
  expect(docs[5].body.textContent).toMatch(/Apps locales/);
  expect(docs[5].body.textContent).toMatch(/Editor de vídeo/);
  expect(docs[5].body.textContent).toMatch(/Ejecutable ausente o inaccesible/);
  expect(docs[6].body.textContent).toMatch(/Versión 0\.1\.0/);
  expect(docs[6].body.textContent).toContain('Tipografía Barlow · SIL Open Font License 1.1');
  expect(docs[7].body.textContent).toMatch(/Elige tu idioma/);
  // Only RadioGroup radios get the contrast fill; SelectTile overlays and color swatches are radios too.
  expect(contrastCss).not.toMatch(/\.flyout \[role='radio'\]/);
  expect(contrastCss).toContain(".flyout .eg-radio-group [role='radio'][aria-checked='true']");
  expect(docs[7].body.textContent).toMatch(/Continuar/);
  for (const board of boards) writeFileSync(resolve('../../design/nexo-hub-actual', board.file), board.html);
});
