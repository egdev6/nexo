# Hub UI round 2 (Windows feedback)

> Branch `fix/hub-ui-round-2` in the main checkout (the Vite dev server shows UI changes live).

## Specs

- S1 (verbatim): "La animación de entrada sigue con un cuadro gris raro"
- S2 (verbatim): "El icono de abrir app no es el correcto"
- S3 (verbatim): "Catálogo solo muestra Quorb y con mensaje de no se puede verificar instalación"
- S4 (verbatim): "En mis apps Quorb sale asi" — screenshot: Quorb card in Mis apps with "Sin datos de detección en el catálogo", "Versión instalada: versión no disponible", a GitHub link, the catalog description and "Apertura no disponible: Sin datos de detección en el catálogo."
- S5 (verbatim): "Abrir novedades debe ir activa por defecto y mostrarse cada vez que se abre la app"
- Evidence: catalog v3 has no `detection` hint for Quorb (Antena has one); Quorb is NOT installed on the user's machine (HKCU Uninstall lists only Antena). Antena is installed, so the catalog (not-installed apps only) correctly hides it.
- S6 (verbatim): "Novedades sigue mostrando cosas mal. la imagen debe ser la del banner y el slide sigue mostrando 4 y puntos de navegación cuando no hay" — screenshot: news popup shows "04 / 04" with arrows, a placeholder illustration instead of the app banner, a progress line and 4 dots, while the catalog has fewer news items.
- S7 (verbatim): "La parte de personalización de color no cambia prácticamente nada en al UI. Debe aplicar a todos los estilos (botones, slide, iconos, badges,  radio buttons, switches,tabs...) revisalo porfa"
- S8 (verbatim): "sigue viéndose el cuadrado gris en la salida de vez en cuando"
- S9 (verbatim): "Antena no se muestra nunca, debe estar rota la navegación?"
- S10 (verbatim): "Creo que lo mejor es dejar instalar si no detecta no?" (answering the parent's question whether to allow installing apps without detection data, with a warning)

## Tasks

- T1 (S1) Remove the gray box before the entry slide — route: writer (native), test-first where possible; status: authorized.
- T2 (S2, S4, S5) Open icon = external-link glyph (square + arrow) as in the canvas; apps whose installation is unknown are not listed in Mis apps (only installed or connected apps); the unknown state reads clearly in the catalog; "Abrir novedades" on by default and the news popup shows every time the panel opens while it is on — route: writer (frontend), test-first; status: authorized.
- T3 (S3, S4) Quorb detection hint in the official catalog — status: dropped by the user (L2).
- T4 (S6) News popup: app banner image (catalog banner convention), real item count (no padding to 4), no navigation/dots/progress when there is one item, correct dots/counter otherwise — route: writer, test-first; status: authorized.
- T5 (S7) Accent color customization applies to every brand-colored style (buttons, slider, icons, badges, radios, switches, tabs, links, focus, progress) — route: writer, test-first; status: authorized.
- T6 (S8) No gray frame during or after the exit slide (occasional) — route: writer (native), test-first; status: authorized.
- T7 (S9) News slider navigation: every item reachable (Antena never shows) — route: writer (frontend), test-first; status: authorized.
- T8 (S10) Allow installing official apps whose installation cannot be detected, with a warning; the native install transaction no longer refuses `DetectionUnknown` before download (signature, approval and every other check unchanged); success after an unknown install is reported as installed-unverified — route: writer, test-first; status: authorized (after T6, shares Rust files).

## Log

- L1 (verbatim): "deja esa prueba para luego. Vamos con ajustes de UI:
- La animación de entrada sigue con un cuadro gris raro
- El icono de abrir app no es el correcto
- Catálogo solo muestra Quorb y con mensaje de no se puede verificar instalación
- En mis apps Quorb sale asi [Image#7]
- Abrir novedades debe ir activa por defecto y mostrarse cada vez que se abre la app"
- L2 (verbatim): "no hace falta entendí el motivo" — T3 (Quorb detection hint) dropped for now; it will come with a real Quorb install or with quorb#281 (bundle.publisher).
- L3 (verbatim): "Ajustes:
- Novedades sigue mostrando cosas mal. la imagen debe ser la del banner y el slide sigue mostrando 4 y puntos de navegación cuando no hay [Image#8]
-La parte de personalización de color no cambia prácticamente nada en al UI. Debe aplicar a todos los estilos (botones, slide, iconos, badges,  radio buttons, switches,tabs...) revisalo porfa"
- L4 (verbatim): "siguen apareciendo 2 novedades cuando solo hay una o la navegación está rota [Image#9]
sigue viéndose el cuadrado gris en la salida de vez en cuando
en catálogo si no está instalada debería de estar el botón dehabilitado no? [Image#10]" Parent evidence: the published v3 catalog has two news items (Antena 0.15.0, Quorb 0.8.0); the Quorb install button is already disabled (installation unknown).
- L5 (verbatim): "Antena no se muestra nunca, debe estar rota la navegación?
Creo que lo mejor es dejar instalar si no detecta no?"
