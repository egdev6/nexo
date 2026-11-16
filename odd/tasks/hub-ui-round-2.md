# Hub UI round 2 (Windows feedback)

> Branch `fix/hub-ui-round-2` in the main checkout (the Vite dev server shows UI changes live).

## Specs

- S1 (verbatim): "La animación de entrada sigue con un cuadro gris raro"
- S2 (verbatim): "El icono de abrir app no es el correcto"
- S3 (verbatim): "Catálogo solo muestra Quorb y con mensaje de no se puede verificar instalación"
- S4 (verbatim): "En mis apps Quorb sale asi" — screenshot: Quorb card in Mis apps with "Sin datos de detección en el catálogo", "Versión instalada: versión no disponible", a GitHub link, the catalog description and "Apertura no disponible: Sin datos de detección en el catálogo."
- S5 (verbatim): "Abrir novedades debe ir activa por defecto y mostrarse cada vez que se abre la app"
- Evidence: catalog v3 has no `detection` hint for Quorb (Antena has one); Quorb is NOT installed on the user's machine (HKCU Uninstall lists only Antena). Antena is installed, so the catalog (not-installed apps only) correctly hides it.

## Tasks

- T1 (S1) Remove the gray box before the entry slide — route: writer (native), test-first where possible; status: authorized.
- T2 (S2, S4, S5) Open icon = external-link glyph (square + arrow) as in the canvas; apps whose installation is unknown are not listed in Mis apps (only installed or connected apps); the unknown state reads clearly in the catalog; "Abrir novedades" on by default and the news popup shows every time the panel opens while it is on — route: writer (frontend), test-first; status: authorized.
- T3 (S3, S4) Quorb detection hint in the official catalog — route: parent; status: pending decision (values must come from a real install or an approved derivation).

## Log

- L1 (verbatim): "deja esa prueba para luego. Vamos con ajustes de UI:
- La animación de entrada sigue con un cuadro gris raro
- El icono de abrir app no es el correcto
- Catálogo solo muestra Quorb y con mensaje de no se puede verificar instalación
- En mis apps Quorb sale asi [Image#7]
- Abrir novedades debe ir activa por defecto y mostrarse cada vez que se abre la app"
