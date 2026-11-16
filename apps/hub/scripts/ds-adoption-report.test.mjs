import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { analyzeSources, formatTextReport } from './ds-adoption-report.mjs';

const fixture = [
  { file: 'apps/hub/src/demo.tsx', content: [
    "import { Button as Primary, Badge, type Input as InputType } from '@egdev/ui';",
    "import * as UI from '@egdev/ui/controls';",
    "import Local, { Card as Tile } from './local';",
    "import * as Sections from '../local';",
    "import { Other } from 'third-party';",
    '// TODO(egdev-design-system#42): remove the override',
    'const ignored = "<button /> // TODO(egdev-design-system#900)";',
    'const view = <>',
    '  <Primary /><Badge /><UI.Input /><UI.Panel><Tile /><Local /><Tile /></UI.Panel>',
    '  <Sections.Row /><Other /><SameFile />',
    '  <button /><button /><input /><a href="/" /><label /><select /><textarea />',
    '  <div><span /><h1>Heading</h1></div>',
    '  <p>// TODO(egdev-design-system#903) text</p>',
    '  {/* TODO #404 local workaround */}',
    '</>;',
  ].join('\n') },
  { file: 'apps/hub/src/demo.test.tsx', content: "// egdev-design-system#43\nconst test = <button />;" },
  { file: 'apps/hub/src/__tests__/other.tsx', content: 'const test = <button />;' },
  { file: 'apps/hub/src/fix.ts', content: [
    '// Issue #13 is unrelated',
    '// TODO(#405) workaround',
    'const text = "// TODO(egdev-design-system#901)";',
  ].join('\n') },
  { file: 'apps/hub/src/fix.css', content: [
    '/* #404 */',
    '.example { content: "/* TODO(egdev-design-system#902) */"; color: #404; }',
    '/* egdev-design-system#407 and #408 */',
    '/*',
    ' * #409',
    ' */',
  ].join('\n') },
];

test('counts source JSX instances by origin, aliases and interactive type', () => {
  const report = analyzeSources(fixture);
  assert.deepEqual(report.totals, {
    ds: 4, dsInteractive: 2, custom: 4, rawInteractive: 7,
    rawStructural: 4, other: 2, jsx: 21,
  });
  assert.equal(report.adoptionPercent, 100 * 4 / 15);
  assert.equal(report.interactiveAdoptionPercent, 100 * 2 / 9);
  assert.deepEqual(report.customComponents, [
    { component: 'Tile', file: 'apps/hub/src/demo.tsx', count: 2 },
    { component: 'Local', file: 'apps/hub/src/demo.tsx', count: 1 },
    { component: 'Sections.Row', file: 'apps/hub/src/demo.tsx', count: 1 },
  ]);
  assert.deepEqual(report.rawInteractiveOccurrences, [
    ...['button', 'button', 'a', 'input', 'label', 'select', 'textarea'].map(element => ({
      element, file: 'apps/hub/src/demo.tsx', line: 11,
    })),
  ]);
});

test('finds issue-linked comments in TS, TSX (including tests) and CSS, not strings or JSX text', () => {
  const { workaroundCount, workarounds } = analyzeSources(fixture);
  assert.equal(workaroundCount, 7);
  assert.deepEqual(workarounds, [
    { file: 'apps/hub/src/demo.test.tsx', line: 1, issues: ['#43'] },
    { file: 'apps/hub/src/demo.tsx', line: 6, issues: ['#42'] },
    { file: 'apps/hub/src/demo.tsx', line: 14, issues: ['#404'] },
    { file: 'apps/hub/src/fix.css', line: 1, issues: ['#404'] },
    { file: 'apps/hub/src/fix.css', line: 3, issues: ['#407', '#408'] },
    { file: 'apps/hub/src/fix.css', line: 4, issues: ['#409'] },
    { file: 'apps/hub/src/fix.ts', line: 2, issues: ['#405'] },
  ]);
});

test('makes both formulas, boundaries and report lists readable and machine-consumable', () => {
  const report = analyzeSources(fixture);
  const text = formatTextReport(report);
  assert.match(text, /26\.67%.*DS \/ \(DS \+ custom \+ raw interactive\)/);
  assert.match(text, /22\.22%.*DS interactive \/ \(DS interactive \+ raw interactive\)/);
  assert.match(text, /Tile\s+2\s+apps\/hub\/src\/demo\.tsx/);
  assert.match(text, /button\s+apps\/hub\/src\/demo\.tsx:11/);
  assert.match(text, /Workaround comments: 7/);
  assert.match(text, /#407, #408\s+apps\/hub\/src\/fix\.css:3/);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  const empty = analyzeSources([]);
  assert.equal(empty.adoptionPercent, null);
  assert.equal(empty.interactiveAdoptionPercent, null);
  assert.match(formatTextReport(empty), /n\/a.*DS \/ \(DS \+ custom \+ raw interactive\)/);
});

test('recognizes default imports from the root and subpaths as interactive controls', () => {
  const report = analyzeSources([{ file: 'apps/hub/src/defaults.tsx', content: [
    "import Button from '@egdev/ui';",
    "import Cta from '@egdev/ui/button';",
    'const view = <><Button /><Cta /></>;',
  ].join('\n') }]);
  assert.equal(report.totals.ds, 2);
  assert.equal(report.totals.dsInteractive, 2);
  assert.equal(report.adoptionPercent, 100);
  assert.equal(report.interactiveAdoptionPercent, 100);
});

test('excludes explicitly static Chips from interactive controls', () => {
  const report = analyzeSources([{ file: 'apps/hub/src/chips.tsx', content: [
    "import { Chip } from '@egdev/ui';",
    'const view = <><Chip /><Chip mode="static" /><Chip mode={\'static\'} /><Chip mode="link" /></>;',
  ].join('\n') }]);
  assert.equal(report.totals.ds, 4);
  assert.equal(report.totals.dsInteractive, 2);
  assert.equal(report.adoptionPercent, 100);
  assert.equal(report.interactiveAdoptionPercent, 100);
});

test('CLI documents its options and rejects unknown arguments without reading sources', () => {
  const script = fileURLToPath(new URL('./ds-adoption-report.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.equal(help.stderr, '');
  assert.equal(help.stdout, 'Usage: node ds-adoption-report.mjs [--json] [--help]\nReports JSX adoption in apps/hub/src; --json emits machine-readable data.\n');
  const bad = spawnSync(process.execPath, [script, '--unknown'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, 'Unknown argument: --unknown\nUsage: node ds-adoption-report.mjs [--json] [--help]\n');
});

test('CLI --json emits the complete report without extra output', () => {
  const script = fileURLToPath(new URL('./ds-adoption-report.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(result.stdout, `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(report.adoptionPercent, 100 * report.totals.ds / (report.totals.ds + report.totals.custom + report.totals.rawInteractive));
  assert.equal(report.workaroundCount, report.workarounds.length);
});
