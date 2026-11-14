# ODD propuesto: nexo-i6-odd-v1

<!-- odd-roadmap: proposal=nexo-i6-odd-v1 operation=i6-odd -->

- Issue: https://github.com/egdev6/nexo/issues/6
- Sustituye, solo si se aprueba y publica: el plan ODD pendiente del cuerpo original. Se conserva su objetivo, dependencias y coordinación.
- Versión: `nexo-i6-odd-v1`, propuesta para revisión. No autoriza publicación, asignación, implementación ni entrega.
- Motivo e impacto: concretar la detección de apps oficiales instaladas, su versión y acciones seguras desde el hub. La pista de detección requiere coordinar una nueva versión del catálogo de #5; no cambia el protocolo IPC.
- Cambios: plan pendiente → fases y criterios verificables propuestos; el alcance resultante se describe completo a continuación.

## Alcance vigente completo

Detectar las apps del catálogo instaladas a partir de las entradas de desinstalación NSIS del registro del usuario, mostrar su versión y permitir abrirlas y cerrarlas. Las apps con plugin se cierran mediante `quit` por IPC, nunca mediante terminación forzada. El catálogo oficial sigue siendo una lista blanca: no se incorporan automáticamente otras apps instaladas.

- Dependencias: [#5](https://github.com/egdev6/nexo/issues/5) y [#4](https://github.com/egdev6/nexo/issues/4) para cierre limpio. Ambas están integradas según el contexto de planificación; se comprobarán de nuevo antes de empezar. Milestone: Catálogo y gestión.
- Fuera de alcance: añadir ejecutables propios o catálogos locales, que corresponden a [#9](https://github.com/egdev6/nexo/issues/9); instalación y actualización, de #7 y #8; descubrimiento arbitrario, cierre forzado, cambios del protocolo IPC y soporte fuera de Windows.

### Detección, versión y compatibilidad propuestas

1. Leer, sin modificar, `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` en las vistas de registro de 32 y 64 bits aplicables, deduplicando la misma entrada física. Se recomienda limitar esta primera versión a HKCU; HKLM de solo lectura queda como decisión abierta.
2. Proponer en cada app oficial una pista `detection.windows` con `displayName`, `publisher` y `executableRelativePath` obligatorios. Comparar con `DisplayName` y `Publisher` exactamente tras recortar espacios y usando comparación ordinal de Windows sin distinguir mayúsculas. No usar coincidencias aproximadas ni solo el nombre visible. Confirmar los valores reales y las rutas con responsables de los instaladores NSIS.
3. Una entrada coincidente única indica instalación incluso si falta `InstallLocation` o `DisplayVersion`. Sin pista, con error de lectura, identidad de candidato ausente o inválida, varias coincidencias distintas o una entrada compartida por varias apps, mostrar estado desconocido y su motivo, sin elegir una coincidencia. Solo una lectura completa y correcta sin candidato permite indicar que no está instalada. Una coincidencia ambigua o desactualizada no habilita apertura por ruta; las acciones IPC dependen de la conexión actual, no de la observación de instalación.
4. Mostrar `DisplayVersion` de la entrada como texto, o versión no disponible si falta o es inválida. No sustituirla por `version` del catálogo ni por `latest.json`. La versión comunicada por IPC se identifica por separado y no demuestra instalación.
5. Los validadores Rust y TypeScript actuales de #5 rechazan campos desconocidos en `schemaVersion: 1`: añadir la pista allí rompería lectores existentes. Se propone `schemaVersion: 2` con pistas opcionales, esquema, tipos, validadores, fixtures y documentación coordinados. Los nuevos lectores aceptan v1 y v2 válidos; sin pista, el estado de esa app es desconocido. El IPC v1 no cambia: ambos orígenes se relacionan por ID.
6. Ofrecer un endpoint v2 versionado y cachés separadas por versión, conservando endpoint y caché v1 para clientes antiguos. Los nuevos prefieren v2 válido y pueden usar v1 válido como alternativa con detección desconocida; datos antiguos se señalan y una respuesta inválida nunca reemplaza una caché válida. Un cliente antiguo rechaza v2, por lo que no se sustituye su feed o caché en el mismo lugar. La URL oficial aún no está configurada; elegir y publicar feeds requiere autorización separada.

### Abrir, estado y cierre propuestos

- Para abrir, resolver el `.exe` relativo indicado por el catálogo bajo el `InstallLocation` absoluto y local de la entrada única. Canonicalizar y comprobar contención, archivo regular y enlaces o puntos de reanálisis que escapen de la carpeta justo antes de lanzar. Si falta el directorio, el archivo no existe, la ruta es insegura o no hay acceso, deshabilitar Abrir y explicar el motivo.
- El comando nativo recibe solo el ID oficial, obtiene por sí mismo el catálogo validado y una observación actual y vuelve a validar la ruta. Ejecuta directamente el archivo explícito, desacoplado de la vida del hub, sin shell, búsqueda de comandos, argumentos de metadatos, `UninstallString`, elevación ni rutas arbitrarias de la interfaz. Informar errores; crear el proceso no demuestra que la app se haya abierto o siga ejecutándose.
- Si el plugin está conectado, responde y declara `show`, usar el envío IPC de #4 con la generación actual en vez de crear otro proceso. Un fallo de envío se informa, sin lanzar automáticamente otro proceso. Si el plugin conectado no responde o no declara `show`, deshabilitar Abrir y explicar el motivo. Cuando no hay plugin conectado y la instalación y ruta son inequívocas, solicitar apertura directa. La propia app debe hacer la transferencia y enfocar si es de instancia única; no se promete evitar duplicados o enfocar en apps que no implementen ese mecanismo, ni `show` tiene confirmación de apertura.
- Separar instalación, conexión y evidencia de ejecución. Un registro IPC que responde indica conexión; pérdida de respuesta o desconexión dejan ejecución desconocida, no parada. Se recomienda mantener desconocida la ejecución de apps sin plugin, incluso después de lanzarlas, en lugar de buscar procesos por ruta o nombre. El actual `statusKnown` mezcla instalación y ejecución y necesita representación independiente.
- Cerrar solo cuando haya conexión que responde y capacidad `quit`, usando el resultado correlacionado y la generación actual de #4 con motivo `user` y espera máxima de 10 segundos. Mostrar rechazo, timeout o desconexión; aceptación o `bye` no prueban que el proceso haya salido. Sin conexión o capacidad, incluidas apps sin plugin, deshabilitar Cerrar y explicar que se cierre desde la propia app. Nunca matar ni terminar procesos como alternativa.
- Refrescar al arrancar cuando haya catálogo, al pedirlo, al enfocar el panel y tras abrir o pedir cierre. Evitar bloqueos de UI y descartar resultados anteriores si las lecturas se solapan. Ante fallo parcial mostrar desconocido o datos antiguos identificados, no una ausencia falsa, y mantener acciones inseguras deshabilitadas hasta revalidar.
- Unir por ID estable las observaciones oficiales y las conexiones, sin duplicar filas; conservar también las conexiones sin entrada de catálogo y la bandeja existente. Distinguir estados, versión y recuentos sin acciones de muestra habilitadas ni mezclar fuentes locales con oficiales. #9 mantiene la responsabilidad y el almacenamiento de apps locales.
- Tratar registro y textos como entrada no confiable y mostrarlos como texto. La coincidencia de ruta y publicador no autentica al editor: HKCU y los archivos del mismo usuario pueden falsificarse, y HTTPS no firma el ejecutable.

### Decisiones abiertas

1. **Alcance del registro:** se recomienda HKCU con ambas vistas aplicables. Incluir HKLM de solo lectura ampliaría la cobertura de instalaciones para todos los usuarios, pero exige aprobar reglas de conflicto entre entradas y comprobaciones adicionales.
2. **Identidad y ruta:** se recomienda nombre más publicador exactos y ruta relativa del ejecutable. Confirmar que los instaladores reales proporcionan esos datos; sin identidad suficiente la detección queda desconocida, y sin ruta segura no se habilita Abrir. Cualquier alternativa necesita política de colisiones y migración.
3. **Versión del catálogo:** se recomienda v2 con feeds y cachés separados, compatibilidad de lectura con v1 y ningún cambio IPC. Coordinar esquema, validadores, cargador y publicación con #5; elegir host y URL por separado.
4. **Ejecución sin plugin:** se recomienda estado desconocido frente a enumeración de procesos por ruta, que introduce permisos, múltiples instancias y carreras. No se propone cierre forzado.
5. **Instancia única:** se recomienda delegar la transferencia a cada app y explicar sus límites. Una app sin ese mecanismo puede abrir otra instancia; confirmar la experiencia esperada antes de implementar.

## ODD vigente

Las fases siguientes son propuestas y no están autorizadas. Aprobar o publicar este ODD no inicia el trabajo ni autoriza publicar el catálogo.

### T1. Decisiones y publicación del plan

- Resultado: decidir los puntos anteriores, verificar metadatos NSIS y coordinar el despliegue del catálogo; aprobar el ODD y autorizar por separado el comentario en #6 y su enlace y estado en #11.
- Dependencias: #5 y #4; revisar de nuevo su integración, issue, roadmap, responsables, tomas y PR relacionadas.
- Comprobación y salida: verificar individualmente cada operación autorizada de planificación. Un borrador local no deja la issue lista; el inicio y la asignación son decisiones posteriores.

### T2. Contrato de catálogo y detección

- Resultado: pista y formato versionados coordinados, validadores y cachés compatibles; lectura del registro tras una interfaz inyectable y estados de instalación y versión explícitos, sin cambiar IPC ni almacenamiento local.
- Dependencias: T1 e inicio autorizado por separado.
- Comprobación y salida: dobles de registro y pruebas de paridad Rust/TypeScript para ambas vistas, campos ausentes o inválidos, duplicados y colisiones, errores, v1/v2 válidos, versiones no admitidas, conservación de caché, comportamiento de clientes antiguos y feeds separados.

### T3. Apertura y controles IPC

- Resultado: apertura por ID con validación repetida de ruta, lanzador inyectable y vida independiente, más `show` y `quit` IPC y errores explícitos.
- Dependencias: T2 y la implementación de IPC de #4.
- Comprobación y salida: dobles cubren escapes por ruta absoluta, UNC, recorrido o punto de reanálisis, archivos ausentes, argumentos, observaciones antiguas, errores de lanzamiento, contrato de instancia única, falta de `show`, falta de respuesta o fallo de envío, rechazo/timeout/desconexión de `quit` y ausencia de terminación forzada.

### T4. Estado y refresco del hub

- Resultado: estados independientes y acciones seguras en filas oficiales con refresco ordenado, conservando conexiones sin catálogo, apps locales y la interfaz de catálogo.
- Dependencias: T2 y T3, respetando snapshots y generaciones de #4.
- Comprobación y salida: pruebas por interfaz pública de ausencia frente a estado desconocido, versión instalada, duplicados, cierre no disponible sin plugin, refresco, errores, carreras, mensajes, recuentos y preservación de bandeja, sin falsos éxitos.

### T5. Evidencia Windows y preparación de entrega

- Resultado: registrar entorno y comprobaciones nativas en una VM o cuenta Windows aislada. Instalar realmente paquetes NSIS y modificar la máquina requieren autorización separada.
- Dependencias: T2 a T4 y acceso al entorno autorizado.
- Comprobación y salida: verificar vistas del registro, registros instalado/ausente/ambiguo, versión, apertura desacoplada, transferencia de instancia única, `show` y `quit` del plugin con rechazo y timeout, y UI sin cierre forzado para apps sin plugin. Pasar comprobaciones deterministas, registrar evidencia y señalar cualquier hueco. PR, merge y cierre siguen siendo decisiones separadas.

## Preparación y coordinación

#6 permanece planificada: el ODD local no la deja lista para contribuir. Antes de publicar o iniciar, comprobar el estado vigente del roadmap, dependencias, responsables, tomas y PR relacionadas y coordinar cualquier solapamiento. Un inicio explícito posterior permite identificar al contribuidor y verificar la asignación. Esta propuesta no reserva la issue ni autoriza commit, push, PR o cierre; abrir una PR no la integra y el squash merge corresponde a mantenimiento.

## Enlace desde el roadmap

Si se aprueba y autoriza publicar este comentario, verificarlo y enlazar su URL desde la entrada de #6 en [#11](https://github.com/egdev6/nexo/issues/11), junto con cualquier cambio de estado autorizado. Si falla alguna operación, informar la publicación parcial y no declarar el plan sincronizado.
