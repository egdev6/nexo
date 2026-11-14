# ODD propuesto: nexo-i16-odd-v1

<!-- odd-roadmap: proposal=nexo-i16-odd-v1 operation=i16-odd -->

- Issue: https://github.com/egdev6/nexo/issues/16
- Sustituye, si se aprueba: el alcance de planificación del cuerpo original, sin reescribirlo.
- Propuesta: `nexo-i16-odd-v1`, pendiente de aprobación. El marcador identifica la operación, no la autoriza.
- Motivo e impacto: convertir la vista previa de ajustes en preferencias locales aplicadas al panel real. Se precisan los límites con #5, #9, #10 y #17, sin cambiar el orden del roadmap.
- Cambios propuestos: ajustes en memoria y controles ilustrativos pasan a almacenamiento versionado, aplicación real y comprobaciones de Windows.

## Alcance vigente completo

El hub guarda sus ajustes localmente y los restaura al reiniciar. Aplica al panel real el acento y sus tonos derivados, la interfaz compacta, la opacidad y el desenfoque del fondo. «Iniciar con Windows» controla el arranque automático; «Mostrar novedades al abrir» controla el popup. Las fuentes configuradas del catálogo también se conservan.

Criterios originales que orientan la propuesta:

- **S1:** "Que los ajustes del hub se guarden y se apliquen de verdad: el diseño v1 (#13) los muestra con vista previa, pero sin persistencia. Corresponde al milestone «Experiencia del hub»."
- **S2:** "Incluye: guardar los ajustes de forma local y restaurarlos al iniciar; aplicar el color de acento (selector como el de Quorb, con tonos derivados), el modo compacto, y la opacidad y el blur del fondo a la ventana real del panel; «Iniciar con Windows»; «Mostrar novedades al abrir»; fuentes del catálogo configuradas."
- **S3:** "Excluye: el idioma (issue de multiidioma), el formato del catálogo (#5) y las apps locales (#9)."
- **S4:** "#13 (vistas de ajustes)."
- **S5:** "Los ajustes cambiados persisten tras cerrar y volver a abrir el hub."
- **S6:** "Acento, modo compacto, opacidad y blur se aplican a la ventana real del panel en Windows."
- **S7:** "«Iniciar con Windows» registra o quita el arranque automático."
- **S8:** "«Mostrar novedades al abrir» controla el popup de novedades."
- **S9:** "Reutilizar la derivación de tonos de Quorb (`src/lib/palette.ts`) y los componentes de `@egdev/ui`. Mantener permisos de frontend mínimos."
- **S10:** "Tests de persistencia y de aplicación de ajustes; prueba manual en Windows con capturas; CI de Windows en verde."

### Comportamiento propuesto

1. Cargar y validar los ajustes antes de permitir interacciones, mostrar el primer uso o decidir si se abre Novedades. En una instalación sin archivo se proponen los defaults existentes: `es`, inicio automático desactivado, novedades activadas, acento `#ff0036`, modo compacto desactivado, opacidad 85% y desenfoque 24px; el primer uso está pendiente.
2. Guardar juntos idioma elegido y finalización del primer uso. Solo se considera completado tras guardar correctamente; un error permite reintentar. Los cambios posteriores de idioma también se conservan. Esto propone únicamente la interfaz de almacenamiento que necesita #17: la traducción, la infraestructura i18n y la localización de la bandeja siguen fuera de #16.
3. Sanear tipos, color y rangos: opacidad 0 a 100 y desenfoque 0 a 40. Usar defaults y lectura tolerante por campo sin perder otros ajustes válidos. Un archivo estructuralmente corrupto sigue el punto 4; los valores saneados solo se confirman al guardar con éxito. Una API de parches y una cola en el frontend evitan que cambios rápidos sobrescriban valores más recientes. Los errores deben ser visibles y recuperables; cerrar no debe perder cambios pendientes silenciosamente.
4. Distinguir archivo inexistente, corrupto, ilegible o de una versión futura. Con corrupción o error de lectura se usan defaults seguros en memoria y se avisa, sin sobrescribir el original. Una versión futura queda en solo lectura. Una recuperación explícita conserva una copia antes de escribir; si la copia o escritura falla, mantiene el original e informa el error.
5. Reutilizar la paleta ya portada y `@egdev/ui`. El acento, sus tonos y el espaciado compacto afectan al panel real, no solo a la muestra, y se restauran al iniciar.
6. La opacidad 0 a 100 controla el alfa CSS del fondo del panel real, no la opacidad de texto ni controles. El deslizador 0 a 40px controla `backdrop-filter: blur(...) saturate(150%)` en el panel, y ambos valores se restauran al iniciar. En Quorb el desenfoque CSS equivalente es fijo en 6px, no ajustable. El filtro afecta al contenido de la webview detrás del elemento y no garantiza desenfocar el escritorio.
7. Seguir el enfoque de ventana transparente y sin marco, con CSS, sin depender de Mica ni acrylic. Quitar o ajustar la dependencia actual del efecto nativo del hub y su fallback opaco por ausencia de ese efecto. El escritorio puede verse transparente y nítido en vez de tener el aspecto esmerilado de Mica. Con transparencia reducida o CSS no soportado se conserva un fallback legible. Guardar las elecciones y documentar el resultado real en Windows.
8. Usar `tauri-plugin-autostart` con un controlador en el frontend y aviso de error y reintento, como Quorb. Leer el estado real de Windows y, tras activar o desactivar, confirmar mediante otra lectura antes de presentar éxito. El sistema prevalece sobre cualquier copia guardada. Si la aplicación, lectura o guardado falla, mostrar error o estado desconocido y permitir reintentar, sin afirmar que se registró lo solicitado.
9. El interruptor de ajustes y «No mostrar al abrir» del popup representan, de forma inversa, una sola preferencia guardada. Tras la carga y el primer uso, al abrir el panel se respeta esa preferencia y no se abre el popup con una lista vacía. #10 conserva la lógica de datos oficiales, novedades no vistas y última visita.
10. Conservar una lista ordenada de descriptores de fuentes, con la fuente oficial como default, mediante un límite tipado y visible en ajustes. La representación exacta se coordina con #5 y #9. #9 se ocupa de elegir, interpretar y usar catálogos locales y apps locales; aquí no se habilita un botón de añadir que no funcione ni se define el formato del catálogo. Las fuentes remotas de terceros siguen en v2.
11. La ruta fija y la validación quedan en Rust. Limitar los comandos de ajustes y los permisos necesarios del plugin de inicio automático a la ventana principal. No se concede a la webview acceso general a archivos, rutas arbitrarias, registro o shell.

### Decisiones abiertas y recomendaciones

- **Almacenamiento:** seguir el `config.json` de configuración por usuario, propiedad de Rust, con saneamiento, defaults y lectura tolerante de Quorb (`src-tauri/src/config.rs`), más su API de parches y cola del frontend (`src/lib/api.ts`, `src/lib/settings-save.ts`, `src/lib/settings-live.ts`, `src/lib/settings-dirty.ts`). Nexo propone además esquema v1, migración explícita y reemplazo atómico y recuperación compatibles con Windows; esas adiciones no se atribuyen a Quorb. Se prueba la migración con un v0 sintético documentado, sin afirmar que exista un archivo anterior de Nexo. Una versión futura no se degrada ni se sobrescribe.
- **Inicio automático:** seguir el patrón de `tauri-plugin-autostart` y controlador del frontend de Quorb (`src-tauri/src/lib.rs`, `src/Settings.tsx`, `src/lib/autostart-controller.ts`), con error visible y reintento. Confirmar los permisos precisos y el ejecutable; no se propone acceso de administrador ni permisos globales.
- **Apariencia:** seguir la ventana transparente sin marco y el alfa y desenfoque CSS de Quorb (`src-tauri/tauri.conf.json`, `src/Widget.tsx`, `src/theme.css`, `src/Settings.tsx`). En Nexo el deslizador varía el desenfoque CSS, a diferencia de los 6px fijos de Quorb. El filtro CSS puede no desenfocar el escritorio detrás de WebView2; para eso haría falta soporte nativo, por ejemplo Acrylic con radio del sistema no ajustable. Quorb también tiene una capa independiente de Windows Composition para widget y detalle, con desenfoque gaussiano fijo de cuatro píxeles lógicos y fallback de host (`src-tauri/src/windows_backdrop.rs`, `window_clip.rs`); esta propuesta solo CSS no la porta. Documentar la diferencia visual sin afirmar que CSS desenfoca el escritorio.
- **Fuentes:** acordar con #5 y #9 el descriptor mínimo y su propietario. Se recomienda persistir y mostrar aquí; la creación y el consumo del catálogo local corresponden a #9.
- **Referencia para #17:** Quorb usa `src/i18n/{es,en}.ts`, `src/i18n/use-locale.ts` y un traspaso del instalador a la configuración en `src-tauri/src/installer_locale.rs`. No se propone implementar ese traspaso en #16.

## ODD propuesto

Las fases son propuestas. Su publicación no autoriza por sí sola la asignación ni la implementación.

### T1. Aprobación y publicación

- Resultado: acordar el plan completo y las decisiones abiertas.
- Dependencias: actualizar fuentes y coordinar los límites con #5, #9, #10 y #17.
- Comprobación y salida: tras autorización separada, publicar el comentario completo en #16, enlazarlo desde #11 y marcar #16 aprobada solo si se verifica que cumple las condiciones para contribuir. Releer cada operación; un borrador no hace que la issue esté lista.

### T2. Almacenamiento y primer uso

- Resultado: `config.json` versionado de Rust, lectura tolerante, saneamiento, API de parches y cola del frontend, migración, recuperación y persistencia del primer uso, idioma y fuentes, con pruebas y documentación.
- Dependencias: T1, inicio explícito posterior y coordinación de la representación de fuentes.
- Comprobación y salida: pruebas aisladas de ida y vuelta, migración y fallos; #17 mantiene la responsabilidad de traducción.

### T3. Panel real, inicio automático y Novedades

- Resultado: apariencia CSS transparente aplicada y restaurada, arranque confirmado por Windows y una preferencia sincronizada para el popup, con pruebas de interfaz y documentación.
- Dependencias: T2. La propuesta solo CSS no impone una puerta previa de viabilidad del desenfoque nativo.
- Comprobación y salida: valores CSS y preferencia de Novedades aplicados en vivo y tras reiniciar, e inicio automático confirmado por el sistema; no afirmar que existe desenfoque del escritorio si no se observa.

### T4. Evidencia en Windows y preparación de entrega

- Resultado: capturas y resultados reales vinculados a los criterios, más CI de Windows en verde.
- Dependencias: T2 y T3. La entrega requiere autorización separada.
- Comprobación y salida: registrar versión de Windows, efectos disponibles y opciones de accesibilidad; informar cualquier hueco sin presentarlo como integración.

### Verificación futura

- **Persistencia:** directorios temporales aislados y limpiados; ida y vuelta de todos los campos y varias fuentes, migración v0 sintética, campos faltantes, tipos y límites inválidos con los demás valores válidos preservados, corrupción, errores de lectura, versiones futuras, protección del original y copia, fallo de escritura y cambios rápidos intercalados. No usar la configuración real del usuario.
- **Interfaz:** carga previa a la interacción, elección inicial y fallo al guardar, reinicio sin repetir primer uso, cambio de idioma, acento y tonos, modo compacto, extremos de los controles, fuentes, error y reintento. Comprobar ambos controles de Novedades, lista vacía, reapertura y comportamiento previo conservado.
- **Inicio automático:** dobles de sistema para activar, desactivar y releer; discrepancias, errores, cambios externos y reconciliación con la copia guardada. Revisar que los permisos concedidos sean mínimos.
- **Windows real:** comprobar el panel de bandeja transparente y sin marco en vivo y tras reinicio completo con opacidad 0/100 y desenfoque 0/40, además de acento, modo compacto y legibilidad. Capturar el desenfoque CSS sobre contenido de la webview y, por separado, si se desenfoca el escritorio detrás de WebView2; anotar si permanece nítido y el cambio visual respecto de Mica. Comprobar transparencia reducida y fallback por CSS no soportado, sin inferirlo de un doble. Verificar alta y baja, ejecutable registrado e inicio de sesión real, restaurando el estado de prueba. Comprobar el popup desde ambos controles y al reabrir; registrar capturas y CI.
- Como candidatos posteriores para las pruebas automatizadas: `cargo test -p nexo-hub --locked` y `npm test` desde `apps/hub`; confirmar los comandos exactos y CI al iniciar.

## Preparación y coordinación

#16 pertenece a «Experiencia del hub» y depende de #13, cerrada con [#18 fusionada](https://github.com/egdev6/nexo/pull/18). En la consulta de preparación, #16 estaba abierta y sin assignees; la búsqueda de PR por contenido no verifica por completo posibles trabajos concurrentes. El índice la mantiene planificada, no lista para contribuir.

Antes de publicar o iniciar hay que releer el roadmap, la issue, dependencias, comentarios de toma y PR relacionadas, y coordinar cualquier solapamiento. Aprobar el plan y autorizar su publicación son decisiones explícitas; no reservan la issue ni autorizan implementación. Un inicio posterior debe identificar y verificar a quien la toma. Commit, push, PR, merge y cierre requieren autorización separada.

## Enlace desde el roadmap

Solo tras aprobación y autorización de publicación, enlazar el comentario verificado desde la entrada de #16 en [#11](https://github.com/egdev6/nexo/issues/11). Si falla el enlace o cualquier otra operación aprobada, informar publicación parcial y no declarar el roadmap sincronizado.
