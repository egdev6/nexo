# Visible startup failures and single-instance handoff

> Branch `fix/startup-log`. Follow-up of hub-ux-polish: a launch could exit silently.

## Specs

- S1 (verbatim, parent proposal approved with "si"): "Agregar un log de arranque a un archivo en `%LOCALAPPDATA%` y avisar cuando el arranque le pasa el control a otra instancia. Así, cualquier cierre inesperado deja rastro. Es una mejora chica, la tomo con tests y no requiere crates nuevos."
- Evidence: `tauri-plugin-single-instance` 2.5.5 (`apps/hub/src-tauri/src/lib.rs:577`) exits with code 0 after handing off to a window `es.egdev.nexo-sic` found through mutex `es.egdev.nexo-sim`, waiting up to 10 s (`FORWARD_TIMEOUT_MS`); its warnings use `tracing::warn!` and no subscriber exists; `.expect` at `lib.rs:711` panics on setup errors.

## Tasks

- T1 (S1) Startup log file + handoff notice + setup-error reporting — route: writer, test-first; status: authorized.

## Log

- L1 (verbatim): "si" — to "¿Hago la mejora del log después de confirmar la causa?" after the parent explained the single-instance handoff and proposed the startup log.
