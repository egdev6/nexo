# Catalog v4: apps, versions and news per operating system
> Objective: Nexo 0.2.0 (draft release, launch Monday 2026-11-23) reads a v4 catalog where each app declares per-platform installers, and shows only the apps, news and updates of the platform it runs on. Issue #83. Branches: feat/catalog-v4 in egdev6/nexo-catalog and egdev6/nexo. Runner: catalog validate.yml (jsonschema), Vitest, cargo test/clippy (Linux + native Windows).

## Specs

- S1: "Cada sistema operativo debería de coordnar sólo las nuevas versiones de su sistema operativo ligado al instalador de cada una no? en windows, windows. en macOS macOS. en linux linux. [...] cuando digo versiones, también me refiero a las apps del catálogo. Por ej: antena está sólo en windows, asi que en nexo MacOS no debería mostrarse."
- S2: "la 0.2.0 ya está publicada. Podríamos hacer esa implementación para la salida?" / "miento, tengo la 0.2.0 en borrador. Podríamos completarla con eso?" / "yo me arriesgaría tenemos 2 dias" — the v4 support ships in 0.2.0.
- S3 (design accepted from #83): v4 app = common fields (`id`, `name`, `tagline`, `description`, `tags`, `iconUrl`/`artUrl`, `integrationLevel`, `featured`, `links`, `news`) + `platforms`: an object with at least one entry, keyed by Tauri updater targets `^(windows|darwin|linux)-(x86_64|aarch64|i686|armv7)$` (e.g. `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`). Each platform entry: `installerUrl` and `latestJsonUrl` (egdev6 GitHub release assets, as v3), `version` (semver), `releasedAt` (timestamp), optional `updaterPublicKey`, and optional `detection` — `detection` uses the existing Windows hint shape (`displayName`, `publisher`, `executableRelativePath`) and is allowed only on `windows-*` keys. A keyed `windows-x86_64` entry must point to a per-user NSIS `_x64-setup.exe` (same rule as v3).
- S4: The hub resolves its own platform key at runtime (Rust: target OS + arch mapped to the same keys) and only shows apps with an entry for that key; their news, install, update and detection use that entry. Apps without an entry for the current platform are hidden everywhere (catalog, Mis apps catalog matching, Novedades, update checks).
- S5: The catalog keeps publishing `catalog.json`, `v2/` and `v3/` unchanged for installed Nexo 0.1.x; v4 lives at `v4/catalog.json` (`https://egdev6.github.io/nexo-catalog/v4/catalog.json`). Nexo 0.2.0 reads only v4.
- S6: Today every app is Windows-only: Antena and Quorb get a single `windows-x86_64` entry carrying their current v3 values.
- S7 (parent contract, decided 2026-11-21, shared by T2a and T2b):
  - v4 is a wire format only. Both Rust (`crates/nexo-catalog`) and TypeScript (`apps/hub/src/catalog/format.ts`) validate a v4 document and then **project** it for one platform key into the existing flat catalog shape: `schemaVersion: 4`, apps without an entry for that key dropped, the entry's `installerUrl`, `latestJsonUrl`, `version`, `releasedAt`, `updaterPublicKey` copied to app level, and the entry's flat `detection` wrapped as `detection: { windows: ... }`. Every existing consumer keeps reading the flat shape; checks that today mean "v3 release-asset catalog" (`schemaVersion === 3` / `== 3`) now mean v4.
  - v4 domain rules = schema v4 (copied from egdev6/nexo-catalog `catalog.schema.json`, PR #11) + existing domain checks applied per entry: release-asset URLs as v3, updater key decoding as v3, dates, semver, unique app and news ids, detection rules as v2/v3 hints. Platform key regex `^(windows|darwin|linux)-(x86_64|aarch64|i686|armv7)$`; `detection` only on `windows-*`.
  - Shared corpus: `crates/nexo-catalog/fixtures/v4.json` + `fixtures/parity-v4.json` (cases with patches; `projections` = expected flat catalog per platform key). Both test suites must pass it unchanged; do not edit these two files.
  - Runtime platform key: Rust helper mapping `std::env::consts::OS` (`windows`, `macos`→`darwin`, `linux`) and `ARCH` (`x86_64`, `aarch64`, `x86`→`i686`, `arm`→`armv7`) to the key; unsupported → no key, every app hidden. Exposed to the frontend by Tauri command `platform_key` → `string | null`.
  - Endpoint `https://egdev6.github.io/nexo-catalog/v4/catalog.json` is the only one 0.2.0 fetches (Rust install feed and TS loader). Cache: one v4 cache file read by command `read_catalog_v4_cache` → `string | null` (raw v4 text); `write_catalog_cache` accepts only a valid v4 document. Commands `read_catalog_cache`, `read_catalog_v2_cache`, `read_catalog_v3_cache` and the v1/v2/v3 fallback chain are removed; old cache files are ignored.
  - The flat (v1–v3) parser stays in the crate as the internal projected model and for existing fixtures; the hub never fetches or caches v1–v3.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S3, S5, S6 | parent (nexo-catalog: schema v4, v4/catalog.json, validate.yml, README) | done: 4 files valid, 6 invalid cases rejected, darwin-only app accepted; rebased on Antena 0.18.0 (#10) and v4 resynced | nexo-catalog PR #11 |
| T2a | S3, S4, S5, S7 | worker: Rust (crates/nexo-catalog v4 + projection + schema copy, src-tauri platform key, install feed v4, v4 cache + commands, docs/catalog.md) | done: cargo fmt/clippy/test green; Windows MSVC unverified locally | 4e62aac, de007af |
| T2b | S3, S4, S5, S7 | worker: TypeScript (format.ts v4 + projection, loader v4 only, platform_key invoke, schemaVersion checks, i18n `install.v3Required`, tests) | done: 612 vitest, tsc, build, ds:doctor green | 8394e02 (docs 2672ce0) |
| T3 | S2 | parent: release notes, rebuild 0.2.0 (maintainer deletes draft and reruns Release) | pending | |
| T4 | all | verify | pending | |

## Log

- L1 (2026-11-21, user): S1 question → issue #83 created as proposal (roadmap v1.12).
- L2 (2026-11-21, user): S2. Parent recommended shipping 0.2.0 as is (self-update lets v4 arrive in 0.3.0); maintainer chose to include it: "yo me arriesgaría tenemos 2 dias".
- L4 (2026-11-21, user): "pr de T1" → nexo-catalog PR #11 opened after rebasing on #10 (Antena 0.18.0) and resyncing v4.
- L5 (2026-11-21, user): "si" → start T2. Parent fixed contract S7 and wrote the shared v4 corpus; the corpus exposed a schema bug in PR #11 (darwin/linux entries matched patternProperties and skipped platformEntry), fixed in nexo-catalog 9ee8a98.
- L6 (2026-11-21, evidence): T2a done (Rust; Windows MSVC clippy not runnable on this host: ring needs lib.exe). T2b first attempt blocked: worker ran pnpm in an npm project (package-lock.json, CI `npm ci`); parent restored with `npm ci`. Parent removed a TS-only NSIS check that rejected the whole v4 catalog for one non-NSIS windows-x86_64 entry (Rust and v3 enforce it at install selection); pinned in both languages. Native install stays Windows/NSIS-only (release builds Windows NSIS only), so darwin/linux entries are display-only.
- L7 (2026-11-21, evidence): T2 committed in 4 slices (~2.1k lines incl. tests and docs, past the ~400-line slice; delivery shape decided at publish: single PR or chained).
- L3 (state): 0.2.0 is a draft (built from 3e17ef8, signed, valid signature with key B9313A349CF8A2BD). Releases "latest" is still v0.1.4 because drafts cannot be latest.
