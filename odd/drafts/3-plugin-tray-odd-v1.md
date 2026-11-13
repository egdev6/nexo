# ODD aprobado: nexo-i3-odd-v1

<!-- odd-roadmap: proposal=nexo-i3-odd-v1 operation=i3-odd -->

- Issue: https://github.com/egdev6/nexo/issues/3
- Sustituye: el alcance de planificación del cuerpo original de #3, sin reescribirlo.
- Versión: `nexo-i3-odd-v1`, aprobada por mantenimiento. Es un plan, no evidencia de implementación.
- Motivo e impacto: integrar las apps con la bandeja unificada sin perder acceso cuando el hub no está disponible. El plan precisa el ciclo de conexión, la propiedad del icono y las comprobaciones de Windows.

## Alcance vigente completo

El plugin de cada app Windows se conecta al hub, registra su menú y coordina su icono individual. Si el hub falta o se pierde, la app conserva o recupera el acceso normal. También atiende acciones de menú, `show` y `quit`.

Especificaciones del cuerpo original, usadas para trazar las fases y las pruebas:
- **S1:** "Plugin que integra cada app: al arrancar se conecta al hub; si este responde y la app está unificada, no crea su icono y se registra con su menú; si no hay hub, crea su icono normal."
- **S2:** "Si se pierde la conexión, recupera el icono (`set_visible(true)`) y lo vuelve a ocultar cuando el hub regresa."
- **S3:** "Atiende `show` y `quit`."

- Dependencias integradas: [#1](https://github.com/egdev6/nexo/issues/1) mediante [#12](https://github.com/egdev6/nexo/pull/12) y [#2](https://github.com/egdev6/nexo/issues/2) mediante [#14](https://github.com/egdev6/nexo/pull/14).
- Milestone: Bandeja unificada. #3 precede a #4 en el orden aprobado, pero #4 puede avanzar en paralelo y no es requisito para completar el cliente. #5 es independiente, en un milestone posterior.
- Exclusiones: integración de apps externas, servidor del hub #4, catálogo #5, instalador o release, i18n y diseño visual. La v1 es solo para Windows.
- No se aprueban campos ni mensajes nuevos en el protocolo, ni una firma nueva de API Rust. La forma de la API del plugin queda por diseñar, sin presumir una API de apps externas.

### Comportamiento de conexión y bandeja

1. Con hub disponible y app unificada al arrancar, **no se crea ningún icono individual**. Ocultar uno ya creado no satisface este caso. La app se registra y envía su menú.
2. Si falta el hub, se crea el icono normal y se reintenta en segundo plano. Con conexión y `unified` falso, se conserva el icono normal y también se registra la app.
3. Los cambios posteriores de `unified` se aplican de inmediato. Mientras haya conexión, la configuración del hub prevalece sobre las preferencias de visibilidad del icono de la app, sin cambiar su comportamiento habitual de minimizar a bandeja.
4. Ante EOF, pipe roto, tres intervalos de heartbeat sin respuesta o error de protocolo, se recupera el acceso de inmediato: se crea el icono normal si aún no existe o se reutiliza con `set_visible(true)`. Se cierra la conexión y se reintenta según la política y las excepciones indicadas abajo.
5. Al reconectar, se sigue el nuevo `welcome.unified`: con `true` se oculta el icono existente; con `false` permanece visible o se crea si todavía no existe. Pérdidas, retornos y cambios repetidos no deben duplicar iconos ni generar bucles de reconexión.
6. Ante un rechazo o fallo durante el arranque, la app pasa de forma segura al modo independiente, incluso si todavía no existe un icono.

### Registro, acciones y cierre

- Secuencia: `hello` → `welcome` → `register` → `registered` → `menu`. Se anuncian las capacidades `show`, `quit` y `menu` que el host realmente proporcione y soporte.
- Las actualizaciones de menú reemplazan al menú anterior, admiten hasta 20 elementos y excluyen las entradas Open/Quit propias del hub. Las acciones conocidas se despachan y los IDs desconocidos se ignoran.
- `show` muestra, desminimiza y enfoca la ventana principal.
- `quit` responde con el `quit_result` correlacionado dentro de los 10 s del protocolo. Si se acepta, envía `bye` y sale limpiamente; si se rechaza, permanece abierta e informa el motivo. El hub no mata una app que no responde.
- La salida normal envía `bye` cuando sea posible y detiene conexión, heartbeat y reintentos, sin tareas huérfanas ni estado de bandeja obsoleto.

### Límites del protocolo existente

Se reutilizan `docs/protocol.md`, `crates/nexo-protocol`, sus tipos y `encode`/`decode`, sin cambiar el contrato de red.

- El cliente Windows descubre `pipe_name(user_sid)`, `\\.\pipe\nexo-hub-<user-sid>`. Los mensajes son JSON UTF-8 delimitados por salto de línea, de hasta `MAX_LINE_BYTES` = 64 KiB sin contar ese salto.
- `hello` usa `v: 1`; después de `welcome` se usa la versión negociada. Una versión incompatible produce el error tipado `UnsupportedVersion`, cierra la conexión y activa el modo independiente. Los frames malformados o sobredimensionados también son errores de protocolo.
- Se ignoran los campos y capacidades desconocidos según el protocolo, sin agregar campos ni tipos de mensaje.
- `welcome.heartbeat_interval_ms` admite 1.000 a 60.000 ms, con 5.000 ms por defecto. La secuencia de heartbeat aumenta y `heartbeat_ack` la refleja; tres intervalos consecutivos sin respuesta indican pérdida. Las pruebas deterministas no dependen de esperas en tiempo real.
- Para `reject: unsupported_protocol` o `duplicate_app`, se permanece en modo independiente sin reintentar hasta reiniciar la app. Para `invalid_message`, se permanece en modo independiente y se registra el error, sin inventar una política de reintento no especificada.

### Defaults aprobados para implementar

- **Propiedad de bandeja:** el host es dueño del icono y del menú, y proporciona una fábrica o handle de bandeja de creación diferida. El plugin coordina la creación, visibilidad y ocultación de ese único icono y despacha el trabajo de UI de forma apropiada.
- **Arranque:** el presupuesto total inicial de conexión, handshake y registro es de 1 s sin bloquear la UI. Si el pipe no existe, el fallback es inmediato. Al vencer el presupuesto, se crea el icono normal y se reintenta en segundo plano; se cancela el intento vencido y se ignoran sus respuestas tardías. Una sesión nueva y válida puede ocultar luego el icono.
- **Reintentos:** 1 s, 2 s, 4 s y así sucesivamente, con máximo de 10 s y las excepciones de rechazo indicadas arriba. El presupuesto inicial es una política del cliente, no un plazo existente del protocolo ni un campo nuevo.
- **Acciones del host:** callbacks configurados por el host usan los flujos de ventana principal y salida normal de la app. El host puede rechazar la salida con un motivo; el plugin no la fuerza ni cambia el contrato de red.

## ODD vigente

Las fases siguientes son el plan aprobado. La publicación no autoriza por sí sola ejecutar las fases de implementación.

### T1. Publicación y preparación

- Resultado: publicar este ODD completo en #3, enlazarlo desde [#11](https://github.com/egdev6/nexo/issues/11) y mover #3 de `status:needs-review` a `status:approved`.
- Dependencias: plan aprobado, #1 y #2 integradas, y revisión actual de la issue, dependencias y PR relacionadas antes de publicar o iniciar.
- Comprobación: releer y verificar el comentario, el enlace del índice y la etiqueta aplicados.
- Salida: las tres operaciones verificadas. Un borrador local o una publicación parcial no dejan la issue lista.

### T2. Bandeja condicional y ciclo de conexión

- Resultado: arranque, registro y menú, recuperación dinámica de bandeja, pruebas y documentación del comportamiento.
- Dependencias: T1 e inicio autorizado por separado. Un hub simulado y acotado dentro del repositorio sustituye a #4 en las pruebas del cliente.
- Comprobación: pruebas deterministas de comportamiento público y pruebas de pipe de Windows con hub simulado, incluidos fallos, reconexión y ausencia de iconos duplicados.
- Salida: los casos S1 y S2 pasan con la evidencia correspondiente; #4 no necesita terminar primero.

### T3. Acciones del host y cierre limpio

- Resultado: despacho de acciones de menú, `show`, `quit` aceptado o rechazado y cierre, con pruebas y documentación.
- Dependencias: T1 y la conexión e integración del host de T2. Solo se anuncian capacidades realmente soportadas.
- Comprobación: efectos observables en el host y respuestas de protocolo, con pruebas deterministas y hub simulado, incluido el cierre y la limpieza tras rechazo.
- Salida: los casos S1 y S3 pasan con la evidencia correspondiente.

### T4. Evidencia Windows y preparación de entrega

- Resultado: comprobaciones reales de bandeja y ventana en Windows, con evidencia registrada para S1 a S3 y estado explícito de implementación, PR e integración.
- Dependencias: T2 y T3. Cualquier operación de entrega requiere autorización separada.
- Comprobación: ejecutar las verificaciones futuras y registrar fallos o criterios incumplidos, sin presentarlos como integración.
- Salida: pasan las comprobaciones previstas, incluida la experiencia real en Windows. Se trabaja en una rama de issue; una PR autorizada lleva evidencia y el mantenimiento realiza el squash merge.

## Verificación futura, todavía no ejecutada

- **Comportamiento público y estado:** controlar transporte y tiempo; observar conteos de creación/visibilidad, efectos del host y mensajes salientes. Cubrir arranque unificado sin crear icono, hub ausente, arranque no unificado, registro y reemplazo de menú, cambios de `unified`, pérdidas y retornos repetidos sin duplicados. Preservar el modo independiente y minimizar a bandeja.
- **Fallos y acciones:** cubrir EOF, tres acknowledgements ausentes, rechazos, errores de versión y frames, backoff, acciones conocidas y desconocidas, `show`, `quit` aceptado/rechazado y limpieza.
- **Pipe Windows y hub simulado:** usar un servidor pequeño dentro del repositorio, no la implementación de #4, con endpoints aislados del hub real y framing/mensajes v1. Ejercitar handshake, registro, menú, heartbeat, frames malformados/sobredimensionados/con versión incorrecta, rechazos permanentes, desconexión, reconexión, respuestas a acciones/`show`/`quit` y limpieza de recursos. El aislamiento no cambia descubrimiento de producción ni protocolo.
- **Windows real:** usar un host de prueba apropiado del repositorio y el hub simulado. Inspeccionar arranque independiente y unificado, modo no unificado, ciclos de pérdida y retorno, cantidad de iconos, acciones de menú, foco de ventana y `quit` aceptado/rechazado. Registrar entorno y evidencia; la inspección visual complementa, pero no demuestra por sí sola que se crearon cero iconos.

Comandos previstos, **NO EJECUTADOS**:

```sh
cargo test -p tauri-plugin-nexo --locked
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
```

Si el build del workspace necesita el frontend, desde `apps/hub`: `npm run build` (NO EJECUTADO). Una futura ejecución de CI o entrega requiere autorización separada. No se afirman resultados ni totales de pruebas.

## Preparación y coordinación

#3 queda lista para contribuir solo después de verificar la publicación, su enlace desde #11 y la etiqueta aprobada, además de los criterios y dependencias del plan. Esta aprobación no reserva la issue. Antes de iniciar, hay que volver a comprobar su estado, responsables, posibles tomas y PR relacionadas, y coordinar cualquier solapamiento.

Un inicio explícito posterior es necesario para identificar al contribuidor y verificar su asignación antes de implementar. Commit, push, apertura de PR, merge o cierre requieren permisos de entrega separados. Si #4 avanza en paralelo, se debe conservar la compatibilidad con el protocolo aprobado y coordinar por separado cualquier cambio compartido.

## Enlace desde el roadmap

Una vez verificado este comentario, enlazar su URL desde la entrada de #3 en [#11](https://github.com/egdev6/nexo/issues/11). Si falla esa actualización o alguna operación de publicación, informar el estado parcial y no declarar sincronizado el plan.
