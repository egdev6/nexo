# Design system adoption II: import the delivered DS improvements into Nexo

Adopt the components and variants the design system shipped for the requests Nexo filed (#396, #408–#414, #417, #419–#421, #423, #424), remove the guard exceptions they replace, and keep the five exceptions still blocked upstream. This is the second pass of the `egdev-design-system` skill pilot (see `odd/tasks/ds-adoption.md`).
Status: approved (L2).

## Specs

- S1 (request, verbatim): "tenemos novedades del design system. Ya terminó todas las mejoras solicitadas puedes revisarlo y planificar la importación a Nexo?"
- S2 (upstream state, 2026-11-17): closed with merged PRs: #396 (443), #408 (445), #409 and #421 (444), #410 (446), #411 (433), #412 (436), #413 (438), #414 (430), #417 (447), #419 (440), #420 (437), #423 (441), #424 (448), and Button `labelWrap` (439). Still open: #415 (runtime accent), #416 (ColorSwatchGroup), #418 (Panel accent edge), #425 and #426 (semantic contrast roles, epic #404).
- S3 (baseline): adoption 84.30 % by JSX instance (91.14 % interactive). The guard allowlist has 36 entries.
- S4 (target): remove the 31 entries the delivered APIs replace, and resolve the TODOs `first-run/index.tsx:9` (#417), `settings/index.tsx:12-15` and `local-management.tsx:85` (#424), and `App.tsx:50` (#410). Keep the 5 blocked entries: A67, A71 and A76 (#416), A38 (#418), and A112 (#425/#426). Report adoption before and after each slice with the audit mode.
- S5 (rules): follow the skill and ADR 0001. Each DS bump is its own reviewed change, behaviour is checked in the real WebView2 when it depends on the browser, and the maintainer checks every visible change on the running app before merge.

## Tasks

- T1 (S2, S5) Vendor DS `085b46e` with `apps/hub/scripts/ds-vendor.mjs`. Package versions are unchanged; only the `-<dscommit>` suffix moves. Update the hard-coded commit headers in `sync-design-system-md.mjs` and `check-design-system-mcp.mjs`, regenerate `design/system.md`, and run a smoke check. Behaviour change to watch: the coarse-pointer minimum height of `Field layout="choice"` grows. Route: inline. Status: pending.
- T2 (S4) Collapsible app rows: use `CollapsibleHeader actions` with `CollapsibleTrigger motion` and `CollapsibleContent padding/presence`, and drop the absolute-position and `!important` hack in `style.css`. Removes 8 entries. Route: writer, test-first, visual check. Status: done (allowlist 36 → 28, adoption 84.30 % → 84.57 %, 538 tests, `motion="none"` keeps the row and chevron static; confirmed by the maintainer: "está OK").
- T3 (S4) Choice fields: use `Field layout="choice-trailing"` for the settings switches and `layout="choice"` for the news "don't show" checkbox. Removes 5 entries. Route: writer, test-first, visual check. Status: done (allowlist 28 → 23, adoption 84.57 % → 86.86 %, interactive 95.95 %, 549 tests; confirmed by the maintainer: "todo OK").
- T4 (S4) Tabs and Carousel: use `Tabs fullWidth/labelWrap` (the main tabs are already `segmented`) and `Carousel trackLayout="full-width"`. Removes 5 entries. Route: writer, test-first, visual check and a CDP check of scroll and snap. Status: done (allowlist 23 → 18; the opaque menu band moved from ::before to box-shadow because fullWidth makes the tablist a scroll container (CDP: no overflow); 556 tests; confirmed by the maintainer: "todo OK"; carousel snap validated in the next test release).
- T5 (S4) Headings: use `Heading variant="compact"` in the settings and local-management bands, and the per-run `lang` of `SectionHeader` in the first-run intro. Removes 6 entries and their TODOs. Route: writer, test-first, visual check. Status: done (allowlist 18 → 12, adoption 86.86 % → 87.29 %, 560 tests; settings bands confirmed by the maintainer: "lo veo OK"; first-run validated in the next test release).
- T6 (S4) Dialog and compositions: `DialogContent bodyPadding="compact"` and `Button labelWrap` in the add-local dialog, and Input, RadioGroup and SocialLinks composed through their public API. Removes 7 entries. Route: writer, test-first, visual check. Status: pending.
- T7 (S4) App identity and icons: replace Nexo's local `AppIcon` with the DS `AppIcon` (`monogram`, `src`, image fallback), and the custom download and external-link glyphs with `Icon name="download" | "external-link"`. Resolves the `App.tsx:50` TODO. Route: writer, test-first, visual check. Status: pending.
- T8 (S2) Optional adoptions with no exception today:
  - the news popup on `DialogContent container` + `overlayScope="container"` (#409), replacing its own focus trap and Escape handling;
  - the settings back button as `PageHeader leadingAction` (#412);
  - the first-run language choice as `SelectTile variant="text-only"` (#413);
  - secondary and status text as `Text foreground` (#396).

  Route: writer, test-first, visual check. Status: pending.
- T9 (S3, S4) Close: run the audit mode, record the before and after numbers, update the skill with anything learned (for example, the `AppIcon` name clash), and prepare a Nexo test release. Route: inline. Status: pending.

## Open questions

- Q1 (resolved, L2): T8 included.

## Log

- L1 (verbatim): "tenemos novedades del design system. Ya terminó todas las mejoras solicitadas puedes revisarlo y planificar la importación a Nexo?"
- Evidence: a read-only map of the DS (origin/main `085b46e`) against Nexo's allowlist and TODOs (2026-11-17), with the upstream issue and PR states read through `gh`. Five requests are still open upstream (S2), so "all of them" is not yet true; their exceptions stay.
- L2 (verbatim): "dale" — plan approved with T8 included.
- L3: T2 — the DS CollapsibleHeader places the chevron before the actions (Nexo had it after). The maintainer chose "Aceptar el orden del DS".
- Slice: PR 1 = T1–T3 (about 530 authored lines, mostly the regenerated design/system.md); T4–T9 go in a second PR.
- L4 (verbatim): "esos tabs de app no deberían estar (posiblemente con eso el scroll de tabs se arregla)" — T4 review: with Tabs fullWidth the DS tablist is a scroll container, so Nexo's ::before opaque band overflows (both scrollbars) and is clipped (windows behind show through).
