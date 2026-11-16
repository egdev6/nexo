import postcss from 'postcss';
import ts from 'typescript';

export interface GuardSource {
  file: string;
  content: string;
}

export interface GuardAllowlistEntry {
  file: string;
  // An exact, whitespace-normalized opening tag or individual CSS selector, not a regex.
  pattern: string;
  issue: string;
  reason: string;
  // Non-guarded markup awaiting a DS capability is tracked by its opening tag and TODO.
  kind?: 'component-gap';
  comment?: string;
}

export interface GuardViolation {
  file: string;
  line: number;
  snippet: string;
}

export interface GuardResult {
  violations: GuardViolation[];
  errors: string[];
  pendingIssueCount: number;
}

export interface GuardOptions {
  // Repository name used for local issue references (`<localRepo>#N`, `<localRepo>#TBD-slug`).
  localRepo?: string;
  // App theme layer, the only place where CSS may target DS internals.
  themeDirectory?: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');

// Only inspect selector syntax, not comments, strings or attribute values containing `.eg-`.
function targetsInternal(selector: string): boolean {
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '\\') { i++; continue; }
    if (selector[i] === '/' && selector[i + 1] === '*') {
      const end = selector.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }
    if (selector[i] === '"' || selector[i] === "'") {
      const quote = selector[i];
      while (++i < selector.length) {
        if (selector[i] === '\\') i++;
        else if (selector[i] === quote) break;
      }
      continue;
    }
    if (selector[i] === '[') {
      const start = i;
      let quote = '';
      while (++i < selector.length) {
        if (selector[i] === '\\') i++;
        else if (quote && selector[i] === quote) quote = '';
        else if (!quote && (selector[i] === '"' || selector[i] === "'")) quote = selector[i] ?? '';
        else if (!quote && selector[i] === ']') break;
      }
      const attribute = selector.slice(start, i + 1);
      if (/^\[\s*role\s*=\s*(?:'tab'|"tab"|tab)\s*\]$/i.test(attribute)) return true;
      continue;
    }
    if (selector.startsWith('.eg-', i)) return true;
  }
  return false;
}

// Radix Slot composition documented by the DS (for example ListItem editorial `asChild` with one
// anchor child): the raw element is the only JSX child of a component that sets `asChild` to true.
function isSlotChild(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  const element = ts.isJsxOpeningElement(node) ? node.parent : node;
  const parent = element.parent;
  if (!parent || !ts.isJsxElement(parent)) return false;
  const opening = parent.openingElement;
  if (!/^[A-Z]/.test(opening.tagName.getText())) return false;
  const asChild = opening.attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'asChild',
  );
  if (!asChild) return false;
  const value = asChild.initializer;
  if (value && !(ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.TrueKeyword)) return false;
  const children = parent.children.filter(child => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces));
  return children.length === 1 && children[0] === element;
}

function findViolations({ file, content }: GuardSource, themeDirectory: string): GuardViolation[] {
  const found: GuardViolation[] = [];
  const add = (offset: number, snippet: string) => found.push({
    file,
    line: content.slice(0, offset).split('\n').length,
    snippet: normalize(snippet),
  });

  if (/^src\/.+\.tsx$/.test(file) && !/(?:^|\/)__tests__\/|\.(?:test|spec)\.tsx$/.test(file)) {
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          ts.isIdentifier(node.tagName) && ['button', 'input', 'a', 'label'].includes(node.tagName.text) && !isSlotChild(node)) {
        add(node.getStart(source), node.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  } else if (/^src\/.+\.css$/.test(file) && !file.startsWith(themeDirectory)) {
    postcss.parse(content, { from: file }).walkRules(rule => {
      const selector = rule.raws.selector?.raw ?? rule.selector;
      let cursor = 0;
      for (const part of postcss.list.comma(selector)) {
        const start = selector.indexOf(part, cursor);
        cursor = start + part.length;
        if (part && targetsInternal(part)) add((rule.source?.start?.offset ?? 0) + start, part);
      }
    });
  }
  return found;
}

function componentGapAnchors({ file, content }: GuardSource): { tags: string[]; comments: string[] } {
  if (!/^src\/.+\.tsx$/.test(file) || /(?:^|\/)__tests__\/|\.(?:test|spec)\.tsx$/.test(file)) return { tags: [], comments: [] };
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tags: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) tags.push(normalize(node.getText(source)));
    ts.forEachChild(node, visit);
  };
  visit(source);
  // Read comments from the trivia between parsed tokens: a bare scanner loses its place after
  // template literal substitutions or apostrophes in JSX text and swallows later comments.
  const comments: string[] = [];
  let end = 0;
  const leaves = (node: ts.Node) => {
    const children = node.getChildren(source);
    if (children.length) { children.forEach(leaves); return; }
    const start = node.kind === ts.SyntaxKind.JsxText ? node.getFullStart() : node.getStart(source);
    for (const [text] of content.slice(end, start).matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g)) {
      if (text.startsWith('//')) comments.push(text);
    }
    end = Math.max(end, node.getEnd());
  };
  leaves(source);
  return { tags, comments };
}

// Pure and copyable: callers supply source text and the issue-backed exception data.
export function checkDesignSystem(
  files: readonly GuardSource[],
  allowlist: readonly GuardAllowlistEntry[],
  { localRepo = 'nexo', themeDirectory = 'src/theme/' }: GuardOptions = {},
): GuardResult {
  const local = escapeRegExp(localRepo);
  const issuePattern = new RegExp(`^(?:egdev6\\/egdev-design-system#\\d+|${local}#\\d+|${local}#TBD-[a-z0-9]+(?:-[a-z0-9]+)*)$`);
  const pendingIssuePattern = new RegExp(`^${local}#TBD-[a-z0-9]+(?:-[a-z0-9]+)*$`);
  const errors: string[] = [];
  const used = allowlist.map(() => false);
  for (const entry of allowlist) {
    if (!issuePattern.test(entry.issue)) errors.push(`${entry.file}: invalid issue for allowlist entry ${entry.pattern}`);
    if (!entry.reason.trim()) errors.push(`${entry.file}: empty reason for allowlist entry ${entry.pattern}`);
    if (entry.kind === 'component-gap') {
      const reference = entry.comment?.match(/^\/\/ TODO\(egdev-design-system#(TBD-[a-z0-9]+(?:-[a-z0-9]+)*|\d+)\):\s*\S/);
      const id = reference?.[1];
      const issue = id && (id.startsWith('TBD-') ? `${localRepo}#${id}` : `egdev6/egdev-design-system#${id}`);
      if (!issue || issue !== entry.issue) errors.push(`${entry.file}: invalid TODO for allowlist entry ${entry.pattern}`);
    }
  }
  const violations: GuardViolation[] = [];
  for (const source of files) {
    if (allowlist.some(entry => entry.kind === 'component-gap' && entry.file === source.file)) {
      const { tags, comments } = componentGapAnchors(source);
      allowlist.forEach((entry, i) => {
        if (used[i] || entry.kind !== 'component-gap' || entry.file !== source.file) return;
        const tag = tags.indexOf(entry.pattern);
        const comment = comments.indexOf(entry.comment ?? '');
        if (tag !== -1 && comment !== -1) {
          used[i] = true;
          tags.splice(tag, 1);
          comments.splice(comment, 1);
        }
      });
    }
    for (const violation of findViolations(source, themeDirectory)) {
      const index = allowlist.findIndex((entry, i) => !used[i] && entry.kind !== 'component-gap' && entry.file === violation.file && entry.pattern === violation.snippet);
      if (index === -1) violations.push(violation);
      else used[index] = true;
    }
  }
  allowlist.forEach((entry, i) => {
    if (!used[i]) errors.push(`${entry.file}: stale allowlist entry ${entry.pattern}; remove it`);
  });
  return { violations, errors, pendingIssueCount: allowlist.filter(entry => pendingIssuePattern.test(entry.issue)).length };
}
