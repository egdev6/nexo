# ADR 0001: Adopt the EGDEV design system packages

## Status

Accepted. Adapted from [egdev-website ADR 0007](https://github.com/egdev6/egdev-website/blob/main/docs/decisions/0007-adopt-egdev-design-system-packages.md).

## Context and decision

Nexo is a Tauri 2 desktop hub with a React and Vite frontend. The hub and its agents use the same versioned [EGDEV design system](https://github.com/egdev6/egdev-design-system), rather than maintaining a second token contract and general-purpose component set. App-specific composition remains Nexo's responsibility.

The packages below are pinned to the tarballs from design-system commit `b54222c`, vendored in `apps/hub/vendor/` as `egdev-<pkg>-<version>-<dscommit>.tgz` and installed with exact `file:` specifiers. The MCP's transitive `@egdev/system` dependency is overridden to the same vendored package.

| Package | Version | Role |
| --- | --- | --- |
| `@egdev/tokens` | `0.3.0` | Visual tokens and CSS. |
| `@egdev/ui` | `0.1.0` | Shared UI components. |
| `@egdev/system` | `0.2.0` | Dev dependency supplying the generated agent reference. |
| `@egdev/mcp` | `0.2.0` | Dev dependency supplying the agents' MCP server. |

## Rules

1. Use `@egdev/ui` for shared UI and `@egdev/tokens` for visual values; do not add local tokens or components that duplicate the design system. Look up components through `@egdev/mcp` before writing JSX.
2. Request missing tokens, components or variants as issues in [egdev-design-system](https://github.com/egdev6/egdev-design-system/issues), rather than silently maintaining a parallel implementation. A temporary workaround must have an `egdev-design-system#N` comment in code and an issue-linked guard allowlist entry, with a removal condition.
3. Do not override `.eg-*` classes outside `apps/hub/src/theme/`. Existing exceptions are migration debt, not permission for new overrides.
4. `design/system.md` is generated from `@egdev/system`, not edited by hand. The sync removes the renderer's trailing space after empty anatomy arrows, without changing the content. Agents connect using the root `.mcp.json`. From the repository root, regenerate it with `node apps/hub/scripts/sync-design-system-md.mjs` after installing the hub dependencies.
5. Pin exact versions. Each design-system bump is its own reviewed change: pack at the selected commit, copy the tarballs into `apps/hub/vendor/` using the naming convention above, update the `file:` specifiers and npm override, install in `apps/hub`, verify all tarball integrity hashes against `package-lock.json`, regenerate the reference and restart dev servers.
6. Verify browser-dependent behavior in the real Tauri WebView2 via CDP, not only in Chrome or jsdom.

The flyout frame and native window chrome, and the debug registry menu, are legitimately app-specific; they are not general-purpose design-system components.

## Current overrides and migration

- The family-contrast overrides in `apps/hub/src/theme/family.css` (including card/header surfaces, selected tabs and the slider) are tracked by [egdev-design-system#404](https://github.com/egdev6/egdev-design-system/issues/404). Remove them as the design system provides the equivalent treatment.
- The custom runtime-accent mapping in `apps/hub/src/theme/accent.css` and legacy selectors outside `theme/` in `apps/hub/src/style.css`, `apps/hub/src/settings/settings.css` and `apps/hub/src/news/news.css` still need the issue-by-issue audit, code comments and allowlist required above. The guard and the remaining upstream requests are planned in [the adoption task](../../odd/tasks/ds-adoption.md); neither is represented as already complete here.

## Consequences

The hub and agents share one reviewable, reproducible design-system snapshot. Vendored archives and generated documentation must be updated together; gaps require upstream coordination. The MCP requires Node.js `>=24 <25` even where the rest of the frontend can run on another supported Node version.

## References

- [Design-system adoption task](../../odd/tasks/ds-adoption.md)
- Global `egdev-design-system` skill: [`~/.gentle-shell/agent/skills/egdev-design-system/SKILL.md`](file:///home/egdev/.gentle-shell/agent/skills/egdev-design-system/SKILL.md) and its `references/usar.md` use mode.
