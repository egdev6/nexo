import postcss from 'postcss';
import { expect, it } from 'vitest';
import ts from 'typescript';
import fonts from './fonts.ts?raw';
// @ts-ignore The browser tsconfig intentionally excludes Node types, but Vitest runs in Node.
import { readFileSync } from 'node:fs';
// @ts-ignore Same as above.
import { cwd } from 'node:process';
import main from './main.tsx?raw';
import tauriConfig from '../src-tauri/tauri.conf.json?raw';
import barlowLicense from '../src-tauri/licenses/Barlow-OFL.txt?raw';
import condensedLicense from '../src-tauri/licenses/Barlow-Condensed-OFL.txt?raw';
// Vitest mocks CSS imports (including ?raw); read the real stylesheet. Vitest's root (cwd) is apps/hub.
const stylesheet = readFileSync(`${cwd()}/src/fonts.css`, 'utf8') as string;
import upstreamBarlowLicense from '@fontsource/barlow/LICENSE?raw';
import upstreamCondensedLicense from '@fontsource/barlow-condensed/LICENSE?raw';

const fontImports = ts.createSourceFile('fonts.ts', fonts, ts.ScriptTarget.Latest).statements.map(statement =>
  ts.isImportDeclaration(statement) && !statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text : null,
);
const expectedFaces = [
  ...[400, 500, 600, 700, 800].map(weight => ({ family: 'Barlow', packageName: 'barlow', weight })),
  ...[400, 600, 700, 800].map(weight => ({ family: 'Barlow Condensed', packageName: 'barlow-condensed', weight })),
];
const latinRange = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const fontSource = ({ packageName, weight }: typeof expectedFaces[number]) =>
  `@fontsource/${packageName}/files/${packageName}-latin-${weight}-normal.woff2`;

it('imports the local font stylesheet', () => {
  expect(fontImports).toEqual(['./fonts.css']);
});

it('ships exactly the expected WOFF2 sources without WOFF fallbacks', () => {
  const css = stylesheet;
  expect(css).not.toMatch(/\.woff(?=["')?#\s])/i);
  expect(css).not.toMatch(/format\(\s*['"]woff['"]\s*\)/i);
  const urls = [...css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)].map(match => match[1]);
  expect(urls).toEqual(expectedFaces.map(fontSource));
});

it('retains the normal Latin families, weights, display and fontsource unicode range', () => {
  const actual: Record<string, string>[] = [];
  postcss.parse(stylesheet).walkAtRules('font-face', face => {
    const declarations: Record<string, string> = {};
    face.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
    actual.push(declarations);
  });
  expect(actual).toEqual(expectedFaces.map(face => ({
    'font-family': `'${face.family}'`,
    'font-style': 'normal',
    'font-display': 'swap',
    'font-weight': String(face.weight),
    src: `url('${fontSource(face)}') format('woff2')`,
    'unicode-range': latinRange,
  })));
});

it('loads fonts before the application styles', () => {
  const source = ts.createSourceFile('main.tsx', main, ts.ScriptTarget.Latest);
  const first = source.statements[0];
  expect(ts.isImportDeclaration(first) && ts.isStringLiteral(first.moduleSpecifier) && first.moduleSpecifier.text).toBe('./fonts');
});

it('allows fonts only from the application origin', () => {
  const csp: string = JSON.parse(tauriConfig).app.security.csp;
  const directives = csp.split(';').map(part => part.trim().split(/\s+/));
  const fontSources = directives.find(([name]) => name === 'font-src') ?? directives.find(([name]) => name === 'default-src');
  expect(fontSources?.slice(1)).toEqual(["'self'"]);
});

it('bundles the unchanged license and copyright notices for both font families', () => {
  const resources: string[] = JSON.parse(tauriConfig).bundle.resources;
  expect(resources).toEqual(['licenses/Barlow-OFL.txt', 'licenses/Barlow-Condensed-OFL.txt']);
  expect(barlowLicense).toBe(upstreamBarlowLicense);
  expect(condensedLicense).toBe(upstreamCondensedLicense);
});
