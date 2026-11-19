# ADR 0001: Adopt the EGDEV design system packages

## Status

Accepted. Adapted from [egdev-website ADR 0007](https://github.com/egdev6/egdev-website/blob/main/docs/decisions/0007-adopt-egdev-design-system-packages.md).

## Context and decision

Nexo is a Tauri 2 desktop hub with a React and Vite frontend. The hub and its agents use the same versioned [EGDEV design system](https://github.com/egdev6/egdev-design-system), rather than maintaining a second token contract and general-purpose component set. App-specific composition remains Nexo's responsibility.

The packages below are pinned to the tarballs from design-system commit `fd25b9f`, vendored in `apps/hub/vendor/` as `egdev-<pkg>-<version>-<dscommit>.tgz` and installed with exact `file:` specifiers. The MCP's transitive `@egdev/system` dependency is overridden to the same vendored package.

| Package | Version | Role |
| --- | --- | --- |
| `@egdev/tokens` | `0.5.1` | Visual tokens and CSS. |
| `@egdev/ui` | `0.3.2` | Shared UI components. |
| `@egdev/system` | `0.4.2` | Dev dependency supplying the generated agent reference. |
| `@egdev/mcp` | `0.4.2` | Dev dependency supplying the agents' MCP server. |
| `@egdev/cli` | `0.1.1` | Dev dependency supplying `egdev-ds` (upgrades and `npm run ds:doctor`). |

## Rules

1. Use `@egdev/ui` for shared UI and `@egdev/tokens` for visual values; do not add local tokens or components that duplicate the design system. Look up components through `@egdev/mcp` before writing JSX.
2. Request missing tokens, components or variants as issues in [egdev-design-system](https://github.com/egdev6/egdev-design-system/issues), rather than silently maintaining a parallel implementation. A temporary workaround must have an `egdev-design-system#N` comment in code and an issue-linked guard allowlist entry, with a removal condition.
3. Do not override `.eg-*` classes outside `apps/hub/src/theme/`. Existing exceptions are migration debt, not permission for new overrides.
4. `design/system.md` is generated from `@egdev/system`, not edited by hand. The sync removes the renderer's trailing space after empty anatomy arrows, without changing the content. Agents connect using the root `.mcp.json`. From the repository root, regenerate it with `node apps/hub/scripts/sync-design-system-md.mjs` after installing the hub dependencies.
5. Pin exact versions. Each design-system bump is its own reviewed change. Use the `egdev-ds` upgrade procedure below to vendor a packed release, update the npm specifiers and lockfile, verify integrity, regenerate the reference and restart dev servers.
6. Verify browser-dependent behavior in the real Tauri WebView2 via CDP, not only in Chrome or jsdom.

The flyout frame and native window chrome, and the debug registry menu, are legitimately app-specific; they are not general-purpose design-system components.

## Packing and upgrading

Upgrade with the `egdev-ds` CLI from the design system. The DS maintainers pack a release into `../egdev-design-system/release/` (`release.json` records the commit, dirty flag and sha256 of each tarball). From the repository root, preview and then, as a separate reviewed change, apply it:

```sh
node ../egdev-design-system/packages/cli/bin/egdev-ds.mjs upgrade apps/hub --dry-run
node ../egdev-design-system/packages/cli/bin/egdev-ds.mjs upgrade apps/hub
```

The CLI copies the tarballs as `egdev-<pkg>-<version>-<dscommit>.tgz` after checking them against `release.json`, rewrites `package.json` and `package-lock.json`, runs `npm install`, verifies the lockfile, removes the previous tarballs and prints the changelog diff. Any failure rolls everything back. Then check the app from `apps/hub` with `npm run ds:doctor` (run `npm run ds:doctor -- --from ../../../egdev-design-system/release` to include the release checks); its options live in `apps/hub/egdev-ds.json` and its codes are documented in `egdev-design-system/packages/cli/README.md`.

The same `npm run ds:doctor` is the design-system guard, run in CI and by `scripts/check.sh`. It rejects raw `<button>`, `<input>`, `<a>` and `<label>` in non-test `.tsx` files under `apps/hub/src/` (except as the sole child of an `asChild` component), and `.eg-*` or `[role=tab]` selectors in CSS outside `apps/hub/src/theme/`. Exceptions go in `apps/hub/src/design-system-allowlist.ts`, each with an issue and a reason; doctor reports invalid or stale entries. It replaced the local `ds-vendor.mjs` script and `design-system-guard.ts` test.

After a real upgrade, restart the dev server with `--force` and regenerate `design/system.md` using the command in rule 4. The generator `apps/hub/scripts/sync-design-system-md.mjs` and MCP check `apps/hub/scripts/check-design-system-mcp.mjs` obtain the vendored commit from `egdev-ds status . --json` rather than hard-coding the header.

## Current overrides and migration

- The family-contrast overrides in `apps/hub/src/theme/family.css` (including card/header surfaces, selected tabs and the slider) are tracked by [egdev-design-system#404](https://github.com/egdev6/egdev-design-system/issues/404). Remove them as the design system provides the equivalent treatment.
- The custom runtime-accent mapping in `apps/hub/src/theme/accent.css` and legacy selectors outside `theme/` in `apps/hub/src/style.css`, `apps/hub/src/settings/settings.css` and `apps/hub/src/news/news.css` still need the issue-by-issue audit, code comments and allowlist required above. The guard and the remaining upstream requests are planned in [the adoption task](../../odd/tasks/ds-adoption.md); neither is represented as already complete here.

## Consequences

The hub and agents share one reviewable, reproducible design-system snapshot. Vendored archives and generated documentation must be updated together; gaps require upstream coordination. The MCP requires Node.js `>=24 <25` even where the rest of the frontend can run on another supported Node version.

## References

- [Design-system adoption task](../../odd/tasks/ds-adoption.md)
- Global `egdev-design-system` skill: [`~/.gentle-shell/agent/skills/egdev-design-system/SKILL.md`](file:///home/egdev/.gentle-shell/agent/skills/egdev-design-system/SKILL.md) and its `references/usar.md` use mode.
