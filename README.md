# Nexo

Nexo brings compatible apps together in a single hub.

## Repository layout

- `apps/hub/` — Tauri and React hub.
- `crates/nexo-protocol/` — shared protocol types.
- `crates/tauri-plugin-nexo/` — [Windows tray client](crates/tauri-plugin-nexo/README.md) for compatible apps.

## Development

Install Rust stable and Node.js 22.12 or newer within the 22.x line, or 24 or newer (Vite needs 22.12+, and Vitest does not support Node 23). Design-system agent tooling requires Node.js 24.x. Running the hub requires Windows with WebView2.

From the repository root, run the Rust checks and tests:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --workspace
```

Build the frontend before running the Rust checks, since the hub embeds it. From `apps/hub`:

```sh
npm ci
npm test
npm run build
npm run app:dev
```

The hub opens as a right-anchored Windows tray flyout. Left-click its tray icon to show or hide it; Escape or losing focus also hides it. Right-click the icon and choose **Salir** to quit. A second launch shows the existing panel. The tabs support arrow keys, Home and End.

The hub serves the IPC protocol for apps built with `tauri-plugin-nexo` and lists them with their running state; their actions appear in the tray menu. Settings persist in the app config directory. The catalog and its news come from the public official catalog at [`egdev6/nexo-catalog`](https://github.com/egdev6/nexo-catalog), served by GitHub Pages and cached locally; updating that repository reaches installed hubs without a Nexo release. Development and tests use sample data. Novedades opens on showing the hub only when there are unseen official news from the last 30 days and "Mostrar novedades al abrir" is on. Install, update and open actions are not available yet. The flyout always fills the height of the work area, does not resize and scrolls when necessary.

## Design system

The hub uses vendored EGDEV design-system packages and exposes their MCP server to agents. Preview an update from the repository root with:

```sh
node apps/hub/scripts/ds-vendor.mjs --app apps/hub --commit <sha> --dry-run
```

Omit `--dry-run` to perform a separately reviewed upgrade; the default DS checkout is `../egdev-design-system` (override with `--ds <path>`). The script checks the commit against `origin/main`, vendors the selected packages and verifies lockfile integrity. Dry runs use the locally cached remote ref and do not fetch. `--allow-unmerged` is temporary testing only and changes `node_modules` rather than vendored files; the script prints the revert command. After an upgrade, restart the dev server with `--force` and regenerate `design/system.md`. See [ADR 0001](docs/decisions/0001-adopt-egdev-design-system.md) for prerequisites, the pinned versions, regeneration details and the full procedure.
