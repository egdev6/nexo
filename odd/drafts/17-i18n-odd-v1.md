# ODD propuesto: nexo-i17-odd-v1

<!-- odd-roadmap: proposal=nexo-i17-odd-v1 operation=i17-odd -->

- Issue: https://github.com/egdev6/nexo/issues/17
- Sustituye, si se aprueba: la planificación del cuerpo original, sin reescribirlo.
- Propuesta: `nexo-i17-odd-v1`, pendiente de aprobación. El marcador identifica la operación, no la autoriza.
- Motivo e impacto: concretar el multiidioma de la interfaz y la bandeja a partir de las vistas y los ajustes existentes, sin cambiar el orden del roadmap.
- Cambio propuesto: del ODD pendiente de detallar a un plan verificable de catálogos, elección, persistencia, bandeja y comprobación en Windows.

## Alcance vigente completo

El hub ofrece su interfaz en inglés y español. En el primer uso se elige el idioma antes de ver la lista de apps; después se puede cambiar en Ajustes y se conserva al reiniciar. La interfaz incluye el menú de la bandeja, que deja de tener «Salir» fijo en español. Se sigue el enfoque de Quorb, con las claves en un único lugar y sin textos fijos en componentes.

La issue incluye la pantalla de primer uso del artboard `07-primer-uso`, la persistencia, los textos del hub y la bandeja. Excluye otros idiomas y la traducción del contenido del catálogo, que procede de sus fuentes. Depende de #13, las vistas, y #16, los ajustes persistentes. Pertenece al milestone «Experiencia del hub».

### Criterios de aceptación originales

- En la primera ejecución se elige EN o ES antes de ver la lista de apps.
- Toda la interfaz, incluido el menú de la bandeja, aparece en el idioma elegido.
- El idioma se puede cambiar desde Ajustes y se conserva al reiniciar.
- Comprobaciones: tests de que no quedan textos sin traducir en las vistas, prueba manual en Windows en ambos idiomas y CI de Windows en verde.

### Comportamiento propuesto para comprobarlos

1. Mantener catálogos EN/ES en una ubicación canónica para frontend y Rust, sin una segunda copia de traducciones mantenida a mano. Derivar claves tipadas y comprobar claves ausentes, adicionales o vacías y marcadores de interpolación distintos. Títulos, botones, estados, avisos, `aria-label`, `title` y otros textos propios del hub proceden de esos catálogos. El primer uso bilingüe también usa las claves; marcas, nombres propios de idiomas, identificadores y datos externos son excepciones explícitas.
2. Conservar la pantalla bilingüe, el español preseleccionado y el acceso por teclado. Solo tras elegir y continuar se guardan juntos `language` y `firstRunComplete` mediante la cola de parches ya existente de #16. Si falla el guardado, no se muestra la lista ni se da por completado el primer uso; se informa el error en el idioma elegido y se permite reintentar sin perder otros ajustes. El idioma del error es una vista previa del selector, no un cambio global ni guardado.
3. El hook de idioma obtiene el valor de `HubSettings.language` tras cargar ajustes, sin crear otra preferencia ni otro archivo. Un cambio EN/ES en General actualiza la interfaz y la bandeja durante la sesión después de guardarse correctamente y persiste al reiniciar. Se conservan la cola, el reintento y el vaciado antes de salir. Un fallo mantiene el cambio pendiente recuperable y no lo presenta como guardado; respuestas antiguas no deben ganar a cambios posteriores.
4. Al arrancar, Rust lee la configuración validada del almacén existente de #16, con sus reglas de bloqueo y normalización, antes de construir la bandeja, sin esperar a la webview ni escribir otra configuración. El arranque y la carga del frontend no deben discrepar sobre un idioma guardado válido. Si falta el archivo o es corrupto, ilegible o de una versión futura, usa español seguro para la bandeja inicial y conserva las reglas de recuperación o solo lectura de #16, sin sobrescribir el original. Una instalación nueva sigue mostrando el selector.
5. Al confirmarse un cambio, reconstruir las etiquetas propias de la bandeja: «Salir», salida solo de Nexo, unificar bandeja, abrir, cerrar y estado sin respuesta. Localizar también los avisos propios de arranque, conexión y cierre. Conservar su estado de forma que un aviso ya visible pueda actualizarse al cambiar el idioma. Los motivos de rechazo enviados por las apps se muestran como datos, sin adivinar su traducción.
6. La actualización de la bandeja conserva las etiquetas enviadas por cada app, sus identificadores, estados marcados y habilitados, rutas de acciones, actualizaciones del registro y cierre seguro. Si falla la actualización nativa, avisar y permitir reintentar; distinguir una preferencia guardada de una aplicación a la bandeja que falló, sin declarar incorrectamente éxito ni pérdida del guardado.
7. No traducir nombres, descripciones, etiquetas y textos de noticias del catálogo, etiquetas o motivos enviados por apps, etiquetas de fuentes definidas por el usuario ni diagnósticos externos. Envolver estos últimos con contexto propio localizado. Sí traducir las insignias y la acción de Novedades generadas por Nexo, aunque hoy `catalog/mapping.ts` las construya en español, y la etiqueta integrada de la fuente oficial sin reescribir datos guardados ni nombres personalizados.
8. Formatear fechas y números visibles con el idioma seleccionado, propuesto como `es-ES` y `en-US`, y usar plurales adecuados. No alterar identificadores, versiones, fechas o datos originales del catálogo ni añadir una fecha visible solo para demostrar el formato. Actualizar el idioma del documento para las tecnologías de asistencia y marcar los fragmentos de la pantalla bilingüe.
9. Seguir la forma de catálogos, claves punteadas, interpolación y pruebas de Quorb, sin añadir una dependencia i18n por defecto. Se recomienda su fallback de idioma elegido a español y finalmente a la clave ante valores inesperados o ausentes. Hacer fallar CI ante claves incompletas: un fallback no demuestra que exista la traducción.

### Decisiones abiertas y recomendaciones

- **Idioma efectivo y guardado:** usar español al arrancar sin una preferencia válida y el selector bilingüe en instalaciones nuevas. Tras guardar, usar el idioma confirmado en interfaz y bandeja. Reutilizar la cola de #16 y sus garantías de fallo/reintento, en lugar de copiar otro almacén. `src/i18n/use-locale.ts` de Quorb ilustra el hook y la reconciliación ante error, no el almacén de Nexo.
- **Fuente compartida de textos:** seguir `src/i18n/es.ts`, `src/i18n/en.ts` y `src/i18n/index.ts` de Quorb para catálogos y claves tipadas, y `src/i18n/i18n.test.ts` y `src/i18n/settings-nav.test.tsx` para paridad y pruebas de vistas. Elegir una representación compartida o generar el artefacto nativo desde la misma fuente, sin mantener una segunda copia en Rust.
- **Instalador:** aplazar el traspaso de idioma a una tarea de instalador o release aprobada por separado. Como referencia, `src-tauri/src/installer_locale.rs` de Quorb consume una elección única, acotada y con versión, y la aplica solo a una configuración nueva; un traspaso inválido o fallido deja el selector como alternativa y no sobrescribe configuración existente. Si se adopta después, decidir si la elección en el instalador cumple el criterio de primer uso y comprobar fallos y reinstalación. Esta propuesta no incluye trabajo de instalador ni release.
- **Fallo nativo y datos externos:** usar avisos propios estructurados y localizarlos al mostrarlos; conservar literalmente el texto de las apps y permitir reintentar una actualización de bandeja fallida. Confirmar la presentación del caso en que el idioma quedó guardado pero la bandeja aún no se actualizó.

## ODD propuesto

Las fases son propuestas. Aprobar o publicar este ODD no asigna la issue ni autoriza su implementación. En T2 a T4 se proponen primero pruebas de comportamiento que fallen por la regla nueva, después pruebas focalizadas en verde, preservación de comportamientos existentes y actualización de la documentación correspondiente.

### T1. Aprobación y publicación

- Resultado: resolver las decisiones abiertas y acordar esta versión del plan.
- Dependencias: releer #11, #17, #13, #16, comentarios y PR relacionadas, y coordinar solapamientos.
- Comprobación y salida: solo con autorización separada, publicar el comentario completo en #17 y enlazarlo desde #11, verificando cada operación. Los cambios de estado o asignación requieren autorización propia. Un borrador no convierte la issue en lista para contribuir.

### T2. Catálogos y vistas

- Resultado: fuente única EN/ES, claves tipadas, traducción, hook de idioma, formato y textos accesibles de las vistas.
- Dependencias: T1 e inicio explícito posterior.
- Comprobación y salida: pasan las pruebas de paridad, marcadores, fallback, vistas y ausencia de literales propios sin traducir en ambos idiomas.

### T3. Primer uso y ajustes

- Resultado: elección inicial, cola existente de ajustes, cambios durante la sesión y persistencia con gestión de errores.
- Dependencias: T2 y la configuración de #16.
- Comprobación y salida: pruebas a través de la interfaz de carga inicial, fallo y reintento del primer uso, cambios rápidos y reinicio, sin pérdida de otros ajustes.

### T4. Bandeja y avisos nativos

- Resultado: idioma inicial y actualización en vivo de la bandeja y de los avisos propios, conservando los datos y las acciones de las apps.
- Dependencias: T2/T3 y coordinación con #4.
- Comprobación y salida: pruebas nativas de ambos idiomas, orden de actualizaciones, fallos y reintento, junto con las garantías anteriores del menú y cierre seguro.

### T5. Evidencia en Windows y preparación de entrega

- Resultado: pruebas reales en ambos idiomas y CI de Windows en verde, con evidencia vinculada a los criterios.
- Dependencias: T2 a T4.
- Comprobación y salida: registrar entorno, resultados, capturas y huecos. La entrega, la PR y el merge son decisiones separadas; una PR abierta no significa integración y el merge corresponde al mantenedor.

### Verificación futura

- **Catálogos:** rechazar claves tipadas inválidas; comparar todas las claves EN/ES usadas también por Rust, valores no vacíos y marcadores; comprobar interpolación, fallback, plurales y `Intl` con zona horaria fija.
- **Vistas:** renderizar primer uso, todas las pestañas de ajustes, apps instaladas y conectadas, catálogo, Novedades y estados de carga, vacío y error en ambos idiomas. Verificar textos exactos, nombres accesibles, títulos y teclado, y que los datos externos de las pruebas no se alteren. Añadir una comprobación estática acotada de literales propios en vistas y etiquetas nativas, con excepciones revisadas para datos, marcas y nombres de idiomas.
- **Ciclo de vida:** carga retrasada; elección con fallo y reintento; cambios EN a ES y ES a EN; reinicio; cambios rápidos intercalados con otros ajustes; fallo de guardado y vaciado antes de salir. Proteger archivos corruptos, ilegibles o futuros; comprobar avisos ya visibles y fallos, reintentos y orden al actualizar la bandeja.
- **Bandeja:** comprobar cada etiqueta y aviso propio en EN/ES, inicio sin webview, texto externo intacto, casillas, habilitación, rutas, acciones obsoletas, registro y cierre seguro.
- **Windows real:** usar un perfil de prueba aislado; comprobar primer uso nuevo en cada idioma, bandeja antes y después de elegir, vistas y textos accesibles, submenú de una app y avisos de rechazo, timeout y salida solo del hub. Cambiar en ambas direcciones sin reiniciar, salir y reiniciar para confirmar persistencia. Anotar versión de Windows, capturas, huecos y resultado de CI.
- Candidatos para una ejecución posterior autorizada: `npm test` y `npm run build` desde `apps/hub`, `cargo test -p nexo-hub --locked` y la CI de Windows de `.github/workflows/ci.yml`.

## Preparación y coordinación

El índice #11 mantiene #17 planificada, después de #13 y #16, y enlaza el cuerpo original como alcance vigente. En la consulta de preparación #13 y #16 figuraban cerradas; su cierre por sí solo no acredita integración. Antes de publicar o iniciar hay que releer el roadmap, las dependencias, la issue, los comentarios de toma, sus responsables y las PR relacionadas. No se declara disponibilidad ni reserva con este borrador.

La aprobación del plan, la autorización de publicación y un inicio explícito son decisiones separadas. Al iniciar se identifica y verifica a quien toma la issue; los conflictos se coordinan sin quitar asignaciones ajenas. La entrega prevista es una rama por issue y PR con squash merge y evidencia de las comprobaciones, sujeta a autorización aparte.

## Enlace desde el roadmap

Tras aprobación y autorización de las operaciones, publicar y verificar este comentario en #17 y enlazarlo desde su entrada en [#11](https://github.com/egdev6/nexo/issues/11). Si falla el enlace u otra operación autorizada, informar la publicación parcial y no declarar el roadmap sincronizado.
