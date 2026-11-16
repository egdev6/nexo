# Design system adoption (Nexo pilot of the `egdev-design-system` skill)

Raise `@egdev/ui` adoption in the hub and turn each step into a mode of a reusable global skill, so every egdev app adopts the design system the same way. Nexo is the pilot; the website, Antena and Quorb come later, as separate work.
Status: approved (L4).

## Specs

- S1 (goal, verbatim): "La idea del design system es que un alto porcentaje de los componentes que la construyen estén o se usen desde el design system."
- S2 (skill, verbatim): "La ide de esto es conseguir montar una skill o varias que faciliten el uso del design system en todas las apps creadas. Por lo que lo que hagamos en este proceso habría que plantearlo como mejora de este flujo y llevarlo en el futuro a los otros. Tenlo muy presente."
- S3 (website pilot, verbatim): "El flujo más o menos ya estábamos probándolo en la website". Reuse its policy (egdev-website ADR 0007): no local tokens or components; report gaps upstream as egdev-design-system issues; pin exact versions; every version bump is its own reviewed change; every temporary workaround carries a `#issue` comment.
- S4 (approved shape, L3): one global skill `egdev-design-system` with five modes:
  - **adopt/upgrade**: pack the DS at a commit, vendor the tarballs, fix the lockfile integrity, restart dev servers. Idempotent.
  - **use**: the S3 rules as agent instructions, plus looking components up through `@egdev/mcp` before writing JSX.
  - **audit**: adoption percentage and drift, reusing `auditar-ui` with the DS as its source of truth (no hand-written profile).
  - **request**: upstream issue template for missing components or variants, plus an override registry where each override has its issue and a removal condition.
  - **guard**: a copyable test that fails on raw elements or `.eg-*` overrides outside an allowlist tied to issue numbers.
- S5 (baseline, audit 2026-11-16): about 40 % adoption by distinct UI pattern today, about 62 % after direct swaps, about 86 % with DS variants. Interactive controls are already about 95 %. Each slice reports the new percentage with the audit mode.

## Tasks

- T1 (S2, S4) Create the skill skeleton `egdev-design-system` under `~/.gentle-shell/agent/skills/` with the **use** mode: the S3 rules and the MCP lookup step. Route: skill-creator. Status: pending.
- T2 (S3, S4) Nexo policy and wiring: decision record `docs/decisions/0001-adopt-egdev-design-system.md` adapted from website ADR 0007, `@egdev/mcp` wired for agents, and `design/system.md` generated from the DS. Feeds the **use** mode. Route: inline. Status: pending.
- T3 (S4, S5) Guard in Nexo: a vitest test that fails on raw `<button>`, `<input>`, `<a>`, `<label>`, and on `.eg-*` or `[role=tab…]` selectors outside `theme/`, with an allowlist where each entry names its issue (#404 and the new ones). The test fails first on a new violation (RED), and today's violations go into the allowlist. Becomes the **guard** mode. Route: inline, test-first. Status: pending.
- T4 (S4, S5) Adoption metric: a script that reports the percentage of DS components versus custom ones and lists open workarounds. Feeds the **audit** mode together with `auditar-ui`. Route: inline. Status: pending.
- T5 (S1) Direct swaps, slice N1 (low risk): `Notice` for notices and inline errors, `Link`, `StatusDot`, `PageHeader` for section labels, `SectionHeader` for the first-run intro. Remove their allowlist entries. Route: writer, test-first. Status: pending.
- T6 (S1) Direct swaps, slice N2: `Panel variant="banded"` for settings groups (drops `family.css:43-53`), `AlertDialog` for the delete confirmation, and inline `Notice` for ephemeral messages (Q1). Route: writer, test-first. Status: pending.
- T7 (S4) Upstream gaps with the **request** mode: issues in egdev-design-system for:
  - a Collapsible row with an actions slot;
  - Dialog `container`;
  - AppIcon or square Avatar with initials;
  - Switch and Checkbox with `label` and `description`;
  - Text muted and status tones;
  - PageHeader leading action;
  - RadioGroup tile;
  - Tabs `fullWidth`;
  - runtime accent theming (replaces `theme/accent.css`);
  - `ColorSwatchGroup` (Q3: Quorb and Nexo both use accent swatches);
  - MCP `get_component` usage examples.

  Each issue gets an override-registry entry. Route: inline; publishing the issues needs the maintainer's approval. Status: pending.
- T8 (S4) **adopt/upgrade** mode: script the pack, vendor, lockfile-integrity and restart steps done by hand for 9679f86 and b54222c, with the Q2 vendor naming: `egdev-<pkg>-<version>-<dscommit>.tgz`. Route: inline. Status: pending.
- T9 (S4) **audit** mode: point `auditar-ui` at the DS source (MCP or tarballs) instead of a hand-written profile, and validate it on Nexo against S5. Route: inline. Status: pending.
- T10 (S2) Close: final skill document, the measured adoption after T5 and T6, and a rollout plan for the website, Antena and Quorb (separate work, not done here). Route: inline. Status: pending.

## Open questions

- Q1 (resolved, L4): inline `Notice`, no toasts.
- Q2 (resolved, L4): Nexo's convention `egdev-<pkg>-<version>-<dscommit>.tgz` for every app (the website adopts it later).
- Q3 (resolved, L4): upstream `ColorSwatchGroup`.

## Log

- L1 (verbatim): "he visto que nexo utiliza pocos componentes de @egdev/ui. La mayoría son custom de la app. La idea del design system es que un alto porcentaje de los componentes que la construyen estén o se usen desde el design system. Esto pòdríamos revisar como conseguirlo?"
- L2 (verbatim): "ok, termina la ronda actual. La ide de esto es conseguir montar una skill o varias que faciliten el uso del design system en todas las apps creadas. Por lo que lo que hagamos en este proceso habría que plantearlo como mejora de este flujo y llevarlo en el futuro a los otros. Tenlo muy presente. El flujo más o menos ya estábamos probándolo en la website así que termina y vemos como avanzar en esa dirección."
- L3: the maintainer approved ("si") the proposed shape (one skill, five modes, Nexo as pilot) and asked for this document before any code changes.
- Evidence: the adoption audit (2026-11-16, read-only, `auditar-ui` method) and the website pilot map. Both are summarized in Engram `nexo/ds-adoption-flow` (observation 26560).
- L4 (verbatim): "Q1 Notice / Q2 OK / Q3 Ya lo usa quorb y nexo así que si / OK al documento"
