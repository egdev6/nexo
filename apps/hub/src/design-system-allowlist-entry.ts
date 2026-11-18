// Shape of a design-system guard allowlist entry, as read by `egdev-ds doctor`
// (see the GuardAllowlistEntry typedef in @egdev/cli/src/guard.mjs).
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
