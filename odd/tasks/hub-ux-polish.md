# Hub UX polish after the first Windows run

> Feature document for the fixes Enrique requested after running the debug hub natively on Windows (2026-11-15).
> Branch `feat/hub-ux-polish` in the main checkout, so the running Vite dev server shows UI changes live.

## Specs

- S1 (verbatim): "Al cerrar deberia mentenerse en la bandeja (con submenú para cerrar definitivo)"
- S2 (verbatim): "La animación de entrada es ahora hacia arriba. Debería ser de derecha a iquierda"
- S3 (verbatim): "El slider de novedades sale con scroll y no funciona la navegación (hay que ajustar estilo y funcionalidad (puede mostrar las 4 últimas novedades pero si hay menos el slide se tiene que ajustar o si solo hay una mostrarse fija sin slide"
- S4 (verbatim): "Tengo varios ajustes de UI que haríamos con gentle-design, así que actualiza el canvas con el desarrollo actual para hacerlo"

## Tasks

- T1 (S1, L5) Closing the hub keeps it in the tray; the tray menu offers the definitive exit — route: writer, test-first; status: done (c678b82, 1a05bb7; user confirmed hide to tray).
- T2 (S2, L3) Entry animation slides from right to left — native window slide (no gray backdrop) — route: writer; status: done (43e86e4, 6d976bf; L6 "animación perfecta").
- T3 (S3) News slider: no scrollbar, working navigation, up to the 4 latest items, adapts to fewer, a single item is static — route: writer (same unit); status: done (7f38b60).
- T4 (S4) Canvas design reproducing the current hub UI for gentle-design iteration — route: design writer; status: done (b5a79a7, 5ca87df, 5d5535c).

- T5 (S4, canvas 6tkmm777) Flush window frame: no margins (top/right/taskbar), no rounded corners (DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_DONOTROUND) and no CSS radius — route: writer, test-first; status: done (4818c17).
- T6 (S4, canvas Quorb contrast) Port `apps/hub/scripts/canvas/egdev-family-contrast.css` into the app styles: window background surface-0 (keeping user opacity/blur), cards, header band, reds; header icon buttons ghost — route: writer; status: done (4818c17).
- T7 (S4, canvas 01) Mis apps: single-open accordion closed by default; header actions (update = red secondary download icon only when a newer version exists, open = link icon); detail panel (installed version, new version badge first, @egdev/ui SocialLinks GitHub/YouTube, secondary Cerrar for plugin apps); no "Instalada" in headers; no catalog section or news notice; refresh in section headers without count; local apps share the block — route: writer, test-first; status: done (44bb79e).
- T8 (S4, canvas 02) Catalog cards: no tag badges, fixed-size banner (object-fit cover), SocialLinks, actions pinned to the bottom — route: writer; status: done (03901cc).
- T9 (S4, canvas 04/05/03) Settings without close button (back arrow), tabs General / Apariencia / Apps locales / Acerca de, Autor card with SocialLinks; first-run bilingual lines joined by " - "; news popup vertically centered — route: writer; status: done (cdc0f10).
- T10 (S4, L7, canvas 06) Remove the local catalog source (#9 T3) end to end with a tolerant config migration that drops stored local catalog sources/bindings; add the "Añadir app local" dialog (executable via native picker, editable name, icon) replacing the direct picker — route: writer, test-first, independent verification (stored config migration); status: done (c93e696, a276f67).
- T11 (L9) Upgrade the vendored @egdev/tokens and @egdev/ui to the current egdev-design-system version; keep tests green and record visual changes — route: writer in an isolated worktree, then merge; status: done (585bedd).
- T12 (S4 follow-up, user: "empaqueta Barlow") Bundle Barlow and Barlow Condensed (woff2 only, used weights) with the OFL notice — status: done (41512d9, d074ca4).

## Log

- L1 (verbatim): "Varias cosas que vi:
-Al cerrar deberia mentenerse en la bandeja (con submenú para cerrar definitivo)
-La animación de entrada es ahora hacia arriba. Debería ser de derecha a iquierda
-El slider de novedades sale con scroll y no funciona la navegación (hay que ajustar estilo y funcionalidad (puede mostrar las 4 últimas novedades pero si hay menos el slide se tiene que ajustar o si solo hay una mostrarse fija sin slide
-Tengo varios ajustes de UI que haríamos con gentle-design, así que actualiza el canvas con el desarrollo actual para hacerlo"
- L2: T4 design created at `design/nexo-hub-actual/` (current-state capture, no chosen artboard): 01-mis-apps, 02-catalogo, 03-novedades (pre-T3 carousel), 04-ajustes, 05-primer-uso, 600x820. Barlow replaced by system font stacks per gentle-design rules.
- L3 (verbatim): "deja un fondo gris antes de aparacer la animación. Habría que quitarlo o hacer transparente fondo y bordes". Parent decision: the gray is the native window backdrop shown at its final position while the content slides in via CSS; slide the whole native window instead (the backdrop travels with the content, desktop blur preserved), replacing the CSS slide; reduced motion keeps no movement. T2 reopened.
- L4 (verbatim): "la animación de salida la hace bien pero una vez oculta hace un parpadeo que la muestra en su estado abierto". Parent hypothesis: after the exit slide the window is restored to its final position around the hide, flashing it open; restore must never happen while visible.
- L5 (verbatim): "al cerrar en l abandeja se cerró nexo. recompila en windows" and, asked how it was closed: "con la X". Parent evidence: the in-panel X calls `hidePanel` → `requestFlyoutHide` → `invoke('hide_flyout')`; after that the nexo-hub.exe process was gone (no process when the parent's rebuild started; a later relaunch with redirected stderr also exited within 6 s with an empty log). T1 reopened.
- L6 (verbatim): "animación perfecta" — T2 native slide verified by the user on Windows.
- L7 (verbatim): "yo dejaría solo una forma de añadirlas...no tiene sentido 2." Decision: remove the local catalog file source (#9 T3: local_catalog_set/refresh/clear/bind/unbind/open, "Fuentes del catálogo" settings block); local apps are added only one by one through a new "Añadir app local" popup (design artboard 06-anadir-app: executable, name, icon). The settings tab becomes "Apps locales". Implementation follows when the canvas round closes.
- L8 (verbatim): "ok. llevemoslo. entiendo que vas a usar los componentes del design system? si encuentras alguna posible issue avisame". Effect: implement the canvas round (T5-T10) with @egdev/ui components (vendored 0.1.0 has Collapsible, IconButton, Button, Badge, SocialLinks, Dialog, Field, Input).
- L9 (verbatim): "1-vamos con ello 2-abrir issue 3-actualizar version de egdev design system 4-quitar". Decisions: (1) catalog banners by convention at `https://egdev6.github.io/nexo-catalog/banners/<id>.webp`, placeholder when missing, no schema change; (2) open an issue in egdev-design-system to host the family contrast (from Quorb) in tokens/ui; (3) upgrade the vendored @egdev design system in Nexo to the current version (T11); (4) remove the local catalog (T10 confirmed).
- L10: independent verification of T5–T11: pass with advisories (no blockers); its token and open_external probes added as regressions; stale node_modules (design system) reinstalled and Vite restarted.
