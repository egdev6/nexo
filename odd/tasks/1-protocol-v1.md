# Protocol v1 between the hub and the apps (#1)

Defines the IPC contract between the Nexo hub and apps using tauri-plugin-nexo: a design doc plus the `nexo-protocol` crate.
Source of scope: https://github.com/egdev6/nexo/issues/1 (original body, roadmap proposal nexo-roadmap-v1).

## Specs

- S1: "`docs/protocol.md` describe el descubrimiento, cada mensaje con ejemplo, la negociación de versión, el heartbeat y la recuperación del icono si cae el hub."
- S2: "`nexo-protocol` serializa y deserializa cada mensaje del documento, con un test de ida y vuelta por mensaje."
- S3: "Un mensaje con una versión de protocolo desconocida produce un error tipado, no un panic."
- S4: "La política de compatibilidad entre versiones queda documentada."
- S5: Scope messages: "`hello` (negociación de versión y capacidades), `register` (id de la app, nombre, versión, nivel de integración), `menu` (acciones que la app expone en el menú del hub), `show`, `quit` (cierre limpio solicitado por el hub), `heartbeat` y `unified` (el hub le indica a la app si debe ocultar su icono)."
- S6: Rules: "qué pasa si las versiones del hub y la app no coinciden, timeouts del heartbeat, y quién gana si la app tiene "minimizar a bandeja" mientras está unificada."
- S7: Exclusions: "implementación del transporte, del hub y del plugin (I3, I4), y el formato del catálogo (I5)."

## Tasks

- T1 (S1, S4, S5, S6) Draft `docs/protocol.md` — inline — commit: see L4; status: draft written, awaiting maintainer approval
- T2 (S2, S3) `crates/nexo-protocol` types + round-trip and unknown-version tests — inline, test-first — commit: pending; blocked on T1 approval
- T3 (S1-S7) Close: check acceptance criteria, PR — inline — commit: pending

## Log

- L1 (user, 2026-11-13): "si" — start #1 after roadmap publication ("Siguiente paso: empezar por #1, el protocolo…").
- L2: Issue #1 assigned to egdev6 and verified; branch feat/1-protocol-v1.
- L3: Evidence: Quorb and Antena use Tauri 2 with `tray-icon`, `tauri-plugin-single-instance`, `tauri-plugin-updater` (GitHub `latest.json`), NSIS installer.
- L4: T1 draft committed as "docs: draft IPC protocol v1 between hub and apps" on feat/1-protocol-v1; review questions listed in docs/protocol.md §10.
