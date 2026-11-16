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

const issuePattern = /^(?:egdev6\/egdev-design-system#\d+|nexo#\d+|nexo#TBD-[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const pendingIssuePattern = /^nexo#TBD-[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
        else if (!quote && (selector[i] === '"' || selector[i] === "'")) quote = selector[i];
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

function findViolations({ file, content }: GuardSource): GuardViolation[] {
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
          ts.isIdentifier(node.tagName) && ['button', 'input', 'a', 'label'].includes(node.tagName.text)) {
        add(node.getStart(source), node.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  } else if (/^src\/.+\.css$/.test(file) && !file.startsWith('src/theme/')) {
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

// Pure and copyable: callers supply source text and the issue-backed exception data.
export function checkDesignSystem(files: readonly GuardSource[], allowlist: readonly GuardAllowlistEntry[]): GuardResult {
  const errors: string[] = [];
  const used = allowlist.map(() => false);
  for (const entry of allowlist) {
    if (!issuePattern.test(entry.issue)) errors.push(`${entry.file}: invalid issue for allowlist entry ${entry.pattern}`);
    if (!entry.reason.trim()) errors.push(`${entry.file}: empty reason for allowlist entry ${entry.pattern}`);
  }
  const violations: GuardViolation[] = [];
  for (const source of files) {
    for (const violation of findViolations(source)) {
      const index = allowlist.findIndex((entry, i) => !used[i] && entry.file === violation.file && entry.pattern === violation.snippet);
      if (index === -1) violations.push(violation);
      else used[index] = true;
    }
  }
  allowlist.forEach((entry, i) => {
    if (!used[i]) errors.push(`${entry.file}: stale allowlist entry ${entry.pattern}; remove it`);
  });
  return { violations, errors, pendingIssueCount: allowlist.filter(entry => pendingIssuePattern.test(entry.issue)).length };
}
