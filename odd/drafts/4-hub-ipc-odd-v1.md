# ODD propuesto: nexo-i4-odd-v1

<!-- odd-roadmap: proposal=nexo-i4-odd-v1 operation=i4-odd -->

- Issue: https://github.com/egdev6/nexo/issues/4
- Sustituye, si se aprueba y publica: el alcance de planificación del cuerpo original de #4, sin reescribirlo.
- Propuesta: `nexo-i4-odd-v1`. Pendiente de aprobación y publicación; no autoriza asignación ni implementación.
- Motivo e impacto: completar el servidor IPC y la bandeja unificada sin perder el acceso a las apps; se conservan las dependencias y el milestone del roadmap.
- Cambios: planificación progresiva pendiente → fases y criterios verificables propuestos, con decisiones explícitas sobre presentación, preferencias y cierre.

## Alcance vigente completo

Este es el alcance completo propuesto, no una revisión aprobada. La v1 es solo para Windows. El hub acepta conexiones de apps con el plugin, muestra sus acciones en la bandeja y permite elegir por app si se unifica su icono. El estado de las conexiones alimenta Mis apps sin convertir datos de ejemplo en hechos.

Especificaciones del cuerpo original:

- **S1:** "El hub expone el named pipe, acepta registros y heartbeats, compone en su menú de bandeja las acciones de cada app y permite elegir por app si se unifica o mantiene su icono."
- **S2:** "#1 y #2."
- **S3:** "Pendiente de detallar cuando se acerque su milestone (planificación progresiva). Antes de empezar se publica su ODD como comentario aprobado."
- **S4:** "Para buscar trabajo nuevo, solo cuentan las issues sin asignar. Al empezar una issue de forma explícita: se identifica a quien la toma, se lo agrega como assignee y se revisan las PR relacionadas. Los conflictos se coordinan sin quitarle la issue a nadie."
- **S5:** "Rama por issue, PR con squash merge y evidencia de las comprobaciones en la descripción. Abrir la PR no la integra: el merge lo hace el mantenedor."
- **S6:** "Estado: planificada; no está lista para contribuir hasta que se publique su ODD."

Dependencias declaradas: [#1](https://github.com/egdev6/nexo/issues/1) y [#2](https://github.com/egdev6/nexo/issues/2). El índice [#11](https://github.com/egdev6/nexo/issues/11) sitúa #4 después de #3 en Bandeja unificada. La implementación del cliente sirve como referencia y puede coordinarse en paralelo; #3 no se añade como dependencia nueva. Antes de publicar o iniciar hay que revalidar el estado real, las dependencias y las PR relacionadas.

### Servidor y registro

- Escuchar en `pipe_name(user_sid)`, `\\.\pipe\nexo-hub-<user-sid>`, con descriptor de seguridad restringido al usuario actual. Reservar la primera instancia con `FILE_FLAG_FIRST_PIPE_INSTANCE`; no perturbar otro propietario ni iniciar un segundo servidor.
- Conservar el comportamiento existente de segunda instancia de Tauri: si su manejador la intercepta, muestra el flyout existente. Si falla la propiedad del pipe, informar el fallo y no iniciar otro servidor IPC.
- Atender varias apps sin bloquear la interfaz. Secuencia: `hello`, `welcome`, `register`, `registered`, `menu`, con `heartbeat` y `heartbeat_ack`. El registro conserva identidad, capacidades, menú, generación de conexión y estado de respuesta.
- Rechazar IDs duplicados de forma atómica sin modificar la conexión original. `bye` o EOF retira solo la entrada y el menú de la sesión correspondiente; una conexión nueva válida puede registrarse de nuevo.
- Tras tres intervalos sin heartbeat, marcar la app como no respondiente en el menú sin matarla ni suponer que salió. Un heartbeat posterior recupera el estado de respuesta. EOF sin `bye` indica desconexión inesperada, no prueba que el proceso haya terminado.

### Bandeja y preferencias

- Al hacer clic derecho, proponer un submenú por app registrada, incluso si conserva su icono, además de la entrada `Salir` del hub. Mantener el clic izquierdo que alterna el flyout y su comportamiento de foco.
- Mostrar los elementos del menú de cada app como texto, respetando habilitado y estado marcado opcional. Cada `menu` sustituye el anterior. Dirigir la acción por app e ID actual; ignorar acciones obsoletas, deshabilitadas o de sesiones desconectadas.
- Agregar Abrir y Cerrar del hub solo si la app anunció respectivamente `show` y `quit`. Un control por app envía `unified` al cambiar entre bandeja unificada e icono propio.
- Recomendación: unificar por defecto y conservar la elección por ID durante la sesión del hub, incluso al reconectar. La persistencia tras reiniciar el hub requiere otra decisión y coordinación con ajustes; no se da por incluida en #16.
- Límite de v1: `welcome` precede a `register`, por lo que el hub todavía no conoce el ID. Se propone enviar `welcome.unified: true` y, después de `registered`, enviar inmediatamente `unified: false` cuando exista una excepción. La app no unificada puede quedar brevemente sin icono hasta recibir la excepción. Así se preserva el arranque unificado de #3 sin crear un icono individual y sin cambiar el protocolo. La elección individual inmediata en `welcome` no se puede garantizar con este orden de mensajes.

### Mis apps y datos externos

- Publicar al flyout principal una instantánea de solo lectura del registro y sus cambios mediante eventos. Suscribirse y obtener la instantánea inicial sin perder eventos ni aplicar estados antiguos; ordenar o versionar las actualizaciones y cancelar la suscripción al desmontar.
- Asociar por ID estable sin filas duplicadas e incluir registros reales que no estén en los datos de ejemplo. Una conexión registrada indica presencia en el hub, no prueba de instalación o de la vida del proceso después de desconectar. Sin respuesta o desconectada es estado desconocido, no una afirmación de que la app esté cerrada.
- Separar claramente los datos que siguen siendo ilustrativos de los estados reales. Los controles existentes de ejemplo siguen identificados como no funcionales hasta que sus propias issues los implementen.
- Las apps con integración `updates` o `local` no se conectan al protocolo v1. No inventar su registro IPC ni detección de procesos o estado de ejecución. Catálogo, apertura y gestión externa corresponden a trabajo posterior.
- Mantener mínima la superficie de frontend: instantánea de lectura y escucha del evento necesarios para la ventana principal, sin conceder acceso general a shell, sistema de archivos o pipe.

### Cierre limpio

- Para Cerrar de una app y para `Salir` del hub, enviar `quit` con motivo `user` solo a conexiones que declaren esa capacidad y correlacionar cada respuesta. Esperar como máximo 10 s por cada `quit_result`; mostrar los motivos de rechazo y los timeouts. Nunca terminar procesos a la fuerza.
- Una aceptación o `bye` no prueba que el proceso haya salido. El cliente de #3 puede haber enviado ambos y recuperar su bandeja y conexión si falla el despacho final de salida; el registro debe admitir esa reconexión sin duplicados ni estados obsoletos.
- Política propuesta para `Salir`: si una app rechaza, no responde o no admite `quit`, mantener abierto el hub, explicar lo ocurrido y ofrecer una salida explícita solo del hub. Otras apps que aceptaron pueden haber cerrado ya; no se promete una operación atómica ni rollback.
- En la salida solo del hub, cerrar limpiamente el pipe y las tareas para que las apps restantes recuperen su icono. Ante caída del hub, el cliente existente hace esa recuperación al perder el pipe o los heartbeats.

### Límites del protocolo aprobado

- Reutilizar `docs/protocol.md`, `crates/nexo-protocol`, sus tipos, `encode`, `decode` y `negotiate`. No agregar campos, tipos de mensaje ni una opción de endpoint de producción.
- Los mensajes son JSON UTF-8 por línea, con máximo de 64 KiB sin el salto. `hello` usa `v: 1`; se elige la versión común más alta y se usa en el resto de la sesión.
- Sin versión común, responder `reject: unsupported_protocol` con el rango del hub. Un registro malformado recibe `invalid_message`; un ID duplicado recibe `duplicate_app`. Cerrar tras el rechazo. Una versión incorrecta, un frame malformado o demasiado largo, o un mensaje fuera de secuencia cierran la sesión como error de protocolo.
- Validar ID estable `[a-z0-9-]+`, versión semver y límites de mensaje; aceptar hasta 20 elementos de menú. Ignorar campos y capacidades desconocidos según v1. El intervalo por defecto es 5 s, dentro del rango 1.000 a 60.000 ms; el `heartbeat_ack` refleja la secuencia recibida.
- Las políticas del cliente #3 siguen vigentes: `unsupported_protocol` y `duplicate_app` no se reintentan hasta reiniciar la app; `invalid_message` se reintenta con backoff. El cliente rechaza la decisión de cierre que excede 9 s y contempla recuperar acceso si falla la finalización. No se cambia su contrato.

### Decisiones para aprobar o modificar

1. **Presentación:** recomendamos submenús por app en vez de una lista plana, para separar acciones e IDs repetidos.
2. **Preferencia:** recomendamos mantenerla en memoria y aplicar la secuencia `welcome` y excepción descrita arriba. Hay que aceptar el retraso breve del icono no unificado y decidir la persistencia futura.
3. **Salida del hub:** recomendamos mantenerlo abierto ante rechazo, timeout o falta de capacidad, con una opción explícita de salir solo del hub y sin matar apps.
4. **Apps `updates` y `local`:** recomendamos no atribuirles estado de ejecución desde IPC y dejar su gestión externa para las issues correspondientes.

## ODD vigente

Estas fases son propuestas y no autorizan implementación. Las pruebas y la documentación del comportamiento acompañan a cada unidad; los cambios comprobables siguen un enfoque de pruebas primero.

### T1. Aprobación y preparación

- Resultado: resolver las cuatro decisiones, aprobar una versión concreta y autorizar por separado las operaciones de publicación elegidas.
- Dependencias: #1 y #2, y revisión actual de #4, #11, comentarios, responsables y PR relacionadas.
- Comprobación y salida: verificar cada operación autorizada. Una posible publicación incluye comentar el ODD completo en #4; enlazarlo desde #11 y cambiar estado son operaciones separadas que necesitan autorización expresa. Un borrador local no deja la issue lista.

### T2. Servidor seguro y registro

- Resultado: servidor concurrente, sesiones v1, registro, heartbeat y limpieza, con pruebas y documentación.
- Dependencias: T1 y un inicio explícito posterior que permita verificar la toma de trabajo.
- Comprobación y salida: clientes simulados prueban propiedad del pipe, orden, rechazos, límites, duplicados, liveness, reconexión y aislamiento de sesiones antiguas.

### T3. Bandeja, preferencias y estado del flyout

- Resultado: submenús, acciones, unificación por app y puente mínimo de instantánea/eventos hacia Mis apps.
- Dependencias: T2 y las decisiones sobre presentación y preferencias.
- Comprobación y salida: pruebas de reemplazo de menú, capacidades, marcas, rutas por identidad, carreras entre instantánea y eventos, datos reales frente a ejemplos, clic izquierdo y `Salir` existentes.

### T4. Salida y ciclo de vida

- Resultado: cierre limpio individual y del hub, con rechazos, timeout, recuperación, opción de salida solo del hub y limpieza.
- Dependencias: T2, T3 y la decisión sobre salida.
- Comprobación y salida: pruebas con tiempo controlado verifican correlación, aceptación, rechazo, timeout, app sin capacidad, reconexión después de `bye`, ausencia de terminación forzada y cancelación de recursos.

### T5. Evidencia Windows y preparación de entrega

- Resultado: comprobaciones nativas y reales de bandeja y ventana, con evidencia y riesgos documentados.
- Dependencias: T2 a T4; la entrega requiere autorización posterior independiente.
- Comprobación y salida: completar las verificaciones aprobadas o informar su ausencia; una PR abierta no equivale a integración y el squash merge corresponde al mantenimiento.

### Verificación propuesta

- Usar clientes guionados dentro del crate, siguiendo el patrón de hub simulado del plugin, con tiempo controlado y pipes `nexo-test-` aislados del hub real. Cubrir apps concurrentes, carreras de duplicados, orden y versión incorrectos, UTF-8 inválido, fragmentación, 64 KiB y exceso, 20 y 21 elementos, reemplazo, heartbeat, acciones obsoletas, reconexión y correlación de cierre.
- Verificar la instantánea inicial y el orden de eventos, limpieza de suscripciones, entradas reales, estado desconocido de apps externas y preservación del flyout. En Windows, comprobar primera instancia y acceso restringido al usuario, usando otra cuenta si está disponible.
- Si es viable, usar el plugin real como cliente en una cuenta, sesión o VM Windows aislada con propiedad exclusiva del pipe de producción. Su conector no permite sobrescribir el endpoint; si no es viable, registrar la razón y la evidencia pendiente.
- En Windows real, usar Antena si está disponible o un host real con el plugin, más una segunda app o simulador cuando haga falta. Revisar arranque independiente y unificado, menú y acciones, preferencia no unificada, Mis apps, `show`, cierre aceptado y rechazado, salida solo del hub, caída y reconexión sin iconos duplicados. Registrar el entorno y la evidencia.
- Comprobaciones candidatas, pendientes de autorización: `cargo test -p nexo-hub --locked`; desde `apps/hub`, `npm test`; repetir las pruebas Rust enfocadas en Windows nativo. Para cierre: `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo test --workspace --locked`, `cargo build --workspace --locked` y, desde `apps/hub`, `npm run build`.

## Preparación y coordinación

#4 sigue planificada y no se presenta como lista por este borrador. Antes de publicar, releer las fuentes afectadas y confirmar que no hubo cambios de alcance. Antes de empezar, comprobar dependencias, responsables, tomas y PR, identificar al contribuidor y verificar su asignación solo tras un inicio explícito. No se elimina a otros responsables.

La aprobación del ODD no autoriza por sí misma asignación, implementación, commit, push, PR, merge ni cierre. Toda operación de entrega requiere la autorización aplicable por separado.

## Enlace desde el roadmap

Si se autoriza y verifica el comentario, proponer su enlace desde la entrada de #4 en [#11](https://github.com/egdev6/nexo/issues/11). Esa actualización requiere autorización separada. Si alguna operación autorizada falla, informar el estado parcial y no declarar el roadmap sincronizado.
