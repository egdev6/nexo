import { expect, it } from 'vitest';
// @ts-ignore Vitest runs in Node; the browser tsconfig intentionally excludes Node types.
import { readFileSync, readdirSync } from 'node:fs';
// @ts-ignore Same as above.
import { cwd, emitWarning } from 'node:process';
import { designSystemAllowlist } from './design-system-allowlist';
import { checkDesignSystem, type GuardSource, type GuardViolation } from './design-system-guard';

// Vitest mocks CSS imports, so walk the real source tree and read the files directly.
function readSources(directory = 'src'): GuardSource[] {
  const entries = readdirSync(`${cwd()}/${directory}`, { withFileTypes: true }) as {
    name: string; isDirectory(): boolean; isFile(): boolean;
  }[];
  return entries.sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return readSources(file);
    return entry.isFile() && /\.(tsx|css)$/.test(file)
      ? [{ file, content: readFileSync(`${cwd()}/${file}`, 'utf8') as string }]
      : [];
  });
}

const describeViolation = ({ file, line, snippet }: GuardViolation) =>
  `${file}:${line}: ${snippet} — Use a DS component or add an allowlist entry with an issue.`;

it('guards the real hub source and reports every unallowed violation', () => {
  const result = checkDesignSystem(readSources(), designSystemAllowlist);
  if (result.pendingIssueCount) {
    // Node warnings remain visible even when Vitest's agent reporter hides passing console output.
    emitWarning(`${result.pendingIssueCount} design-system allowlist entries use nexo#TBD-* placeholders; replace them with real issues.`, 'DesignSystemGuard');
  }
  expect([...result.violations.map(describeViolation), ...result.errors]).toEqual([]);
});

it('rejects new raw JSX elements, including both forms of anchor, with file, line and snippet', () => {
  const content = [
    'const View = () => <>',
    '  <button type="button">Go</button>',
    '  <input />',
    '  <a href="/">link</a>',
    '  <a>plain</a>',
    '  <label htmlFor="id">Label</label>',
    '</>;',
  ].join('\n');
  const result = checkDesignSystem([{ file: 'src/new.tsx', content }], []);
  expect(result.errors).toEqual([]);
  expect(result.violations.map(describeViolation)).toEqual([
    'src/new.tsx:2: <button type="button"> — Use a DS component or add an allowlist entry with an issue.',
    'src/new.tsx:3: <input /> — Use a DS component or add an allowlist entry with an issue.',
    'src/new.tsx:4: <a href="/"> — Use a DS component or add an allowlist entry with an issue.',
    'src/new.tsx:5: <a> — Use a DS component or add an allowlist entry with an issue.',
    'src/new.tsx:6: <label htmlFor="id"> — Use a DS component or add an allowlist entry with an issue.',
  ]);
});

it('finds DS class and all tab selector spellings, including nested and multiline rules', () => {
  const content = [
    '/* .eg-comment, [role=tab] */',
    '.local { content: ".eg-string [role=tab]"; }',
    '[data-icon=".eg-attribute"] { color: red; }',
    '.wrapper',
    '  > .eg-button,',
    '[role=\'tab\'], [role="tab"], [role=tab], [role = "tab" ] { color: red; }',
    '[role=tablist], [role="tabpanel"] { color: red; }',
    '@media (min-width: 1px) { .eg-nested { color: blue; } }',
  ].join('\n');
  const result = checkDesignSystem([{ file: 'src/new.css', content }], []);
  expect(result.violations.map(({ line, snippet }) => [line, snippet])).toEqual([
    [4, '.wrapper > .eg-button'],
    [6, "[role='tab']"],
    [6, '[role="tab"]'],
    [6, '[role=tab]'],
    [6, '[role = "tab" ]'],
    [8, '.eg-nested'],
  ]);
});

it('ignores tests, theme CSS, JSX strings and comments, and non-target paths', () => {
  const files = [
    { file: 'src/view.test.tsx', content: 'const a = <button />;' },
    { file: 'src/view.spec.tsx', content: 'const a = <input />;' },
    { file: 'src/__tests__/view.tsx', content: 'const a = <label />;' },
    { file: 'src/theme/colors.css', content: '.eg-button, [role=tab] {}' },
    { file: 'elsewhere/view.tsx', content: 'const a = <a />;' },
    { file: 'src/view.tsx', content: 'const text = "<button />"; const view = <div>{/* <label /> */}<Button /></div>;' },
  ];
  expect(checkDesignSystem(files, []).violations).toEqual([]);
});

it('allows only the exact file and opening tag or selector, once per entry', () => {
  const files = [
    { file: 'src/view.tsx', content: 'const a = <button type="button" />; const b = <button type="button" />; const c = <button disabled />;' },
    { file: 'src/other.tsx', content: 'const a = <button type="button" />;' },
    { file: 'src/view.css', content: '.box .eg-button { color: red; } .box .eg-button:hover { color: blue; }' },
  ];
  const allowlist = [
    { file: 'src/view.tsx', pattern: '<button type="button" />', issue: 'nexo#12', reason: 'Temporary control.' },
    { file: 'src/view.css', pattern: '.box .eg-button', issue: 'egdev6/egdev-design-system#404', reason: 'Temporary override.' },
  ];
  const result = checkDesignSystem(files, allowlist);
  expect(result.errors).toEqual([]);
  expect(result.violations.map(({ file, snippet }) => [file, snippet])).toEqual([
    ['src/view.tsx', '<button type="button" />'],
    ['src/view.tsx', '<button disabled />'],
    ['src/other.tsx', '<button type="button" />'],
    ['src/view.css', '.box .eg-button:hover'],
  ]);
});

it('marks a duplicate exception stale when one of its matching occurrences is removed', () => {
  const entry = { file: 'src/view.tsx', pattern: '<button />', issue: 'nexo#12', reason: 'Temporary control.' };
  const result = checkDesignSystem([{ file: 'src/view.tsx', content: 'const view = <button />;' }], [entry, entry]);
  expect(result.violations).toEqual([]);
  expect(result.errors).toEqual(['src/view.tsx: stale allowlist entry <button />; remove it']);
});

it('rejects missing or malformed issues, blank reasons and stale entries', () => {
  const source = [{ file: 'src/view.tsx', content: 'const view = <button />;' }];
  const result = checkDesignSystem(source, [
    { file: 'src/view.tsx', pattern: '<button />', issue: '', reason: ' ' },
    { file: 'src/old.css', pattern: '.eg-old', issue: 'egdev-design-system#404', reason: 'Old override.' },
  ]);
  expect(result.errors).toEqual([
    'src/view.tsx: invalid issue for allowlist entry <button />',
    'src/view.tsx: empty reason for allowlist entry <button />',
    'src/old.css: invalid issue for allowlist entry .eg-old',
    'src/old.css: stale allowlist entry .eg-old; remove it',
  ]);
});

it('tracks component gaps only while both their exact opening tag and TODO comment exist', () => {
  const pattern = '<p className="first-run__eyebrow">';
  const comment = '// TODO(egdev-design-system#TBD-section-header-rich-text): Preserve bilingual language tags.';
  const entry = { file: 'src/intro.tsx', pattern, comment, issue: 'nexo#TBD-section-header-rich-text', reason: 'Replace the intro when SectionHeader supports mixed-language content.', kind: 'component-gap' as const };
  const check = (content: string) => checkDesignSystem([{ file: 'src/intro.tsx', content }], [entry]);
  expect(check(`${comment}\nconst view = ${pattern}Hello</p>;`).errors).toEqual([]);
  expect(check(`${comment}\nconst view = <section />;`).errors).toEqual([`src/intro.tsx: stale allowlist entry ${pattern}; remove it`]);
  expect(check(`const text = ${JSON.stringify(comment)}; const view = ${pattern}Hello</p>;`).errors).toEqual([`src/intro.tsx: stale allowlist entry ${pattern}; remove it`]);
});

it('accepts visible nexo TBD placeholders without accepting arbitrary issue references', () => {
  const files = [{ file: 'src/view.tsx', content: 'const a = <button />; const b = <input />;' }];
  const result = checkDesignSystem(files, [
    { file: 'src/view.tsx', pattern: '<button />', issue: 'nexo#TBD-color-swatch', reason: 'Awaiting issue.' },
    { file: 'src/view.tsx', pattern: '<input />', issue: 'egdev6/egdev-design-system#404', reason: 'Tracked.' },
  ]);
  expect(result.errors).toEqual([]);
  expect(result.violations).toEqual([]);
  expect(result.pendingIssueCount).toBe(1);
});
