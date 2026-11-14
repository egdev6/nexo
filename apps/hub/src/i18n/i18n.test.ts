import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { formatMessage, formatNumber, t, translate } from './index';
import messages from './messages.json';
import app from '../App.tsx?raw';
import settings from '../settings/index.tsx?raw';
import firstRun from '../first-run/index.tsx?raw';
import catalog from '../catalog/index.tsx?raw';
import news from '../news/index.tsx?raw';
import localApps from '../local-apps/view.tsx?raw';
type Tree = { [key: string]: string | Tree };
const leaves = (tree: Tree, prefix = ''): Record<string, string> => Object.fromEntries(
  Object.entries(tree).flatMap(([key, value]) => typeof value === 'string'
    ? [[prefix + key, value]] : Object.entries(leaves(value, `${prefix}${key}.`))),
);
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('shared catalog', () => {
  it('has the same nonempty keys and placeholders in both languages', () => {
    const data: { es: Tree; en: Tree } = messages;
    const es = leaves(data.es); const en = leaves(data.en);
    expect(Object.keys(es).length).toBeGreaterThan(0);
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const key of Object.keys(es)) {
      expect(es[key].trim(), `es: ${key}`).not.toBe('');
      expect(en[key].trim(), `en: ${key}`).not.toBe('');
      expect(placeholders(en[key]), key).toEqual(placeholders(es[key]));
    }
  });
});

it('does not hard-code hub-owned JSX copy or accessible labels in views', () => {
  const views = Object.entries({ '../App.tsx': app, '../settings/index.tsx': settings, '../first-run/index.tsx': firstRun, '../catalog/index.tsx': catalog, '../news/index.tsx': news, '../local-apps/view.tsx': localApps });
  const exceptions = new Set(['N', 'Nexo', '+']);
  const found: string[] = [];
  for (const [file, text] of views) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxText(node)) {
        const text = node.text.trim();
        if (/[A-Za-zÁ-ú]/.test(text) && !exceptions.has(text)) found.push(`${file}: ${text}`);
      }
      if (ts.isJsxAttribute(node) && ['aria-label', 'title', 'label', 'placeholder'].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
        if (!exceptions.has(node.initializer.text)) found.push(`${file}: ${node.initializer.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(found).toEqual([]);
});

it('interpolates and falls back to Spanish and then the key', () => {
  expect(t('en', 'app.available', { version: '1.2.3' })).toBe('Available: 1.2.3');
  expect(formatMessage('{x} {missing}', { x: 7 })).toBe('7 {missing}');
  expect(translate({ a: 'Hola' }, { a: '' }, 'en', 'a')).toBe('Hola');
  expect(translate({}, {}, 'en', 'missing.key')).toBe('missing.key');
  expect(formatNumber('es', 12345.5)).toBe('12.345,5');
  expect(formatNumber('en', 12345.5)).toBe('12,345.5');
  // @ts-expect-error invalid catalog keys are rejected at compile time
  expect(t('en', 'missing.key')).toBe('missing.key');
});
