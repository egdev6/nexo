# Upgrade @egdev/cli to 0.3.0 and resolve the new doctor checks (apps/hub)
Branch: `chore/ds-cli-0.3.0` from `main` (2e74b33). One PR: DS upgrade + `egdev-ds init` + resolution of the new DS046/DS047/DS048 findings (precedent #78). Lands before the Nexo 0.2.1 release (launch Monday 2026-11-23).
Risk: item 5 (dev dependency / CI gate); item 6 for UI changes made to satisfy DS046 (visual regressions not covered by tests).

## Specs

- S1 (DS session notice, 2026-11-22): "@egdev/cli 0.3.0 (release limpia en ../egdev-design-system/release, commit 4a8c093, dirty false). El resto del set no cambia de versión (tokens 0.6.1, ui 0.7.0, effects 0.2.7, system 0.8.0, mcp 0.4.7)." doctor adds DS046 (an app class on a DS component changes its appearance or layout beyond margins/alignment), DS047 (an app selector reaches into a DS component's internal markup), DS048 (app code queries DS markup: `.eg-*` in querySelector/closest/matches/classList); `egdev-ds init` writes a marked block with the DS rules for agents into AGENTS.md.
- S2: "En una rama aparte, actualizar con egdev-ds upgrade desde ../egdev-design-system/release y correr egdev-ds init (añade el bloque de AGENTS.md)."
- S3: "Correr ds:doctor (y ds:doctor --fail-on-pending) y resolver cada hallazgo con el flujo: si el DS ya tiene API para eso, usarla; si no, abrir un "Consumer request" en egdev6/egdev-design-system ... describiendo la necesidad, sin proponer la solución, y mitigar solo componiendo piezas del DS con // TODO(egdev-design-system#N) y una entrada en src/design-system-allowlist.ts con ese issue."
- S4: "No editar vendor/, egdev-ds.json ni las entradas @egdev del lockfile a mano."
- S5: Expected on 2e74b33: 8 DS046 findings (padding on Tabs, columns on SelectTile, width on Button, transform on Icon, wrapping on Text, among others), no DS047/DS048.
- S6 (user): timing "Hoy, antes del lanzamiento"; AGENTS.md "En la raíz del repo (Recomendado)".

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S2, S4, S6 | parent: `egdev-ds upgrade` + `init`, AGENTS.md at repo root, regenerate design/system.md | pending | |
| T2 | S3, S5 | classify each finding: existing DS API vs consumer request | pending | |
| T3 | S3 | resolve findings (API fixes; mitigations with TODO + allowlist after consumer requests exist) | pending | |
| T4 | all | verify: ds:doctor (+ --fail-on-pending), biome ci, tests, tsc, build, visual check of touched screens | pending | |

## Log

- L1 (2026-11-22, DS session → Nexo): notice quoted in S1-S5; each publishing or repo-modifying step needs Enrique's authorization.
- L2 (2026-11-22, user): "Hoy, antes del lanzamiento"; AGENTS.md at the repo root.
