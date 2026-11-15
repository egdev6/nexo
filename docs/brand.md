# Nexo · identidad

El símbolo elegido es **Panel, un solo lugar**: cuatro aplicaciones reunidas en un marco redondeado. La fuente vectorial es [`apps/hub/src-tauri/app-icon.svg`](../apps/hub/src-tauri/app-icon.svg), con fondo transparente y retícula de 128 × 128. La cara usa `--logo-red` (`#E91B35`) y el relieve desplazado hacia abajo usa `--logo-red-shade` (`#800C1D`), los dos rojos de la familia egdev. El encabezado usa esa misma fuente, independientemente del color de acento elegido en ajustes.

## Tipografía

El hub incluye Barlow (pesos 400, 500, 600, 700 y 800) y Barlow Condensed (400, 600, 700 y 800), estilo normal y subconjunto latino. Proceden de `@fontsource/barlow` y `@fontsource/barlow-condensed` 5.3.0 y se distribuyen solo en WOFF2. Están bajo la licencia SIL Open Font License 1.1 (OFL 1.1): el paquete incluye los avisos originales de [Barlow](../apps/hub/src-tauri/licenses/Barlow-OFL.txt) y [Barlow Condensed](../apps/hub/src-tauri/licenses/Barlow-Condensed-OFL.txt), y Ajustes → Acerca de muestra el crédito. Las láminas del canvas llevan las mismas fuentes WOFF2 embebidas.

## Bandeja

[`design/nexo-logo/tray.svg`](../design/nexo-logo/tray.svg) simplifica el marco y los cuatro módulos en una retícula de 16 × 16. Se usa la misma versión para barras claras y oscuras: la cara roja distingue el símbolo en ambas, aunque el relieve oscuro pierde contraste sobre oscuro. `apps/hub/src-tauri/src/tray_icon.rs` reproduce esa retícula en RGBA a 32 px para el icono embebido; mantener ambas representaciones sincronizadas. Windows escala el icono según el DPI. Comprobar en Windows 11 los tamaños de 16, 20, 24 y 32 px sobre ambas barras.

## Regenerar iconos de aplicación

Desde `apps/hub`, con las dependencias ya instaladas:

```sh
npx tauri icon src-tauri/app-icon.svg
```

Conservar los iconos referenciados por `src-tauri/tauri.conf.json` y los demás iconos de escritorio regenerados. El comando también crea iconos Android e iOS: eliminarlos, ya que v1 solo soporta Windows. Comprobar transparencia, ventana e icono del instalador antes de entregar.
