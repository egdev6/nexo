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

- T1 (S1, S4, S5, S6) Draft `docs/protocol.md` — inline — commit: 31c6669 (slice 1) — done (approved L5)
- T2 (S2, S3) `crates/nexo-protocol` types + round-trip and unknown-version tests — inline, test-first — commit: 231c18c (slice 2) — done
- T3 (S1-S7) Close: check acceptance criteria, PR — inline — commit: this one — done; push and PR are the maintainer's decision

## Log

- L1 (user, 2026-11-13): "si" — start #1 after roadmap publication ("Siguiente paso: empezar por #1, el protocolo…").
- L2: Issue #1 assigned to egdev6 and verified; branch feat/1-protocol-v1.
- L3: Evidence: Quorb and Antena use Tauri 2 with `tray-icon`, `tauri-plugin-single-instance`, `tauri-plugin-updater` (GitHub `latest.json`), NSIS installer.
- L4: T1 draft committed as "docs: draft IPC protocol v1 between hub and apps" on feat/1-protocol-v1; review questions listed in docs/protocol.md §10.
- L5 (user, 2026-11-13): "si" — approves the draft as is, including the five decisions in §10 (heartbeat_ack, action, register without level, 5 s × 3 beats, 10 s quit with no kill).
- L6: RED observed: tests did not compile against an empty crate (unresolved imports). GREEN: `cargo test -p nexo-protocol` 34 passed (18 messages, 16 rules); clippy -D warnings clean; fmt clean. Every single-line JSON example in docs/protocol.md appears verbatim in tests/messages.rs.
- L7: Slice boundary: slice 1 = docs (31c6669), slice 2 = crate + tests (231c18c). RDD assess: medium, reviewDue false (under budget); writer self-verification stands.
- L8: Verdicts: S1 covered (§2 discovery, §4 examples, §5 negotiation, §6 heartbeat and icon recovery); S2 covered (one round-trip per documented message, 18 tests); S3 covered (`ProtocolError::UnsupportedVersion`, 3 tests); S4 covered (§7); S5 covered plus approved additions `heartbeat_ack`, `action`, `welcome`, `registered`, `reject`, `quit_result`, `bye`; S6 covered (§5, §6, §8); S7 respected (no transport, hub, plugin or catalog code).
