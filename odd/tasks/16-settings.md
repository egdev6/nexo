# Persistent settings and hub personalization (#16) - DRAFT v1

> Proposal: `nexo-i16-odd-v1`. Draft only; neither publication, assignment nor implementation is authorized.
> Roadmap: https://github.com/egdev6/nexo/issues/11; issue: https://github.com/egdev6/nexo/issues/16.
> Milestone: Experiencia del hub. This plan recommends decisions; it is not evidence of behavior or tests.

## Specs

- S1: "Que los ajustes del hub se guarden y se apliquen de verdad: el diseño v1 (#13) los muestra con vista previa, pero sin persistencia. Corresponde al milestone «Experiencia del hub»."
- S2: "Incluye: guardar los ajustes de forma local y restaurarlos al iniciar; aplicar el color de acento (selector como el de Quorb, con tonos derivados), el modo compacto, y la opacidad y el blur del fondo a la ventana real del panel; «Iniciar con Windows»; «Mostrar novedades al abrir»; fuentes del catálogo configuradas."
- S3: "Excluye: el idioma (issue de multiidioma), el formato del catálogo (#5) y las apps locales (#9)."
- S4: "#13 (vistas de ajustes)."
- S5: "Los ajustes cambiados persisten tras cerrar y volver a abrir el hub."
- S6: "Acento, modo compacto, opacidad y blur se aplican a la ventana real del panel en Windows."
- S7: "«Iniciar con Windows» registra o quita el arranque automático."
- S8: "«Mostrar novedades al abrir» controla el popup de novedades."
- S9: "Reutilizar la derivación de tonos de Quorb (`src/lib/palette.ts`) y los componentes de `@egdev/ui`. Mantener permisos de frontend mínimos."
- S10: "Tests de persistencia y de aplicación de ajustes; prueba manual en Windows con capturas; CI de Windows en verde."

### PROPOSED derived acceptance - subject to approval

- A1 (S1, S2, S5): Hydrate validated settings before first-run, news or editable controls can act.
  A missing file uses the current defaults: `es`, autostart off, news on, `#ff0036`, compact off,
  opacity 85%, blur 24px, and an uncompleted first-run flag. Save changes and restore after process restart.
- A2 (S2, S3, S5): Store the first-run completion flag and selected `es`/`en` language together only
  after a successful choice save; a failed save remains recoverable and must not falsely complete onboarding.
  Later language changes also persist. This storage bridge is proposed for #17; translations and tray localization remain #17.
- A3 (S1, S2, S5): A versioned Rust config sanitizes types, color and slider bounds (opacity 0-100,
  blur 0-40), using defaults and tolerant per-field parsing without losing unrelated valid settings.
  Structurally corrupt input follows A4; normalized values are confirmed only after a successful save.
  A frontend patch API and write queue serialize changes so fast edits cannot overwrite unrelated values.
- A4 (S1, S5): Missing, corrupt, unreadable and newer-version files are distinct. On corrupt/unreadable
  data, use safe in-memory defaults and surface a recoverable error without overwriting the original.
  Newer versions are read-only. Explicit recovery preserves a backup before writing; failure to back up
  or write leaves the original intact and reports the failure. Reopen/quit must not silently lose pending saves.
- A5 (S2, S6, S9): Reuse `settings/palette.ts` and shared components. Apply accent and derived tones
  to the actual panel, and compact spacing to actual content, not just the settings preview; restore on launch.
- A6 (S2, S6): Apply opacity 0-100 as CSS background alpha on the actual panel, not to its text or
  entire window. Drive that panel's CSS `backdrop-filter: blur(...) saturate(150%)` from the 0-40px
  slider and restore both values on launch. Quorb's comparable CSS blur is fixed at 6px, not adjustable.
  CSS filters webview content behind the element; it does not guarantee blurred desktop pixels (A7).
- A7 (S2, S6): Follow the transparent, frameless CSS approach instead of requiring Mica/acrylic. Remove
  or adjust the hub's native-effect dependency and its effect-unavailable opaque fallback; the desktop
  may look transparent and sharp rather than Mica-frosted. Reduced transparency or unsupported CSS
  still gets a readable fallback. Preserve saved choices and record the actual desktop result on Windows.
- A8 (S2, S7): Use `tauri-plugin-autostart` with a Quorb-style frontend controller and visible error/retry.
  Read Windows state, enable/disable and read back before confirming success. OS state is authoritative;
  reconcile any cached preference. On apply/readback/store failure, show error or unknown state, allow
  retry, and never report a requested registration as confirmed.
- A9 (S2, S8): The settings switch and popup's inverse `No mostrar al abrir` update one persisted value.
  After hydration and onboarding, opening the panel respects it and an empty news list does not open the popup.
  #10 owns official news data, unseen/last-visit logic and its eventual integration, not this issue.
- A10 (S2, S3, S5): Persist an ordered configured source-descriptor list, with the official source default;
  test round trips through a typed boundary and render configured entries. The representation must be
  coordinated with #5/#9. #9 owns local catalog/app selection, parsing and launch flows; do not enable
  a nonfunctional add-source control or implement a catalog format here. Remote third-party sources remain v2.
- A11 (S2, S9): Keep the fixed settings path and validation in Rust. Scope settings commands and the
  frontend autostart plugin's required permissions to the main window; enforce caller scope where applicable.
  Grant only needed capabilities, not general filesystem, arbitrary path, registry or shell access.

### PROPOSED decisions and evidence boundaries

- **Storage recommendation:** follow Quorb's Rust-owned app-config `config.json`, sanitization, defaults
  and tolerant parsing (`src-tauri/src/config.rs`), plus its frontend patch API and write queue
  (`src/lib/api.ts`, `src/lib/settings-save.ts`, `src/lib/settings-live.ts`, `src/lib/settings-dirty.ts`). Nexo additionally
  proposes schema v1, an explicit migration entry point and Windows-safe atomic replacement/recovery;
  do not attribute those additions to Quorb. Exercise migration with a documented synthetic v0 fixture;
  no older Nexo file is assumed, and future versions are not downgraded.
- **Autostart recommendation:** follow Quorb's `tauri-plugin-autostart` frontend/controller pattern
  (`src-tauri/src/lib.rs`, `src/Settings.tsx`, `src/lib/autostart-controller.ts`) with error and retry.
  Inspect the exact scoped plugin permissions and executable behavior; no blanket access or elevation.
- **Appearance recommendation:** follow Quorb's transparent frameless window and CSS alpha/blur
  (`src-tauri/tauri.conf.json`, `src/Widget.tsx`, `src/theme.css`, `src/Settings.tsx`). Nexo's slider
  varies CSS blur, unlike Quorb's fixed 6px. CSS alone may not blur the desktop behind WebView2; native
  support such as Acrylic could provide desktop blur at a system-controlled, non-adjustable radius.
  Quorb also has a separate Windows Composition backdrop for widget/detail, with a fixed four-logical-pixel
  Gaussian and host-backdrop fallback (`src-tauri/src/windows_backdrop.rs`, `window_clip.rs`); this CSS-only
  proposal does not port that layer. Record the visible difference and do not claim desktop blur from CSS.
- **Sources decision still open:** agree the smallest descriptor and ownership boundary with #5/#9;
  recommend persistence and display here, with local-source creation and consumption deferred to #9.
- **#17 reference only:** Quorb has `src/i18n/{es,en}.ts`, `src/i18n/use-locale.ts` and a Windows
  installer-to-config handoff in `src-tauri/src/installer_locale.rs`; no installer handoff is proposed here.
- Existing Nexo baseline: `apps/hub/src/App.tsx` holds settings and first-run in memory; its CSS variables
  affect the panel. `apps/hub/src-tauri/src/lib.rs` tries Mica then acrylic and exposes a boolean result;
  CSS falls back to opaque without it. Source addition is disabled. This proposal changes that backdrop path.
- #13 closed with PR #18 merged; the index still lists #16 as planned and dependent on #13. #16 was
  open and unassigned in the read snapshot. A body-only PR search is not a complete concurrency check;
  refresh the issue, roadmap, dependencies, take comments and related PRs before publication or start.

## Tasks

All units below are proposals, not authorization to publish, assign, implement or deliver.

- T1 (S1-S10) Planning and publication gate. Outcome: approve the complete proposal and its open decisions.
  Dependencies: refreshed sources and coordination, including #5/#9/#10/#17 boundaries.
  Validation/exit: only after separate approval, publish the full comment to #16, link it from #11 and
  mark #16 approved if its readiness is verified; reread each result. A draft alone is not a ready issue.
- T2 (S1-S5, S9) Versioned settings and onboarding. Outcome: Rust-owned `config.json`, tolerant parsing,
  sanitization, frontend patch queue, migration, recovery, sources and first-run/language persistence.
  Dependencies: T1, a separate explicit start and coordinated source representation.
  Validation/exit: isolated temp-directory round trips and failures pass; #17 owns translation.
- T3 (S1, S2, S5-S9) Real panel, autostart and news preference. Outcome: transparent CSS appearance,
  verified plugin autostart and one synchronized popup preference, with UI tests and documentation.
  Dependencies: T2. No native desktop-blur feasibility gate is imposed by this CSS-only proposal.
  Validation/exit: CSS and news preferences apply live and after reload, and OS autostart is confirmed;
  any lack of desktop blur is not misreported.
- T4 (S2, S5-S10) Windows evidence and delivery preparation. Outcome: real-device screenshots and
  results mapped to the specs, and Windows CI green. Dependencies: T2/T3; delivery needs separate approval.
  Validation/exit: record OS/build, supported effects and accessibility settings; report gaps, not integration.

### PROPOSED verification plan

- Store: fresh temp directories with teardown; all fields and multiple sources round-trip across reload;
  synthetic v0 migration, missing fields, invalid bounds/types with unrelated valid values preserved,
  corrupt/unreadable and future versions, protected original/backup, injected write failure and rapid
  interleaved patches. No real user config touched.
- UI wiring: hydration before interaction, first-run choice and failed save, restart without onboarding,
  language changes, accent/tones, compact, opacity/blur endpoints, source display, save errors and retry.
  Cover both news controls, no items, panel reopen, and preserved existing settings/popup behavior.
- Autostart: mocked OS enable/disable/readback, mismatch, errors, external changes and cached-state
  reconciliation; verify no success when readback is unknown. Inspect actual capability scope.
- Windows: inspect the transparent frameless tray panel live and after full restart at opacity 0/100
  and blur 0/40, plus accent/compact and readable content. Capture CSS blur over webview content and,
  separately, whether desktop pixels behind WebView2 blur; record if they remain sharp and the visual
  change from Mica. Check reduced transparency and unsupported-CSS fallback; do not infer from a mock.
  Verify enable/disable, registered executable and actual logon behavior for autostart; restore test state.
  Exercise news preference through settings and popup on reopen. Capture evidence and run Windows CI.
- Candidate runners after explicit implementation authorization: `cargo test -p nexo-hub --locked`,
  `npm test` from `apps/hub`, and the repository's Windows CI. Exact checks will be confirmed at start.

## Log

- L1: User: "sigue. puedes paralelizar agentes". Draft only; publication, assignment and implementation require later explicit approval.
- L2: User: "mira como esta hecho en quorb". Draft revised to follow Quorb's config, CSS and autostart patterns; note its separate Windows Composition layer.
