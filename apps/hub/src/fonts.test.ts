import { expect, it } from 'vitest';
import ts from 'typescript';
import fonts from './fonts.ts?raw';
import main from './main.tsx?raw';
import tauriConfig from '../src-tauri/tauri.conf.json?raw';

it('imports exactly the normal Latin weights used by the hub and shared styles', () => {
  const source = ts.createSourceFile('fonts.ts', fonts, ts.ScriptTarget.Latest);
  const imports = source.statements.map(statement =>
    ts.isImportDeclaration(statement) && !statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text : null,
  );
  expect(imports).toEqual([
    '@fontsource/barlow/latin-400.css',
    '@fontsource/barlow/latin-500.css',
    '@fontsource/barlow/latin-600.css',
    '@fontsource/barlow/latin-700.css',
    '@fontsource/barlow/latin-800.css',
    '@fontsource/barlow-condensed/latin-400.css',
    '@fontsource/barlow-condensed/latin-600.css',
    '@fontsource/barlow-condensed/latin-700.css',
    '@fontsource/barlow-condensed/latin-800.css',
  ]);
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
