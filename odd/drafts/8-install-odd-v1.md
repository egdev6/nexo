# ODD propuesto: nexo-i8-odd-v1

<!-- odd-roadmap: proposal=nexo-i8-odd-v1 operation=i8-odd -->

- Issue: https://github.com/egdev6/nexo/issues/8
- Sustituye, solo si se aprueba y publica: el plan ODD pendiente del cuerpo original. Se conservan su objetivo, dependencias, coordinación y entrega.
- Versión: `nexo-i8-odd-v1`, propuesta para revisión. No autoriza publicación, asignación, implementación ni entrega.
- Motivo e impacto: concretar la instalación segura de apps oficiales para el usuario actual. La verificación necesita una versión nueva del catálogo de #5, compartida con #7, sin cambiar los endpoints existentes.
- Cambios: planificación pendiente → fases y aceptación verificables propuestas. El alcance resultante completo figura a continuación.

## Alcance vigente completo

Descargar e instalar desde el hub las apps del catálogo oficial que no estén instaladas y verificar la integridad y autenticidad del instalador antes de ejecutarlo. La instalación es una acción explícita del usuario, no automática.

- Dependencias: [#5](https://github.com/egdev6/nexo/issues/5) y [#6](https://github.com/egdev6/nexo/issues/6). El roadmap [#11 v1.6](https://github.com/egdev6/nexo/issues/11) las indica integradas y sitúa #8 en el milestone Catálogo y gestión; se volverá a comprobar antes de iniciar.
- Fuera de alcance: actualizar apps, responsabilidad de [#7](https://github.com/egdev6/nexo/issues/7), salvo el contrato compartido; incorporar ejecutables o catálogos locales, responsabilidad de [#9](https://github.com/egdev6/nexo/issues/9); instalaciones para todos los usuarios, elevación, otras plataformas y cambios del protocolo IPC. La publicación del catálogo y los cambios reales de máquina necesitan autorización separada.

### Acción y estados propuestos

1. En Windows, ofrecer **Instalar** en la tarjeta oficial solo si #6 confirma con una observación actual que la app no está instalada. Deshabilitar y explicar los estados instalada, desconocida, ambigua, desactualizada o instalación en curso. Conservar filas oficiales, conexiones, apps locales, Novedades y la vista de muestra identificada como tal.
2. Pedir confirmación localizada que identifique la app y la acción antes de descargar o ejecutar. Cancelar o cerrar la confirmación no modifica nada. La aprobación nativa es de un solo uso y queda asociada a la app y la release seleccionada. El comando nativo acepta solo el ID oficial, nunca una URL, clave, firma, ruta ejecutable o comando arbitrario enviados por la interfaz.
3. Repetir la detección de #6 al iniciar y justo antes de ejecutar. Si la app ya está instalada o el resultado es desconocido, rechazar la operación. Serializar por app las peticiones, clics y reintentos para no iniciar dos instaladores.

### Catálogo compartido y confianza propuestos

1. #7 y #8 comparten una propuesta de esquema **v3** con `updaterPublicKey` opcional por app: la misma clave pública minisign que usa `plugins.updater.pubkey` en esa app. La primera issue de las dos que se integre implementa el cambio compartido y la otra lo reutiliza. Coordinar esquema, tipos y validadores Rust/TypeScript, fixtures, documentación, cargador y caché nativa.
2. Mantener intactos los endpoints y cachés v1 y v2; añadir v3 con endpoint y caché propios, en paralelo como se hizo con v2. Los lectores nuevos prefieren v3 y pueden usar v2/v1 para mostrar y detectar. Una clave ausente o inválida o un catálogo antiguo no autorizan instalar ni actualizar. Una respuesta inválida no reemplaza una caché válida. El despliegue público requiere coordinación y autorización separada.
3. En v3, restringir `installerUrl`, `latestJsonUrl` y las URL de artefactos de actualización usadas por #7 a assets de releases HTTPS bajo `https://github.com/egdev6/`. Analizar host, propietario y ruta de release, sin confiar en un prefijo textual; rechazar credenciales, hosts o rutas engañosos, URL malformadas y otros esquemas. Validar cada redirección antes de seguirla y rechazar cualquier cambio de host; solo se permiten redirecciones acotadas en el mismo host que sigan cumpliendo la política. Aplicar esto al instalador, su `.sig` y las descargas de actualización. La validación v1/v2 no cambia.
4. En el límite nativo, obtener y validar el feed oficial v3 desde su fuente HTTPS fija, sin aceptar como fuente confiable bytes arbitrarios enviados por la interfaz. Se recomienda exigir una descarga válida y actual del feed para cada instalación: una caché antigua o v1/v2 pueden mostrarse, pero no autorizan ejecutar. Antes del lanzamiento, comprobar de nuevo que el ID, la URL y la clave siguen siendo los elegidos; abortar si cambian o se retiran.
5. Las PR protegidas del catálogo público y HTTPS constituyen la raíz de confianza propuesta, no una firma del catálogo. La firma del instalador no protege frente a una clave comprometida, código malicioso firmado o compromiso de la cuenta local. Confirmar política de rotación, revocación y retroceso con #7 y mantenimiento.

### Descarga, verificación y ejecución propuestas

1. Descargar el instalador y su firma separada desde la URL del instalador más `.sig`, en un directorio temporal del sistema único y privado. No utilizar nombres remotos como rutas locales. Limitar bytes y tiempo de conexión y total durante el streaming, incluso si falta `Content-Length` o es incorrecto. Recomendación inicial: 512 MiB para el instalador, 16 KiB para la firma, 10 segundos de conexión y 15 minutos totales por descarga. Rechazar respuestas truncadas, demasiado grandes o fallidas.
2. Mostrar progreso por bytes y porcentaje si se conoce el tamaño; en otro caso, progreso indeterminado. Mantener la interfaz disponible y presentar las etapas de descarga, verificación e instalación.
3. Verificar los bytes reales del instalador con minisign compatible con el updater de Tauri y la clave v3 seleccionada **antes de ejecutar**. Clave o firma ausentes o malformadas, clave incorrecta, manipulación o cualquier error de verificación impiden la ejecución. Ni HTTPS ni un hash sin firma sustituyen esta comprobación. Proteger las rutas temporales contra escapes y puntos de reanálisis y evitar la sustitución entre verificación y lanzamiento, con handles adecuados en Windows; si no se puede garantizar que se lanzan los mismos bytes, rechazar.
4. Lanzar directamente solo el instalador NSIS verificado de una build confirmada para el usuario actual; se recomienda el parámetro silencioso `/S`. No usar shell, búsqueda por PATH, argumentos arbitrarios, `runas` ni reintento elevado. Rechazar si el hub está elevado o el ejecutable requiere elevación. Antena y Quorb tienen, según la comprobación previa, `bundle.windows.nsis.installMode: currentUser` y publican `*_x64-setup.exe` junto a `.sig`; confirmar release, clave y parámetros reales con sus responsables y en Windows antes de usarlos. Un ejecutable firmado sigue teniendo los permisos del usuario.
5. Cancelar antes del lanzamiento detiene la operación y limpia sus archivos. Después del lanzamiento no se mata el instalador ni se presenta como cancelado: se sigue su proceso, se evita otro inicio y se informa de que no es cancelable. Tras un cierre o caída del hub, limpiar al siguiente inicio solo restos propios que ya no estén en uso. Informar si la limpieza falla.
6. Informar error al fallar el lanzamiento o si el proceso termina con código distinto de cero. Tras un código cero, refrescar la detección de #6: solo un resultado actual de instalada se presenta como tal; ausencia, estado desconocido o fallo son resultado no resuelto, no éxito. No deducir la versión del catálogo ni del lanzamiento. Antes de reintentar, comprobar de nuevo la instalación y que no siga otro proceso en curso.
7. Localizar con #17 confirmación, progreso, cancelación, motivos de deshabilitación y errores de red, tamaño, tiempo, URL, firma, permisos, lanzamiento, proceso, detección y limpieza en español e inglés. Tratar diagnósticos como texto y evitar registrar tokens, datos privados o contenido ejecutable.

### Decisiones abiertas y recomendaciones

1. **Redirecciones de GitHub:** comprobar la entrega de las releases reales. Si GitHub redirige a otro host de assets, la política estricta propuesta bloquea la descarga aunque la firma sea válida. Se recomienda mantener el bloqueo y decidir después entre una ruta de release que permanezca en el mismo host o una política de redirecciones más acotada y revisada, aprobada por separado para #7 y #8. Este borrador no autoriza excepciones.
2. **Confianza y límites:** se recomienda exigir v3 reciente y validado de forma nativa, sin instalación offline, con los límites anteriores. Confirmar cifras, rotación/revocación de claves y protección frente a retrocesos del catálogo antes de implementar.
3. **Modo y cancelación:** se recomienda NSIS `currentUser` con `/S`, sin elevación, y cancelar solo antes de ejecutar. Confirmar los parámetros y la experiencia en Windows; otros tipos de paquete necesitan una decisión propia, sin alternativas silenciosas.
4. **Apps iniciales:** confirmar con Antena y Quorb las parejas de assets y la codificación exacta de sus claves del updater. Las apps sin clave verificada siguen visibles pero no se pueden instalar.

## ODD vigente

Las fases siguientes son propuestas y no están autorizadas. Aprobar o publicar el ODD no inicia la implementación ni autoriza publicar el catálogo o instalar apps.

### T1. Decisiones y coordinación

- Resultado: resolver las decisiones abiertas y coordinar contrato v3, #7 y publicación del catálogo. Aprobar el ODD y autorizar por separado el comentario en #8 y cualquier enlace o cambio de estado en #11.
- Dependencias: #5 y #6; revisar nuevamente su integración, roadmap, responsables, tomas y PR relacionadas.
- Comprobación y salida: verificar las decisiones y cada operación de planificación autorizada. Un borrador local no reserva ni deja lista la issue.

### T2. Catálogo v3 y límite de confianza compartidos

- Resultado: la primera de #7 y #8 que se integre aporta claves, política de URL, endpoint y caché v3 separados, validadores y compatibilidad; la otra reutiliza el contrato.
- Dependencias: T1, coordinación de mantenimiento e inicio autorizado por separado.
- Comprobación y salida: pruebas de claves y URL válidas e inválidas, escapes de host y ruta, redirecciones, paridad y clientes v1/v2, cachés aisladas, fallback sin instalación, origen nativo y cambios de clave. La publicación efectiva del feed necesita autorización propia.

### T3. Servicio de descarga e instalación

- Resultado: confirmación ligada al ID, operación única por app, descargas limitadas, verificación de firma, temporales protegidos, ejecución sin elevación, cancelación, limpieza y detección posterior de #6.
- Dependencias: T2 y acceso al contrato de detección de #6.
- Comprobación y salida: pruebas deterministas mediante interfaces inyectables de HTTP, archivos, firmas, procesos y detección. Cubrir límites, timeouts, redirecciones, manipulación, carreras, duplicados, rechazos sin ejecutar, código no cero, redetección y limpieza; verificar también una fixture firmada real.

### T4. Interfaz y traducciones

- Resultado: confirmación, motivos de indisponibilidad, progreso, cancelación, errores y estados de instalación veraces en español e inglés.
- Dependencias: T3 y coordinación con cambios compartidos de #7 y #9.
- Comprobación y salida: pruebas de comportamiento para estados desconocido, instalado y en curso, reintentos, cambio de idioma y progreso; preservar catálogo, filas conectadas, locales y de muestra, Novedades y bandeja.

### T5. Evidencia en Windows y preparación de entrega

- Resultado: verificar redirecciones reales, firmas, parámetros NSIS, instalación por usuario y redetección en una VM o cuenta Windows aislada. Las descargas e instalaciones reales y cualquier cambio de máquina requieren autorización separada.
- Dependencias: T2 a T4 y acceso a un entorno autorizado.
- Comprobación y salida: registrar entorno, resultados deterministas y nativos autorizados y cualquier hueco. PR, merge y cierre necesitan decisiones separadas.

## Preparación y coordinación

#8 permanece planificada: este ODD no publicado no la deja lista para contribuir. Antes de publicar o iniciar, comprobar el estado vigente del roadmap, las dependencias, responsables, tomas y PR relacionadas; coordinar el trabajo compartido con #7 y cualquier solapamiento con #9. Una solicitud explícita posterior de inicio permite identificar al contribuidor y verificar la asignación. Esta propuesta no reserva la issue ni autoriza commit, push, PR o cierre. Abrir una PR no la integra; el squash merge corresponde al mantenimiento.

## Enlace desde el roadmap

Si se aprueba y autoriza publicar este comentario, verificarlo y enlazar su URL desde la entrada de #8 en [#11](https://github.com/egdev6/nexo/issues/11), junto con cualquier cambio de estado autorizado. Si falla alguna operación, informar la publicación parcial y no declarar el plan sincronizado.
