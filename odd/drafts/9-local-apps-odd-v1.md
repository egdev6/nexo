# ODD propuesto: nexo-i9-odd-v1

<!-- odd-roadmap: proposal=nexo-i9-odd-v1 operation=i9-odd -->

- Issue: https://github.com/egdev6/nexo/issues/9
- Sustituye, solo si se aprueba y publica: el plan ODD pendiente del cuerpo original. Se conserva el objetivo, las dependencias y la coordinación de la issue.
- Versión: `nexo-i9-odd-v1`, propuesta para revisión. No autoriza publicación, asignación, implementación ni entrega.
- Motivo e impacto: concretar cómo añadir apps propias o un catálogo local para gestionarlas en este equipo, incluidas apps privadas, con integración de solo apertura. Se amplía el almacén de ajustes de #16 y se reutilizan el formato de #5 y la apertura segura de #6.
- Cambios: plan pendiente → criterios y fases verificables propuestos, con las decisiones abiertas indicadas abajo.

## Alcance vigente completo

El usuario podrá añadir, editar y quitar apps propias con nombre, ejecutable e icono opcional, o configurar un catálogo local. Las apps son locales y su nivel de integración es `launch`. Dependencias originales: [#5](https://github.com/egdev6/nexo/issues/5), para el mismo formato, y [#6](https://github.com/egdev6/nexo/issues/6), para la apertura. [#16](https://github.com/egdev6/nexo/issues/16) aporta el almacén de ajustes. El índice [#11](https://github.com/egdev6/nexo/issues/11) sitúa la issue en Catálogo y gestión y refleja #5 y #6 integradas; se comprobará de nuevo antes de empezar.

Fuera de alcance: instalar o actualizar apps (#7 y #8), fuentes remotas de terceros, publicar catálogos, añadir novedades locales, ejecutar argumentos o forzar el cierre. La propuesta no cambia el protocolo IPC ni convierte los datos locales en catálogo oficial.

### Apps propias y persistencia propuestas

1. En Mis apps, ofrecer añadir, editar y quitar una entrada con nombre no vacío, ejecutable elegido en un diálogo nativo e icono local opcional. Cancelar no cambia nada; validar antes de guardar y conservar la entrada anterior si falla. Confirmar la retirada y permitir editar o retirar aunque el archivo ya no exista. Quitar una entrada nunca borra archivos ni termina procesos.
2. Ampliar el archivo Rust de ajustes de #16 de la versión 2 a una versión 3 propuesta, con identificadores estables, rutas seleccionadas y asociaciones por fuente. Reutilizar su bloqueo, cola de parches y límites de guardado atómico y recuperación para no perder cambios concurrentes de otros ajustes.
3. Migrar v0, v1 y v2 conservando ajustes válidos, el orden de fuentes, metadatos desconocidos de cada fuente y `newsVisit` de v2. Mantener la regla actual de no confiar en `newsVisit` anterior a v2. Distinguir archivo ausente, corrupto, ilegible y de versión futura; no sobrescribir el original ante errores ni modificar versiones futuras.
4. Presentar las apps manuales y las del catálogo local en Mis apps con distintivo localizado `Local` e identificación de fuente, sin llamarlas muestra ni oficiales. Distinguir ejecutable sin configurar, ausente o inaccesible y ejecución desconocida. Deshabilitar Abrir con una explicación y ofrecer reparación o nueva selección. Crear un proceso solo confirma que se solicitó su inicio, no que esté abierto o en ejecución.

### Catálogo local propuesto

- En Ajustes / Fuentes del catálogo, habilitar la selección de un archivo local mediante diálogo nativo y persistir en el mismo almacén un descriptor local único y su ubicación. Permitir retirarlo o sustituirlo sin borrar el archivo, los ejecutables, otras apps ni la fuente oficial. Cancelación, validación o guardado fallidos dejan intactas las fuentes y asociaciones anteriores.
- Validar el documento completo con el formato y las reglas de dominio v1/v2 existentes de #5. Rechazar todo el archivo si es inválido, contiene IDs duplicados, usa una versión no admitida o alguna entrada tiene un nivel distinto de `launch`. Una fuente local nunca usa el cargador, la caché ni la proyección oficial. Se ignoran `news`, `featured` y `releasedAt` para Novedades y sus recuentos: ninguna fuente local alimenta Novedades.
- El formato actual no contiene una ruta absoluta de ejecutable y exige URL HTTPS de instalador, actualizador y arte. Esos campos siguen siendo obligatorios para validar, pero no se consultan ni se usan para abrir. Tampoco se interpreta `detection` como ejecutable local. Cada entrada aparece sin configurar hasta que el usuario elige su `.exe` mediante diálogo nativo; guardar la asociación por ID de fuente e ID de app. No se busca automáticamente en el registro ni se propone cambiar el formato.
- Leer y validar de nuevo al arrancar y al pedir refresco, descartando resultados antiguos si se solapan. Si el archivo falta, es ilegible o pasa a ser inválido o de niveles mezclados, mostrar el error y deshabilitar la apertura de sus entradas sin borrar asociaciones guardadas ni afectar a apps manuales o al catálogo oficial. Una lectura válida recupera las asociaciones cuyos IDs sigan presentes; los IDs desaparecidos no se abren. Retirar una fuente elimina solo sus asociaciones.
- Usar identidades separadas para entradas manuales y para cada par de fuente local e ID de app. No pueden suplantar IDs oficiales o de IPC. Con nombres, IDs o ejecutables iguales entre fuentes, conservar filas separadas e identificadas y avisar si se conoce el duplicado; no fusionar ni reemplazar automáticamente. El refresco no crea filas duplicadas. Se conserva la unión oficial/conectada y la bandeja existente.

### Apertura, cierre y privacidad propuestos

- El comando nativo recibe solo una clave opaca de entrada guardada, nunca una ruta enviada por la interfaz. Asociar únicamente un `.exe` absoluto de disco local elegido explícitamente por el usuario; rechazar rutas relativas, UNC o de dispositivo, archivos no regulares y rutas inseguras con puntos de reanálisis. Revalidar fuente, asociación y ejecutable inmediatamente antes de lanzar.
- Adaptar la apertura segura de #6 para compartir el mecanismo de validación aplicable y lanzamiento directo, conservando la contención de instalación de las apps oficiales. En las locales, la autorización corresponde al archivo concreto elegido, no a una pista de instalación. Lanzar desacoplado, sin argumentos, shell, búsqueda en `PATH` ni elevación; mostrar los fallos. Un reemplazo por el mismo usuario entre comprobación y lanzamiento sigue siendo un riesgo y no se presenta como autenticación del ejecutable.
- Las filas locales de solo apertura no ofrecen Cerrar; indicar que se cierre desde la propia app y nunca matar procesos. Los plugins conectados mantienen sus propias filas IPC y controles existentes según sus capacidades, sin adquirirlos una entrada local por coincidir el ID.
- Usar, si se elige, un icono local con decodificación acotada y alternativa visual si falta o falla, sin acceso general del frontend al sistema de archivos ni URL remotas. Nexo no transmite nombres, rutas, iconos, catálogos ni contenido local, no solicita las URL de sus entradas y no los incluye en telemetría. Esto no controla la red de la app lanzada ni las copias o sincronización configuradas por el usuario o el sistema.
- Traducir controles, estados y errores nuevos a español e inglés y mantener etiquetas accesibles y uso con teclado. Diálogo, lectura de archivos y lanzador tendrán interfaces inyectables para pruebas deterministas.

### Decisiones abiertas

1. **Argumentos:** se recomienda no permitir ninguno en v1, tampoco desde el catálogo. Permitirlos después requeriría autorización por app y un diseño de seguridad, no interpretación por shell.
2. **Iconos:** se recomienda imagen raster local opcional con límites de decodificación y alternativa visual. No extraer inicialmente el icono del `.exe`; hacerlo requiere revisar el procesamiento específico de Windows.
3. **Formato y asociación del catálogo:** se recomienda reutilizar v1/v2 sin cambios y elegir el ejecutable de cada entrada de forma explícita. Los campos HTTPS obligatorios son incómodos aunque inertes; un formato local más simple necesitaría una revisión y versión separadas. Confirmar el equilibrio antes de aprobar.
4. **Duplicados:** se recomiendan filas separadas por fuente con aviso, sin fusión, sobrescritura ni rechazo basado solo en nombre o ruta. Confirmar si se prefiere una regla manual más estricta.
5. **Rutas:** se recomienda solo disco local y rechazar puntos de reanálisis, como precaución coherente con #6. Admitir recursos de red o enlaces necesitaría reglas explícitas de confianza, disponibilidad y carreras.

## ODD vigente

Las fases son propuestas y no están autorizadas. Aprobar o publicar el ODD no inicia el trabajo ni reserva la issue.

### T1. Decisiones y planificación

- Resultado: decidir los puntos anteriores, en especial la asociación de ejecutables y duplicados; aprobar el plan y autorizar por separado el comentario en #9 y las operaciones de enlace y estado en #11.
- Dependencias: #5 y #6; coordinación con el almacén de #16. Revisar roadmap, integración, issue, responsables, tomas y PR relacionadas.
- Comprobación y salida: verificar cada operación autorizada de planificación. Un borrador local no deja la issue lista.

### T2. Almacén y selección

- Resultado: registros locales versionados, descriptores de fuente, migración y selección nativa con errores seguros. Dependencia: T1 e inicio explícito autorizado por separado.
- Comprobación y salida: dobles de diálogo y almacenamiento aislado cubren altas, edición, retirada, cancelación, entradas inválidas, ajustes concurrentes, migraciones v0/v1/v2 con `newsVisit`, metadatos, recarga, fallos de guardado/recuperación y versiones futuras.

### T3. Ingesta de catálogo local

- Resultado: fuente local v1/v2 validada, solo `launch`, asociaciones por fuente, refresco y errores, sin proyección a Novedades ni red. Dependencias: T2 y validadores existentes de #5.
- Comprobación y salida: sistema de archivos simulado cubre archivos válidos/vacíos, malformados, versiones no admitidas, duplicados, niveles mezclados, ausencia, cambios y carreras, IDs reaparecidos, cancelación y retirada. Verificar que los rechazos no modifican datos, no hay peticiones, las novedades están aisladas y no se alteran caché ni proyección oficiales.

### T4. Apertura segura y Mis apps

- Resultado: filas localizadas con fuente, icono alternativo, reparación y apertura nativa por clave, reutilizando #6. Dependencias: T2 y T3.
- Comprobación y salida: dobles de diálogo, archivos y lanzador cubren rutas elegidas frente a inyectadas, archivos ausentes, UNC y reanálisis, cambios antes de lanzar, avisos de duplicados, ausencia de argumentos, shell y terminación forzada, errores y ausencia de Cerrar sin plugin. Preservar contención de apertura oficial, controles IPC, refresco y bandeja.

### T5. Evidencia Windows y preparación de entrega

- Resultado: registrar entorno y comprobaciones nativas del selector, persistencia y edición, apertura segura, reparación de archivos ausentes, refresco de catálogo y límites de privacidad en un entorno aislado autorizado. Dependencias: T2 a T4.
- Comprobación y salida: pasar las comprobaciones deterministas y aportar evidencia Windows o señalar los huecos. PR, merge y cierre requieren decisiones separadas.

## Preparación y coordinación

#9 permanece planificada: el borrador local no la deja lista para contribuir. Antes de publicar o iniciar, comprobar de nuevo el roadmap, las dependencias, responsables, tomas y PR relacionadas y coordinar solapamientos. Un inicio explícito posterior permite identificar al contribuidor y verificar su asignación. Esta propuesta no reserva la issue ni autoriza commit, push, PR o cierre; abrir una PR no la integra y el squash merge corresponde a mantenimiento.

## Enlace desde el roadmap

Si se aprueba y autoriza publicar este comentario, verificarlo y enlazar su URL desde la entrada de #9 en [#11](https://github.com/egdev6/nexo/issues/11), junto con cualquier cambio de estado autorizado. Si falla alguna operación, informar la publicación parcial y no declarar el plan sincronizado.
