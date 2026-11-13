# Nexo

Nexo brings compatible apps together in a single hub.

## Repository layout

- `apps/hub/` — Tauri and React hub.
- `crates/nexo-protocol/` — shared protocol types.
- `crates/tauri-plugin-nexo/` — plugin skeleton for compatible apps.

## Development

Install Rust stable and Node.js 22 or newer. Running the hub requires Windows with WebView2.

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

The hub icon is a temporary placeholder, not the final Nexo logo.
