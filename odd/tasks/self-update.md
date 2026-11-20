# Nexo self-update (signed, Tauri updater)
> Objective: Nexo 0.2.0 (release Monday, when egdev6/nexo goes public) updates itself from signed GitHub Releases, following Antena's updater pattern. Branch: feat/self-update (from main ae3366b). Runner: Vitest (apps/hub), cargo test/clippy; native Windows update check by the maintainer.

## Specs

- S1: "Querés que Nexo se actualice solo desde la versión del lunes?" → "si". Nexo 0.2.0 must ship with the updater and its public key, so 0.2.0 installs can update to later versions without a manual reinstall.
- S2: Mechanism (maintainer accepted the recommendation): official `tauri-plugin-updater` (+ `tauri-plugin-process` if needed for relaunch), `plugins.updater.pubkey`, endpoint `https://github.com/egdev6/nexo/releases/latest/download/latest.json`, NSIS install. Reference pattern: /home/egdev/proyectos/antena (`src-tauri/tauri.conf.json` `plugins.updater`, `.github/workflows/release.yml`).
- S3: "¿Cómo busca actualizaciones Nexo?" → "Al arrancar + botón en Ajustes": "Busca al iniciar en segundo plano y avisa si hay versión nueva; el botón de Ajustes fuerza la búsqueda."
- S4: "Cuando hay una versión nueva, ¿cómo se instala?" → "Pide confirmación y reinicia": "Aviso «Hay una versión nueva» → el usuario pulsa Instalar → instalador NSIS en modo pasivo (barra de progreso, sin preguntas) y Nexo se reabre."
- S5: "¿Qué versión sale el lunes?" → "0.2.0": "Funcionalidad nueva (actualizaciones automáticas): cierro #79 y la release preparada pasa a 0.2.0."
- S6: Settings › About shows the real app version instead of the hardcoded `'0.1.0'` (`apps/hub/src/settings/index.tsx:112`).
- S7: The release workflow signs the installer and publishes `<exe>.sig` and `latest.json` (version, notes from `docs/releases/vX.md`, pub_date, `platforms.windows-x86_64.{signature,url}`) in the draft release; signing secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, created by the maintainer. The agent never reads, prints or stores the private key.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S2-S4, S6 | worker (hub: plugin, Rust commands, UI, i18n, tests) | done (585 vitest, 313 cargo tests, clippy, ds:doctor) | 1b6e0da |
| T2 | S2, S7 | worker (release workflow, Risk: item 5) | done (YAML parse, latest.json dry run, integrity simulation; actionlint unavailable) | d716675 |
| T3 | S7 | maintainer: generate key pair, add secrets, give public key | blocked | |
| T4 | S1, S5 | parent: pubkey in config, 0.2.0 bump, notes, docs (README limits, troubleshooting), close #79 | pending | |
| T5 | all | verify (Risk: items 2, 5) | pending | |
| T6 | S1, S4 | maintainer: Windows check (release 0.2.0, then a later version updates it) | pending | |

## Log

- L1 (2026-11-20, user): "liberamos nexo el Lunes. convendría dejar preparada la firma en release?" → after the explanation of updater vs Authenticode signing, "si" to "¿Querés que Nexo se actualice solo desde la versión del lunes?"
- L2 (2026-11-20, user answers): "Al arrancar + botón en Ajustes"; "Pide confirmación y reinicia"; "0.2.0".
- L3 (exploration): no self-update today; catalog update path (install_service.rs) cannot update Nexo itself (would ask itself to quit; still-running check fails). No updater/process plugins; CSP connect-src only egdev6.github.io (native updater is unaffected). release.yml:4-5 says Nexo does not self-update while the repo is private. Authenticode signing is out of scope (paid certificate, not feasible by Monday).
- L4 (T1 worker): Rust-side commands only (no webview capability); busy indicator instead of percentage progress; updater `on_before_exit` shuts down the hub IPC before the plugin launches NSIS — check recovery if the installer launch fails.
- L5 (T2 worker): kept Antena's pinned @tauri-apps/cli 2.12.3 + hash (Nexo locks 2.12.4; hash not verifiable offline); no tag-existence check, like the previous Nexo flow.
- L6 (slices): slice 1 = 1b6e0da (hub, 394 lines); slice 2 = d716675 (release workflow, own commit for Risk item 5).
