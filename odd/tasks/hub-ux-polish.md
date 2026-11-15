# Hub UX polish after the first Windows run

> Feature document for the fixes Enrique requested after running the debug hub natively on Windows (2026-11-15).
> Branch `feat/hub-ux-polish` in the main checkout, so the running Vite dev server shows UI changes live.

## Specs

- S1 (verbatim): "Al cerrar deberia mentenerse en la bandeja (con submenú para cerrar definitivo)"
- S2 (verbatim): "La animación de entrada es ahora hacia arriba. Debería ser de derecha a iquierda"
- S3 (verbatim): "El slider de novedades sale con scroll y no funciona la navegación (hay que ajustar estilo y funcionalidad (puede mostrar las 4 últimas novedades pero si hay menos el slide se tiene que ajustar o si solo hay una mostrarse fija sin slide"
- S4 (verbatim): "Tengo varios ajustes de UI que haríamos con gentle-design, así que actualiza el canvas con el desarrollo actual para hacerlo"

## Tasks

- T1 (S1) Closing the hub keeps it in the tray; the tray menu offers the definitive exit — route: writer, test-first; status: done (automated; Windows app check pending).
- T2 (S2) Entry animation slides from right to left — route: writer (same unit as T1/T3); status: done (automated; Windows app check pending).
- T3 (S3) News slider: no scrollbar, working navigation, up to the 4 latest items, adapts to fewer, a single item is static — route: writer (same unit); status: pending.
- T4 (S4) Canvas design reproducing the current hub UI for gentle-design iteration — route: design writer; status: pending.

## Log

- L1 (verbatim): "Varias cosas que vi:
-Al cerrar deberia mentenerse en la bandeja (con submenú para cerrar definitivo)
-La animación de entrada es ahora hacia arriba. Debería ser de derecha a iquierda
-El slider de novedades sale con scroll y no funciona la navegación (hay que ajustar estilo y funcionalidad (puede mostrar las 4 últimas novedades pero si hay menos el slide se tiene que ajustar o si solo hay una mostrarse fija sin slide
-Tengo varios ajustes de UI que haríamos con gentle-design, así que actualiza el canvas con el desarrollo actual para hacerlo"
- L2: T4 design created at `design/nexo-hub-actual/` (current-state capture, no chosen artboard): 01-mis-apps, 02-catalogo, 03-novedades (pre-T3 carousel), 04-ajustes, 05-primer-uso, 600x820. Barlow replaced by system font stacks per gentle-design rules.
