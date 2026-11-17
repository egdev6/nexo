# Nexo

Nexo brings compatible apps together in a single hub.

## Repository layout

- `apps/hub/` — Tauri and React hub.
- `crates/nexo-catalog/` — official catalog types and validation.
- [`tauri-plugin-nexo`](https://github.com/egdev6/tauri-plugin-nexo) — public source of the shared `nexo-protocol` crate and Windows tray client, pinned by the hub at `v0.1.0`.

## Development

Install Rust stable and Node.js 22.12 or newer within the 22.x line, or 24 or newer (Vite needs 22.12+, and Vitest does not support Node 23). Design-system agent tooling requires Node.js 24.x. Running the hub requires Windows with WebView2.

From the repository root, run the Rust checks and tests:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --workspace
```

These workspace checks cover the hub and catalog. The shared protocol and tray plugin are tested in
[their public repository's CI](https://github.com/egdev6/tauri-plugin-nexo/blob/v0.1.0/.github/workflows/ci.yml).
The [protocol specification](https://github.com/egdev6/tauri-plugin-nexo/blob/v0.1.0/docs/protocol.md)
and plugin development instructions live in that repository too.

Build the frontend before running the Rust checks, since the hub embeds it. From `apps/hub`:

```sh
npm ci
npm test
npm run build
npm run app:dev
```

The hub opens as a right-anchored Windows tray flyout. Left-click its tray icon to show or hide it; the X button and Escape also hide it. It stays open when it loses focus and, as an always-on-top window, covers the right edge while you work elsewhere. Right-click the icon and choose **Salir** to quit. A second launch shows the existing panel. The tabs support arrow keys, Home and End.

The hub serves the IPC protocol for apps built with `tauri-plugin-nexo`; connected apps and their actions appear in the tray menu. For installed official apps without a plugin, Nexo detects the matching executable's process and shows whether it is open, stopped or unknown. Closing requests the same window close as the X, never forces termination, and warns if the app remains open (for example in the tray). Local apps still need to be closed from within the app. Settings persist in the app config directory. General settings include “Hide local apps” (off by default), which hides their section in My apps without affecting local app management in Settings. The catalog and its news come from the public official catalog at [`egdev6/nexo-catalog`](https://github.com/egdev6/nexo-catalog), served by GitHub Pages and cached locally; updating that repository reaches installed hubs without a Nexo release. Development and tests use sample data. Novedades opens on showing the hub when eligible official news is available and "Mostrar novedades al abrir" is on. For each eligible app, it shows at most one entry: its latest news from the last 30 days, or an app entry if none falls in that window. The flyout always fills the height of the work area, does not resize and scrolls when necessary.

## Design system

The hub uses vendored EGDEV design-system packages and exposes their MCP server to agents. Preview an update from the repository root with:

```sh
node apps/hub/scripts/ds-vendor.mjs --app apps/hub --commit <sha> --dry-run
```

Omit `--dry-run` to perform a separately reviewed upgrade; the default DS checkout is `../egdev-design-system` (override with `--ds <path>`). The script checks the commit against `origin/main`, vendors the selected packages and verifies lockfile integrity. Dry runs use the locally cached remote ref and do not fetch. `--allow-unmerged` is temporary testing only and changes `node_modules` rather than vendored files; the script prints the revert command. After an upgrade, restart the dev server with `--force` and regenerate `design/system.md`. See [ADR 0001](docs/decisions/0001-adopt-egdev-design-system.md) for prerequisites, the pinned versions, regeneration details and the full procedure.
