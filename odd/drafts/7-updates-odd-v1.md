# ODD propuesto: nexo-i7-odd-v1

<!-- odd-roadmap: proposal=nexo-i7-odd-v1 operation=i7-odd -->

- Issue: https://github.com/egdev6/nexo/issues/7
- Sustituye, solo si se aprueba y publica: el plan ODD pendiente del cuerpo original. Se conservan su objetivo, dependencias y coordinación.
- Versión: `nexo-i7-odd-v1`, propuesta para revisión. No autoriza publicación, asignación, implementación ni entrega.
- Motivo e impacto: concretar la actualización autenticada de apps oficiales ya instaladas. #7 y #8 comparten un cambio de catálogo v3; la primera que se integre lo implementa y la otra lo reutiliza.
- Cambios: plan pendiente a fases y criterios verificables propuestos, con el alcance completo descrito a continuación.

## Alcance vigente completo

Consultar el `latest.json` usado por `tauri-plugin-updater` para cada app oficial instalada, avisar si hay una versión nueva, cerrar la app si está abierta, verificar la firma y ejecutar el instalador. La actualización requiere acción del usuario; no se propone instalación automática.

- Dependencias: [#5](https://github.com/egdev6/nexo/issues/5) y [#6](https://github.com/egdev6/nexo/issues/6), integradas según el índice [#11 v1.6](https://github.com/egdev6/nexo/issues/11). Para el cierre con plugin se reutiliza el IPC de #4; los textos del hub siguen #17. Comprobar de nuevo el estado antes de empezar.
- Exclusiones: instalación inicial, responsabilidad de #8; apps y catálogos locales, de #9; publicación del catálogo y cambios en los actualizadores de las apps. La integración del plugin en Antena y Quorb está bloqueada por #28, aplazada hasta liberar Nexo; no se presupone disponible.

### Detección, comprobación y presentación propuestas

1. Comprobar solo apps oficiales con una instalación única detectada por #6. Comparar la versión `DisplayVersion` de HKCU, nunca `version` del catálogo ni la versión IPC, con la del manifiesto. Se recomienda SemVer 2.0.0 estricto, precedencia de versiones preliminares y comparación sin metadatos de compilación. Igual o anterior no es actualización; versión ausente, inválida, instalación ambigua o plataforma no admitida deja el resultado desconocido.
2. Al mostrar el hub, comprobar si corresponde y, mientras siga abierto, usar un intervalo recomendado de seis horas por app. Agrupar comprobaciones simultáneas y limitar concurrencia, tiempo y tamaño de respuesta, sin bloquear la interfaz. Evitar peticiones cuando se sepa que no hay conexión; ante pérdida de red indicar estado offline. Respetar `Retry-After` o la hora de reinicio y aplicar espera progresiva a 429 y 403 por límite. Conservar resultados anteriores identificados como antiguos y reintentar cuando corresponda, sin presentarlos como datos recientes.
3. Validar el formato Tauri real de `latest.json`, incluidos `version`, `notes`, `pub_date` y la entrada `platforms` de la arquitectura Windows actual con `signature` y `url`, respetando sus campos opcionales documentados. Si falta información necesaria, es inválida o la plataforma no está admitida, no habilitar la instalación. Mostrar versión y notas como texto junto a «Actualizar», traducido según el idioma elegido. Antes de actualizar, volver a obtener catálogo y manifiesto válidos y recientes.

### Catálogo v3 y autenticación compartida con #8

- Se propone `schemaVersion: 3`, con `updaterPublicKey` opcional por app: exactamente la clave pública minisign de su `plugins.updater.pubkey`. Los validadores v1/v2 rechazan campos desconocidos, por lo que sus endpoints y cachés permanecen intactos. Añadir endpoint y caché v3 independientes; los nuevos lectores prefieren v3 y pueden volver a v2/v1. Un lector antiguo conserva su feed. Coordinar esquema, validadores Rust y TypeScript, fixtures, cargador, documentación y publicación con #8.
- Restringir `installerUrl`, `latestJsonUrl` y las URL de los instaladores de actualización a assets de releases HTTPS bajo `https://github.com/egdev6/`. Validar URL y ruta mediante un parser, no mediante comparación ingenua de prefijos. La primera de #7 y #8 que se integre implementa este contrato común; la otra lo reutiliza. Publicar el feed requiere autorización aparte.
- El catálogo oficial es la raíz de confianza y sus cambios pasan por PR protegidas. Revisar claves nuevas o cambiadas por ese mecanismo; nunca aceptar claves del manifiesto ni confiar automáticamente en una clave vista por primera vez. Sin clave v3 válida, también al usar v1/v2 como alternativa, se explica por qué no se puede actualizar. Sin firma válida o ante una URL no admitida, no se ejecuta nada. HTTPS no sustituye la firma.
- Minisign autentica los bytes del instalador, no `version`, `notes` ni `pub_date` del manifiesto. Un catálogo o una fuente de releases comprometidos siguen suponiendo riesgos, incluido ofrecer un instalador firmado antiguo con metadatos engañosos.

### Transacción de actualización propuesta

1. El usuario solicita la actualización. El backend recibe solo un ID oficial, obtiene los metadatos confiables y descarga en un directorio temporal de sistema privado y recién creado, no en una ruta proporcionada por la interfaz. Permitir solo redirecciones HTTPS necesarias para assets de GitHub hacia hosts de assets de GitHub explícitamente validados; revisar cada salto, rechazar bajadas a HTTP, credenciales y destinos desconocidos, y no enviar secretos en las redirecciones.
2. Comprobar la firma minisign con el formato compatible con el actualizador de Tauri y la clave del catálogo, antes de ejecutar nada. La verificación debe corresponder exactamente al archivo que se ejecuta: mantenerlo protegido mediante handles u otro mecanismo equivalente comprobado y rechazar sustituciones o rutas temporales inseguras. No usar shell, argumentos arbitrarios, instaladores sin verificar ni elevación. Antena y Quorb configuran `currentUser` y claves de actualizador; confirmar el formato real del asset NSIS y los argumentos admitidos por cada app antes de elegir el modo silencioso o pasivo por usuario.
3. Si hay un plugin conectado que responde y declara `quit`, solicitar cierre mediante el IPC correlacionado y con generación de #4. Un rechazo, timeout, desconexión, falta de respuesta o capacidad detiene el intento y se explica. Aceptación o `bye` no demuestran que el proceso terminó. Sin conexión o plugin, pedir al usuario que cierre la app; tras un fallo del plugin puede cerrarla manualmente y volver a intentarlo. Nunca terminar procesos por la fuerza.
4. En todos los casos, comprobar de forma acotada para la transacción que no queda ninguna instancia del ejecutable instalado resuelto de forma única. Si la comprobación de procesos es inaccesible o incierta, detenerse; ni la confirmación del usuario ni IPC bastan por sí solos. Esto no cambia el estado general de ejecución desconocido de #6 ni demuestra la ausencia de procesos auxiliares.
5. Serializar actualizaciones del hub por app y bloquear Abrir desde el hub durante la operación. Justo antes de ejecutar, volver a detectar instalación y versión, validar clave y metadatos y comprobar procesos. Si algo cambió o es desconocido, detenerse y volver a comprobar. Si la app se actualizó sola a esa versión o a una posterior, descartar la descarga y mostrar la versión real, sin atribuir el éxito al hub. Un actualizador independiente aún puede iniciar después de la última comprobación: impedir por completo esa carrera necesita un bloqueo compartido con las apps y una decisión de coordinación aparte.
6. Esperar el resultado del instalador y volver a detectar la versión en HKCU. Solo indicar éxito con salida correcta y versión objetivo confirmada; una versión posterior indica cambio externo, y una versión ausente, distinta o ambigua deja el resultado sin confirmar. Informar errores y limpiar solo datos temporales creados por el hub en éxito, fallo o cancelación; informar fallos de limpieza y recuperar restos de forma segura tras interrupciones.
7. Mostrar estados y progreso de comprobación, descarga, verificación, cierre e instalación con textos EN/ES de #17. Las notas y diagnósticos externos son datos, no traducciones automáticas ni HTML. Permitir cancelar antes de ejecutar; después no matar el instalador. La selección de app, firma y ruta no queda bajo control arbitrario del frontend.

### Decisiones abiertas y recomendaciones

1. **Frecuencia:** seis horas al mostrar el hub y mientras se ejecuta, con concurrencia limitada y espera marcada por el servidor. Confirmar si un reintento explícito puede adelantar el intervalo local, sin saltarse límites del servidor.
2. **Compatibilidad:** SemVer estricto y solo el asset NSIS de la arquitectura compatible. Confirmar manifiestos reales, codificación de firma y argumentos de instalación por usuario de Antena y Quorb; rechazar variantes no compatibles.
3. **Confianza y redirecciones:** clave v3 reciente, rotación revisada y hosts de assets de GitHub explícitos. Confirmar la lista de hosts y si cada asset debe pertenecer al repositorio de su propia app; coordinar la misma política con #8.
4. **Cierre seguro:** `quit` IPC y comprobación acotada del ejecutable principal, con cierre manual para el resto; visibilidad insuficiente bloquea la actualización. Confirmar el tratamiento de varias instancias y procesos auxiliares.
5. **Actualización simultánea:** revalidar y serializar las operaciones del hub, aceptando explícitamente el riesgo residual de carrera con el actualizador independiente, o diseñar un bloqueo de instalación compartido con cada app. Decidir antes de implementar; el bloqueo requiere coordinación externa.

## ODD vigente

Las fases siguientes son propuestas y no están autorizadas. Aprobar el ODD no inicia el trabajo ni publica el catálogo.

### T1. Decisiones y coordinación

- Resultado: resolver las decisiones, confirmar assets y flags reales y acordar con #8 quién realiza el contrato v3 compartido.
- Dependencias: releer #7, #11, #5 y #6, responsables, tomas y PR relacionadas. Comprobar el estado de #28 sin asumir que las apps ya tienen plugin.
- Comprobación y salida: aprobar una versión concreta y autorizar y verificar por separado el comentario y cualquier enlace o cambio de estado en el índice. La publicación del feed o cambios en repos externos requieren otra autorización.

### T2. Catálogo, descarga y firma

- Resultado: la primera de #7/#8 integra v3 con compatibilidad y la otra lo reutiliza; descarga segura de assets de actualización y verificación ligada al archivo ejecutado.
- Dependencias: T1 e inicio explícito posterior.
- Comprobación y salida: pruebas de compatibilidad v1/v2, caché v3 separada y paridad Rust/TypeScript; claves, firmas, URL y redirecciones inválidas o modificación del archivo impiden ejecutar binarios. Los errores de limpieza se informan.

### T3. Transacción y experiencia del hub

- Resultado: comprobaciones periódicas, notas y progreso localizados, cierre sin fuerza, instalación por usuario y nueva detección.
- Dependencias: T2 y comportamiento existente de #4, #6 y #17.
- Comprobación y salida: pruebas con reloj, HTTP, filesystem, firma, procesos, registro e IPC inyectables para versiones, offline y límites, datos antiguos, fallos de cierre, cierre manual, carreras, códigos de salida, limpieza y estados localizados exactos en ambos idiomas. Preservar las acciones y vistas existentes; una entrada rechazada no inicia el instalador ni modifica la instalación.

### T4. Evidencia Windows y preparación de entrega

- Resultado: comprobaciones en Windows aislado con releases revisadas de Antena y Quorb cuando estén disponibles, rutas con y sin plugin, flags por usuario, fallos reales de firma, nueva detección e interrupciones y limpieza.
- Dependencias: T2/T3 y autorización separada para instalaciones reales o cambios en la máquina.
- Comprobación y salida: registrar resultados deterministas y evidencia Windows, indicando cualquier hueco. Commit, PR, merge y cierre necesitan decisiones independientes.

## Preparación y coordinación

#7 permanece planificada: este borrador no la deja lista para contribuir. Antes de publicar o iniciar, comprobar roadmap, dependencias, responsables, tomas y PR relacionadas, y coordinar el contrato compartido con #8. El inicio explícito posterior permite identificar al contribuidor y verificar su asignación. Abrir una PR no la integra; el squash merge corresponde a mantenimiento.

## Enlace desde el roadmap

Si se aprueba y autoriza publicar este comentario, verificarlo y enlazar su URL desde la entrada de #7 en [#11](https://github.com/egdev6/nexo/issues/11), junto con cualquier cambio de estado autorizado. Si falla una operación, informar publicación parcial y no declarar el plan sincronizado.
