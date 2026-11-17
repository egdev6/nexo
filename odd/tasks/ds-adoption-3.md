# Design system adoption III: close the remaining exceptions and theme the accent through the DS

Import the last DS deliveries for Nexo's requests (#415, #416, #418, #425/#426 with epic #404, and #458), remove the five remaining guard exceptions, and move the accent and family contrast theming from Nexo's own CSS to the DS tokens and helper wherever they cover it.
Status: approved (L3).

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

- T1 (S2) Vendor DS `846c0d6` with `ds-vendor.mjs` (the version change in the tarball names is supported). Update the pinned headers, regenerate `design/system.md`, and run the tests. Visual check: the new segmented-tab selected style (`border-brand` and tint) and the touch targets. Route: inline. Status: pending.
- T2 (S4) `Panel variant="banded" accentEdge="start"` in settings. Remove the #418 entry, its TODO and the `border-left` rule. Route: writer, test-first, visual check. Status: pending.
- T3 (S4) The accent picker on `ColorSwatchGroup` (presets as `options`, `customLabel` for the custom color input). Remove the three #416 entries; the tones and the reset button stay app-owned. Route: writer, test-first, visual check. Status: pending.
- T4 (S2) The add-local dialog uses `headerLayout="stacked"`: title on the first line, description on the second (the maintainer's request in ds-adoption-2 L5). Route: writer, test-first, visual check. Status: pending.
- T5 (S4) Tabs and family contrast: drop the selected-tab shadow override (#404 entry) and move the tab, slider and link rules in `family.css` to the DS roles or the new defaults (depends on Q1). Route: writer, test-first, visual check. Status: pending.
- T6 (S4) Runtime accent: apply `createAccentTheme(accent).variables` to the flyout scope and to the portalled dialog content, and trim `accent.css` and its tests to what stays app-specific. Split into two slices if it grows (depends on Q2). Route: writer, test-first, visual check. Status: pending.
- T7 (S4) Close: run the audit, update the skill with what was learned, prepare a Nexo test release, and comment on the DS requests with the adoption. Route: inline. Status: pending.

## Open questions

- Q1 (resolved, L2): adopt the DS selected-tab look.
- Q2 (resolved, L2): adopt the DS accent behaviour (lightened to 4.6:1, black ink).

## Log

- L1 (verbatim): "han habido más cambios en el design system de las peticiones que hicimos. puedes revisarlas?"
- Evidence: a read-only map of DS `846c0d6` against Nexo (2026-11-17), with issue and PR states read through `gh`. The exact per-commit diff was not inspected.
- L2: the maintainer chose "El del design system" for the selected tab (Q1) and "Comportamiento del design system" for the custom accent (Q2).
- L3 (verbatim): "dale" — plan approved.
