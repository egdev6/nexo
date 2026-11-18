# Design system adoption III: close the remaining exceptions and theme the accent through the DS

Import the last DS deliveries for Nexo's requests (#415, #416, #418, #425/#426 with epic #404, and #458), remove the five remaining guard exceptions, and move the accent and family contrast theming from Nexo's own CSS to the DS tokens and helper wherever they cover it.
Status: done — T1–T7 complete; delivered in #62 and #63, closed on chore/ds-adoption-3-close.

## Specs

- S1 (request, verbatim): "han habido más cambios en el design system de las peticiones que hicimos. puedes revisarlas?"
- S2 (upstream state, 2026-11-17): DS origin/main is `846c0d6`, with all of Nexo's requests closed: #415 (PR 460, runtime accent helper `createAccentTheme` from `@egdev/tokens/accent`), #416 (PR 457, `ColorSwatchGroup`), #418 (PR 461, `Panel accentEdge="start"`), #425 and #426 (PR 459, semantic contrast roles, adopted by default in Switch, Slider, RadioGroup, Tabs, Input and Link), #458 (PR 462, `DialogContent headerLayout="stacked"`), plus a Slider coarse-pointer hit area. Versions bump to tokens 0.4.0, ui 0.2.0, system 0.3.0 and mcp 0.3.0, so the vendored tarball names change. No prop or token Nexo uses was renamed or removed.
- S3 (baseline): 5 guard exceptions (#416 ×3, #418, #404); adoption 91.08 % by JSX instance (95.89 % interactive); `theme/accent.css` redeclares about 60 tokens and `theme/family.css` holds the family contrast scheme.
- S4 (target):
  - Zero guard exceptions.
  - `accent.css` reduced to what the DS helper does not cover (Nexo-only primitives, the logo, floods and glows).
  - `family.css` reduced to the app's card and preview surfaces.
  - Report adoption before and after each slice.
- S5 (rules): the skill and ADR 0001. Each DS bump is its own reviewed change, and the maintainer checks every visible change on the running app.

## Tasks

- T1 (S2) Vendor DS `846c0d6` with `ds-vendor.mjs` (the version change in the tarball names is supported). Update the pinned headers, regenerate `design/system.md`, and run the tests. Visual check: the new segmented-tab selected style (`border-brand` and tint) and the touch targets. Route: inline. Status: done (4bf732e).
- T2 (S4) `Panel variant="banded" accentEdge="start"` in settings. Remove the #418 entry, its TODO and the `border-left` rule. Route: writer, test-first, visual check. Status: done (a00831c).
- T3 (S4) The accent picker on `ColorSwatchGroup` (presets as `options`, `customLabel` for the custom color input). Remove the three #416 entries; the tones and the reset button stay app-owned. Route: writer, test-first, visual check. Status: done (a00831c).
- T4 (S2) The add-local dialog uses `headerLayout="stacked"`: title on the first line, description on the second (the maintainer's request in ds-adoption-2 L5). Route: writer, test-first, visual check. Status: done (a00831c).
- T5 (S4) Tabs and family contrast: drop the selected-tab shadow override (#404 entry) and move the tab, slider and link rules in `family.css` to the DS roles or the new defaults (depends on Q1). Route: writer, test-first, visual check. Status: done (a00831c, 868105f).
- T6 (S4) Runtime accent: apply `createAccentTheme(accent).variables` to the flyout scope and to the portalled dialog content, and trim `accent.css` and its tests to what stays app-specific. Split into two slices if it grows (depends on Q2). Route: writer, test-first, visual check. Status: done (a00831c, 868105f).
- T7 (S4) Close: run the audit, update the skill with what was learned, prepare a Nexo test release, and comment on the DS requests with the adoption. Route: inline. Status: done (ba44728 report; skill egdev-design-system v1.3; DS comments on #415, #416, #418, #425, #426, #458, #464, #465, #466; release notes folded into v0.1.3).

## Open questions

- Q1 (resolved, L2): adopt the DS selected-tab look.
- Q2 (resolved, L2): adopt the DS accent behaviour (lightened to 4.6:1, black ink).

## Log

- L1 (verbatim): "han habido más cambios en el design system de las peticiones que hicimos. puedes revisarlas?"
- Evidence: a read-only map of DS `846c0d6` against Nexo (2026-11-17), with issue and PR states read through `gh`. The exact per-commit diff was not inspected.
- L2: the maintainer chose "El del design system" for the selected tab (Q1) and "Comportamiento del design system" for the custom accent (Q2).
- L3 (verbatim): "dale" — plan approved.
- L4 (verbatim): "me gustaba más la otra variante, no la mantuvo el design system?" / "lo mismo con el selector de color, me gustaba más el otro." / "demasiado separados" / "En el slider salió un cuadrado rojo feo nada más empezar pregunta si es normal" — the maintainer chose to request the adjustments upstream: egdev-design-system#464 (outline selected segmented tab), #465 (neutral ColorSwatchGroup ring), #466 (tighter stacked Dialog header). Nexo keeps the DS look meanwhile (no exceptions). Slider red square under investigation.
- Resume point (2026-11-17): branch `feat/ds-adoption-3` holds T1 (4bf732e) plus the integrated T2–T6 batch: allowlist empty, adoption 92.42 % (100 % interactive), 590 tests, accent.css down to 46 lines. Pending: (1) the maintainer's screenshot of the Slider "red square" (CDP could not reproduce it: static and pressed/focused states look correct); (2) T7: add ColorSwatchGroup to the adoption report's interactive list, run check.sh --windows, update the skill, open the PR, comment on the DS issues, prepare a test release; (3) adopt #464, #465 and #466 when the DS ships them. Nexo 0.1.3 is ready on main but not launched.
- L5 (verbatim, 2026-11-18): "mira el cuadrado que te dije" / "se puede centrar el texto de los tabs?" — the red square was the carousel focus ring shown on the dialog's automatic entry focus; now hidden until keyboard use or focus leaves (news/index.tsx, news.css, rounded). Tabs: user chose to drop `labelWrap` on the settings tabs (centered, single line like the main tabs) over an upstream request. DS bumped to 62a1a52 (tabs `variant="outline"`), canvas generator repaired after #36 drift.
- L6 (verbatim, 2026-11-18): "si" / "si tienes aplicado ya lo ultimo podemos hacer prs" — the DS re-released as e712915 (Link default look, DS #475) was the missing request; adopted in 22d0343 together with outline social links in app details and the author card (149e29f, user comments) and canvas fixes (380f86e: artboards blank since #36 because of the waiting motion class; the canvas-only radio fill covered SelectTile labels). Delivery: two chained PRs — PR A = b124465..a00831c (plan, DS 846c0d6, T2–T6); PR B = 868105f..380f86e (DS 62a1a52 and e712915, outline tabs and links, news focus ring, canvas) plus this note. T7 follow-ups stay open: add ColorSwatchGroup to the adoption report's interactive list, update the egdev-design-system skill, comment on the DS requests, prepare a test release.
- L7 (verbatim, 2026-11-18): "borra worktrees y ramas mergeadas u obsoletas" / "para el proceso de ;1440" / "seguimos con T7" — #62 and #63 merged; worktrees, merged branches and the stale remote branch deleted; Vite stopped. T7: ColorSwatchGroup counted as interactive (92.45 %, 100 % interactive), skill v1.3 (backup ~/.local/state/skill-backups/2026-11-18), nine DS issue comments, and the user chose to fold the release notes into the unreleased v0.1.3.
