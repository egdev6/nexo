import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourceDirectory = path.join(root, 'apps/hub/src');
const rawInteractive = new Set(['button', 'input', 'a', 'label', 'select', 'textarea']);
// Count interactive composites once per JSX invocation, not once per generated control.
const interactiveDsComponents = [
  'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogTrigger', 'Button', 'Carousel',
  'Checkbox', 'Chip', 'ChipGroup', 'CollapsibleTrigger', 'CommandPalette', 'DialogClose',
  'DialogTrigger', 'Dropzone', 'IconButton', 'Input', 'Label', 'Link', 'Menu', 'MenuTrigger',
  'PopoverClose', 'PopoverTrigger', 'RadioGroup', 'SearchTrigger', 'Select', 'SelectTile',
  'Slider', 'SocialLinks', 'Switch', 'Tabs', 'Textarea', 'Toggle',
];
const interactiveDs = new Set(interactiveDsComponents);
const usage = 'Usage: node ds-adoption-report.mjs [--json] [--help]\n';
const byName = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const percent = (numerator, denominator) => denominator ? 100 * numerator / denominator : null;

function importsIn(source) {
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const origin = moduleName === '@egdev/ui' || moduleName.startsWith('@egdev/ui/') ? 'ds'
      : moduleName.startsWith('./') || moduleName.startsWith('../') ? 'custom' : null;
    const clause = statement.importClause;
    if (!origin || !clause || clause.isTypeOnly) continue;
    if (clause.name) {
      const subpath = moduleName.startsWith('@egdev/ui/') ? moduleName.split('/').at(-1) : '';
      const inferred = subpath.replace(/(?:^|[-_])([a-z])/g, (_, letter) => letter.toUpperCase());
      imports.set(clause.name.text, { origin, name: interactiveDs.has(inferred) ? inferred : clause.name.text });
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, { origin, namespace: true });
    } else if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if (!item.isTypeOnly) imports.set(item.name.text, { origin, name: (item.propertyName ?? item.name).text });
      }
    }
  }
  return imports;
}

// Parse only trivia between TS/TSX tokens, so strings, regexes and JSX text are not comments.
function typescriptComments(source, addComment) {
  let end = 0;
  function visit(node) {
    const children = node.getChildren(source);
    if (children.length) {
      children.forEach(visit);
      return;
    }
    const start = node.kind === ts.SyntaxKind.JsxText ? node.getFullStart() : node.getStart(source);
    const gap = source.text.slice(end, start);
    for (const match of gap.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g)) {
      addComment(match[0], end + match.index);
    }
    end = Math.max(end, node.getEnd());
  }
  visit(source);
}

function cssComments(text, addComment) {
  for (let i = 0; i < text.length;) {
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i++];
      while (i < text.length) {
        if (text[i] === '\\') i += 2;
        else if (text[i++] === quote) break;
      }
    } else if (text[i] === '/' && text[i + 1] === '*') {
      const start = i;
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 2;
      addComment(text.slice(start, i), start);
    } else {
      i++;
    }
  }
}

function issueReferences(comment) {
  const body = comment.replace(/^\/\/?\*?/, '').replace(/\*\/$/, '')
    .replace(/^[ \t]*\*[ \t]?/gm, '').trim();
  // A bare reference has no repository identity. Require workaround context, or a
  // comment containing only #N, to avoid counting ordinary Nexo issue comments.
  const qualified = /\begdev-design-system#\d+\b/i.test(body);
  const bareWorkaround = /\b(?:TODO|workaround|design[ -]system|DS)\b/i.test(body)
    || /^#\d+[\s.!?]*$/.test(body);
  if (!qualified && !bareWorkaround) return [];
  return [...new Set(body.match(/(?<![\w-])#\d+\b|(?<=egdev-design-system)#\d+\b/gi) ?? [])];
}

/** Analyze in-memory { file, content } entries; file names are repository-relative. */
export function analyzeSources(files) {
  const totals = { ds: 0, dsInteractive: 0, custom: 0, rawInteractive: 0, rawStructural: 0, other: 0, jsx: 0 };
  const custom = new Map();
  const occurrences = [];
  const workarounds = [];
  for (const { file, content } of files) {
    if (!/\.(?:ts|tsx|css)$/.test(file)) continue;
    const source = file.endsWith('.css') ? null : ts.createSourceFile(
      file, content, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const addComment = (comment, position) => {
      const issues = issueReferences(comment);
      if (!issues.length) return;
      const line = source ? source.getLineAndCharacterOfPosition(position).line + 1
        : content.slice(0, position).split(/\r\n|\r|\n/).length;
      workarounds.push({ file, line, issues });
    };
    if (source) typescriptComments(source, addComment);
    else cssComments(content, addComment);
    if (!file.endsWith('.tsx') || /\.(?:test|spec)\.tsx$/i.test(file) || /(?:^|\/)__tests__\//.test(file)) continue;

    const imports = importsIn(source);
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        const name = tag.getText(source);
        totals.jsx++;
        if ((ts.isIdentifier(tag) || ts.isJsxNamespacedName(tag)) && /^[a-z]/.test(name)) {
          if (rawInteractive.has(name)) {
            totals.rawInteractive++;
            occurrences.push({ element: name, file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
          } else totals.rawStructural++;
        } else {
          let base = tag;
          while (ts.isPropertyAccessExpression(base)) base = base.expression;
          const binding = ts.isIdentifier(base) ? imports.get(base.text) : undefined;
          if (binding?.origin === 'ds') {
            totals.ds++;
            const component = ts.isPropertyAccessExpression(tag) ? tag.name.text : binding.name;
            const mode = component === 'Chip' && node.attributes.properties.find(
              attribute => ts.isJsxAttribute(attribute) && attribute.name.text === 'mode',
            );
            const initializer = mode?.initializer;
            const modeValue = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
            const staticChip = modeValue && ts.isStringLiteral(modeValue) && modeValue.text === 'static';
            if (interactiveDs.has(component) && !staticChip) totals.dsInteractive++;
          } else if (binding?.origin === 'custom') {
            totals.custom++;
            const key = JSON.stringify([name, file]);
            const entry = custom.get(key) ?? { component: name, file, count: 0 };
            entry.count++;
            custom.set(key, entry);
          } else totals.other++;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const frequencies = new Map();
  for (const { element } of occurrences) frequencies.set(element, (frequencies.get(element) ?? 0) + 1);
  occurrences.sort((a, b) => frequencies.get(b.element) - frequencies.get(a.element)
    || byName(a.element, b.element) || byName(a.file, b.file) || a.line - b.line);
  workarounds.sort((a, b) => byName(a.file, b.file) || a.line - b.line);
  return {
    definitions: {
      scope: 'Non-test TSX source instances; custom means locally imported components. Other JSX is excluded from the percentages.',
      adoption: 'DS / (DS + custom + raw interactive)',
      interactiveAdoption: 'DS interactive / (DS interactive + raw interactive)',
      interactiveCounting: 'Count listed components once per JSX instance, including composites; Chip mode="static" is excluded.',
      interactiveDsComponents,
      workaroundComments: 'TS/TSX/CSS comments with egdev-design-system#N, or bare #N with TODO/workaround/DS context or alone; issue status is not checked.',
    },
    totals,
    adoptionPercent: percent(totals.ds, totals.ds + totals.custom + totals.rawInteractive),
    interactiveAdoptionPercent: percent(totals.dsInteractive, totals.dsInteractive + totals.rawInteractive),
    customComponents: [...custom.values()].sort((a, b) => b.count - a.count || byName(a.component, b.component) || byName(a.file, b.file)),
    rawInteractiveOccurrences: occurrences,
    workaroundCount: workarounds.length,
    workarounds,
  };
}

export function formatTextReport(report) {
  const value = number => number === null ? 'n/a' : `${number.toFixed(2)}%`;
  const { totals, definitions } = report;
  const lines = [
    'Design-system adoption (JSX source instances, not rendered controls)',
    definitions.scope,
    `Overall: ${value(report.adoptionPercent)} = ${definitions.adoption}`,
    `Interactive: ${value(report.interactiveAdoptionPercent)} = ${definitions.interactiveAdoption}`,
    '',
    'JSX totals',
    `  DS: ${totals.ds} (interactive subset: ${totals.dsInteractive})`,
    `  Custom, locally imported: ${totals.custom}`,
    `  Raw interactive: ${totals.rawInteractive}`,
    `  Raw structural: ${totals.rawStructural}`,
    `  Other, excluded from percentages: ${totals.other}`,
    `  All JSX elements: ${totals.jsx}`,
    definitions.interactiveCounting,
    `Interactive DS names: ${definitions.interactiveDsComponents.join(', ')}`,
    '', 'Custom components by instance count (usage file):',
    ...report.customComponents.map(({ component, count, file }) => `  ${component.padEnd(24)} ${String(count).padStart(3)}  ${file}`),
    '', 'Raw interactive occurrences (ranked by element frequency):',
    ...report.rawInteractiveOccurrences.map(({ element, file, line }) => `  ${element.padEnd(10)} ${file}:${line}`),
    '', `Workaround comments: ${report.workaroundCount}`,
    definitions.workaroundComments,
    ...report.workarounds.map(({ issues, file, line }) => `  ${issues.join(', ')}  ${file}:${line}`),
  ];
  return `${lines.join('\n')}\n`;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(fullPath));
    else if (entry.isFile() && /\.(?:ts|tsx|css)$/.test(entry.name)) {
      files.push({ file: path.relative(root, fullPath).split(path.sep).join('/'), content: await readFile(fullPath, 'utf8') });
    }
  }
  return files;
}

async function main(args) {
  const unknown = args.find(arg => arg !== '--json' && arg !== '--help');
  if (unknown) {
    process.stderr.write(`Unknown argument: ${unknown}\n${usage}`);
    process.exitCode = 1;
    return;
  }
  if (args.includes('--help')) {
    process.stdout.write(`${usage}Reports JSX adoption in apps/hub/src; --json emits machine-readable data.\n`);
    return;
  }
  const report = analyzeSources(await sourceFiles(sourceDirectory));
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : formatTextReport(report));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Design-system adoption report failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
