# Hub UX polish after the first Windows run

> Feature document for the fixes Enrique requested after running the debug hub natively on Windows (2026-11-15).
> Branch `feat/hub-ux-polish` in the main checkout, so the running Vite dev server shows UI changes live.

## Specs

- S1 (verbatim): "Al cerrar deberia mentenerse en la bandeja (con submenú para cerrar definitivo)"
- S2 (verbatim): "La animación de entrada es ahora hacia arriba. Debería ser de derecha a iquierda"
- S3 (verbatim): "El slider de novedades sale con scroll y no funciona la navegación (hay que ajustar estilo y funcionalidad (puede mostrar las 4 últimas novedades pero si hay menos el slide se tiene que ajustar o si solo hay una mostrarse fija sin slide"
- S4 (verbatim): "Tengo varios ajustes de UI que haríamos con gentle-design, así que actualiza el canvas con el desarrollo actual para hacerlo"

## Tasks

- T1 (S1, L5) Closing the hub keeps it in the tray; the tray menu offers the definitive exit — route: writer, test-first; status: reopened (L5: the in-panel X exits the process).
- T2 (S2, L3) Entry animation slides from right to left — native window slide (no gray backdrop) — route: writer; status: in progress (Rust checks pass; frontend and Windows app checks pending).
- T3 (S3) News slider: no scrollbar, working navigation, up to the 4 latest items, adapts to fewer, a single item is static — route: writer (same unit); status: pending.
- T4 (S4) Canvas design reproducing the current hub UI for gentle-design iteration — route: design writer; status: pending.

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
