# ODD propuesto: nexo-i10-odd-v1

<!-- odd-roadmap: proposal=nexo-i10-odd-v1 operation=i10-odd -->

- Issue: https://github.com/egdev6/nexo/issues/10
- Sustituye: el detalle ODD pendiente, si se aprueba; no sustituye el alcance de la revisión v1.2: https://github.com/egdev6/nexo/issues/10#issuecomment-6874224608.
- Propuesta aprobada: ninguna. Este comentario es un borrador que requiere aprobación antes de publicarse.
- Motivo e impacto: concretar las novedades oficiales y su seguimiento local, reutilizando el catálogo #5, la interfaz #13 y los ajustes #16. No altera el milestone ni autoriza asignación o implementación.
- Cambios: ODD pendiente → fases y criterios verificables propuestos, sujetos a las decisiones indicadas.

## Alcance vigente completo

Mostrar apps recién liberadas y destacadas del catálogo oficial en un popup superpuesto en la parte superior del panel al abrir el hub. El contenido de debajo queda ofuscado e inerte. No hay pestaña de Novedades. El `Carousel` de egdev presenta una diapositiva por novedad, empezando por la última. El popup aparece solo si hay novedades no vistas según el registro local de visitas y respeta «Mostrar novedades al abrir» y «No mostrar al abrir».

Solo la fuente oficial alimenta Novedades. Se excluyen fuentes locales o de terceros, instalación real y publicación del catálogo. La instalación pertenece a #8; el formato, la fuente oficial y su caché pertenecen a #5.

### Criterios propuestos para selección y presentación

- Una app oficial validada califica si ya se liberó y su `releasedAt` está dentro de los últimos 30 días, incluidos los extremos, o si está marcada `featured`. Una app con fecha de liberación futura no califica.
- De las apps que califican se incluyen las entradas de `news[]` publicadas hasta el momento actual dentro de esos 30 días, de los tipos `new`, `featured` y `update`. Una actualización de una app antigua que no esté destacada queda fuera de esta recomendación.
- Si una app que califica no tiene una entrada `new` o `featured` elegible, se propone crear una novedad derivada de `releasedAt`, con distintivo de destacada si `featured` está activo y de nueva en caso contrario. Así se puede presentar una destacada antigua en la primera visita sin duplicar una novedad explícita de liberación o destaque.
- Cada entrada explícita se identifica por la pareja tipada `(appId, newsId)`; las derivadas usan otra clase de clave por app. Ordenar por instante RFC 3339 de más reciente a más antiguo y desempatar por clave estable ascendente. No presentar fechas futuras.
- Mostrar como máximo 10 novedades no vistas por apertura. El límite no marca como vistas las que no entraron; siguen pendientes mientras califiquen. El período, el límite y la selección anterior son recomendaciones pendientes de aprobación.

### Visitas y preferencia

- Extender el almacén Rust de #16 de versión 1 a versión 2. El marcador propuesto guarda `lastVisitAt` al mostrar realmente el panel y un conjunto de claves vistas. Una novedad es no vista si su clave elegible no está en ese conjunto; comparar solo fechas perdería elementos con el límite y llegadas tardías.
- Migrar la configuración existente sin perder preferencias, con conjunto visto vacío. En la primera visita se ofrecen las novedades elegibles más recientes. Mantener la cola de parches, la validación y la recuperación de #16, sin sobrescribir configuraciones corruptas o de versión futura.
- Se recomienda registrar como vistas solo las diapositivas realmente presentadas, incluida la primera, al cerrar, pulsar Escape, activar el CTA u ocultar el panel. La instantánea abierta no cambia mientras se recorre; las diapositivas no visitadas permanecen pendientes. Una alternativa es marcar todas las diapositivas presentadas en el carrusel al cerrarlo, aunque no se hayan recorrido.
- Una escritura fallida conserva el marcador confirmado anterior y ofrece error y reintento, sin afirmar que se guardó. Los cambios de ajustes y del marcador no deben pisarse. Limpiar claves de entradas retiradas solo con un catálogo oficial fresco y válido, nunca con una copia desactualizada; conservar las claves derivadas mientras la app siga en el catálogo. No reutilizar IDs para novedades diferentes.
- Tras hidratar ajustes y completar el primer uso, evaluar cada vez que el panel se muestra de verdad, no en cada cambio de foco. Abrir como máximo una vez por ciclo visible si la preferencia está activada y hay novedades no vistas. Si los datos llegan tarde, evaluar mientras el panel siga visible; tras cerrar el popup, dejar nuevas llegadas para la siguiente apertura.
- Con «No mostrar al abrir» activado no se abre automáticamente ni se marca nada visto. Al volver a activar la preferencia se conservan las novedades no vistas que sigan calificando. Los dos controles modifican el mismo valor persistido.

### Acciones, caché y distintivos

- `Ver en el catálogo` actúa sobre la app de la diapositiva seleccionada: cierra el popup y abre Catálogo enfocando su tarjeta, incluso si una app oficial instalada quedaría oculta por el filtro habitual. Si la app ya no existe, comunicar que no está disponible y permitir continuar, sin abrir otra app. No instalar ni simular instalación.
- Sin conexión o ante un error, se puede usar una copia oficial válida de #5 e indicar visiblemente que está desactualizada. Sin datos oficiales válidos ni copia válida no hay novedades. Una respuesta inválida no reemplaza la caché ni marca novedades vistas. También se informa un error al guardar la caché aunque la respuesta actual sea válida.
- Mantener los distintivos de categoría del popup y proponer una indicación de novedad para los elementos no vistos. El cuerpo original menciona un badge según la última visita pero no sitúa el badge en tarjetas; la revisión v1.2 sustituye ese cuerpo y tampoco fija esa ubicación. Se recomienda no añadir un badge a las tarjetas sin una decisión explícita. Si se aprueba, debe usar las mismas claves no vistas y desaparecer de forma coherente.

## ODD vigente

Este plan es propuesto, no está aprobado ni publicado. La revisión v1.2 sigue siendo la fuente vigente hasta que se apruebe cualquier cambio.

| Fase | Resultado | Dependencias | Validación | Condición de salida |
| --- | --- | --- | --- | --- |
| 1. Planificación | Resolver las decisiones y aprobar un ODD completo | Revisar #5, #13, #16, issue, roadmap y trabajo relacionado | Comprobar alcance y coordinación actuales | Publicación del comentario y enlace al roadmap solo con autorización expresa y verificación posterior |
| 2. Datos y marcador | Selección oficial, claves, orden, límite y migración del almacén | Fase 1, inicio explícito y contrato de datos #5 | Pruebas deterministas de datos, persistencia y errores | Los criterios acordados pasan sin perder ajustes |
| 3. Integración | Apertura por ciclo, carrusel accesible, preferencia, CTA y caché | Fase 2; coordinación con #5 y #8 | Pruebas funcionales de interfaz, integración y regresión | Se respetan selección, preferencias, accesibilidad y estados de error |
| 4. Windows y entrega | Evidencia real y preparación de entrega | Fases 2 y 3; fuente oficial o datos controlados identificados | Prueba manual en Windows y comprobaciones automatizadas acordadas | Evidencia revisable; PR y merge requieren autorización propia |

### Comprobaciones previstas

- Datos: exclusión de otras fuentes, liberadas y destacadas, tipos de `news[]`, síntesis sin duplicados, límites de 30 días, fechas futuras, zonas horarias, empates, conjunto vacío, primera visita y más de 10 novedades.
- Persistencia: migración v1 a v2, reinicio, claves estables, solo diapositivas vistas, cerrar/Escape/CTA/ocultar, elementos fuera del límite, activación y desactivación, parches concurrentes, fallo y reintento, archivo corrupto o futuro y limpieza segura.
- Interfaz: panel realmente mostrado frente a cambios de foco, datos tardíos, una apertura por ciclo, nueva información, CTA para app instalada o retirada, preferencia inversa y conservación del foco, `inert`, Escape y navegación manual del carrusel.
- Red: catálogo válido, respuesta inválida, copia válida desactualizada y error o desconexión sin copia; nunca presentar muestras como noticias oficiales.
- Windows real: documentar versión y datos de prueba; comprobar apertura desde la bandeja, ocultar y reabrir, primer uso, llegada tardía, capa y teclado, orden y CTA, preferencia tras reinicio, caché sin conexión y fallo de guardado. Adjuntar evidencia a la entrega.

## Preparación y coordinación

- Milestone «Novedades»; estado planificado. Este borrador no convierte la issue en lista para contribuir.
- #5 aporta datos y caché, #13 aporta el popup y #16 aporta configuración y preferencia. En el código actual el popup y el carrusel ya existen, la preferencia está persistida, pero la apertura aún depende de foco y la acción del catálogo es ilustrativa. El endpoint oficial nativo sigue sin configurar; la publicación de la fuente requiere autorización separada.
- Decisiones abiertas: confirmar 30 días, máximo de 10, tipos de novedades, síntesis y primera visita; confirmar si solo cuenta lo visto o todo lo ofrecido al cerrar; confirmar apertura por ciclo y ubicación del badge. Se recomienda lo descrito arriba.
- `featured` no registra cuándo se activó. Recomendar una entrada oficial `news[]` con ID nuevo para cada nueva promoción de una app antigua, en lugar de deducir una fecha de esa bandera.
- Antes de publicar o iniciar, refrescar issue, dependencias, responsables, toma declarada y PR relacionadas. Para trabajo nuevo se consideran las issues sin asignar; ante un inicio explícito, identificar a la persona, asignar y verificar. Coordinar conflictos sin quitar responsables.
- Rama por issue y PR con evidencia; squash merge por el mantenedor. Una PR abierta no equivale a integración.

## Enlace desde el roadmap

Si se autoriza y verifica la publicación del comentario, enlazarlo desde la entrada de #10 en https://github.com/egdev6/nexo/issues/11 solo con la autorización correspondiente. Si el enlace no se actualiza, informar de la publicación parcial sin declarar el roadmap sincronizado.
