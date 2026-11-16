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
5. Pin exact versions. Each design-system bump is its own reviewed change. Use the upgrade procedure below to pack at the selected commit, vendor the archives, update the npm specifiers and lockfile, verify integrity, regenerate the reference and restart dev servers.
6. Verify browser-dependent behavior in the real Tauri WebView2 via CDP, not only in Chrome or jsdom.

The flyout frame and native window chrome, and the debug registry menu, are legitimately app-specific; they are not general-purpose design-system components.

## Packing and upgrading

From the repository root, preview and then, as a separate reviewed change, vendor a commit:

```sh
node apps/hub/scripts/ds-vendor.mjs --app apps/hub --commit <sha> --dry-run
node apps/hub/scripts/ds-vendor.mjs --app apps/hub --commit <sha>
```

The script resolves `--app` relative to the current directory and defaults the DS checkout to `../egdev-design-system`; use `--ds <path>` for another checkout. It detects supported direct dependencies and packages in vendored `file:` overrides (`ui`, `tokens`, `system`, `mcp`), or accepts a comma-separated `--packages` subset of those declarations. Node, git, pnpm, npm and `tar` must be available. The commit must be on `origin/main`. A dry run does not fetch: its ancestry check uses the locally cached remote ref, so fetch separately if that ref or commit is unavailable or stale.

For an upgrade the script fetches, checks ancestry, builds and packs in a temporary detached worktree, and removes the worktree even on failure. It tries `pnpm install --frozen-lockfile --offline` first and retries without `--offline` if needed (which can access the network). It uses `egdev-<pkg>-<version>-<dscommit>.tgz`, rewrites direct `file:` specifiers and overrides, updates lockfile paths and SHA-512 integrity from the new archives, runs `npm install --offline`, and verifies all locked vendored integrities. The same commit performs only the local ancestry and integrity checks. An npm failure restores the original manifest and lockfile, but may leave `node_modules` incomplete; repair it with `npm install --offline` in the app after resolving the failure.

For a **temporary test only**, `--allow-unmerged` permits commits outside `origin/main` and always extracts the selected archives into `node_modules/@egdev/` without changing the manifest, lockfile or vendor directory, even if the commit is merged. Revert from the app directory with `rm -rf node_modules/@egdev && npm install --offline`. Do not commit temporary results. `--dry-run` also works with this mode. Exit codes are 0 for success, 2 for invalid arguments or unmerged refusal, and 1 for operational or integrity failures.

After a real upgrade, restart the dev server with `--force` and regenerate `design/system.md` using the command in rule 4. The current generator `apps/hub/scripts/sync-design-system-md.mjs` and MCP check `apps/hub/scripts/check-design-system-mcp.mjs` hard-code the `b54222c` header; update both to the new commit in that reviewed bump before regenerating.

## Current overrides and migration

- The family-contrast overrides in `apps/hub/src/theme/family.css` (including card/header surfaces, selected tabs and the slider) are tracked by [egdev-design-system#404](https://github.com/egdev6/egdev-design-system/issues/404). Remove them as the design system provides the equivalent treatment.
- The custom runtime-accent mapping in `apps/hub/src/theme/accent.css` and legacy selectors outside `theme/` in `apps/hub/src/style.css`, `apps/hub/src/settings/settings.css` and `apps/hub/src/news/news.css` still need the issue-by-issue audit, code comments and allowlist required above. The guard and the remaining upstream requests are planned in [the adoption task](../../odd/tasks/ds-adoption.md); neither is represented as already complete here.

## Consequences

The hub and agents share one reviewable, reproducible design-system snapshot. Vendored archives and generated documentation must be updated together; gaps require upstream coordination. The MCP requires Node.js `>=24 <25` even where the rest of the frontend can run on another supported Node version.

## References

- [Design-system adoption task](../../odd/tasks/ds-adoption.md)
- Global `egdev-design-system` skill: [`~/.gentle-shell/agent/skills/egdev-design-system/SKILL.md`](file:///home/egdev/.gentle-shell/agent/skills/egdev-design-system/SKILL.md) and its `references/usar.md` use mode.
