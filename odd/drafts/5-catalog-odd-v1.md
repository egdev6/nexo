# ODD propuesto: nexo-i5-odd-v1

<!-- odd-roadmap: proposal=nexo-i5-odd-v1 operation=i5-odd -->

- Issue: https://github.com/egdev6/nexo/issues/5
- Sustituye, solo si se aprueba y publica: el plan ODD pendiente del cuerpo original, conservando su alcance y la [revisión aprobada v1.2](https://github.com/egdev6/nexo/issues/5#issuecomment-6874224023).
- Versión: `nexo-i5-odd-v1`, propuesta para revisión. No autoriza publicación, asignación, implementación ni entrega.
- Motivo e impacto: definir el contrato y publicar una lista blanca oficial que alimente las tarjetas del hub y los datos de Novedades, con estados claros cuando el catálogo no esté disponible. El lugar de publicación requiere una decisión explícita.

## Alcance vigente completo

Definir `catalog.json` con identificador, nombre, descripción, icono, instalador, endpoint de `latest.json`, nivel de integración, `releasedAt`, `featured` y `news`; publicar el catálogo oficial como lista blanca de apps incluidas por mantenimiento. La revisión v1.2 añade arte o icono para la tarjeta, frase corta, etiquetas y enlaces opcionales a GitHub y YouTube validados como HTTPS.

- Dependencia aprobada: [#1](https://github.com/egdev6/nexo/issues/1). Milestone: Catálogo y gestión. [#13](https://github.com/egdev6/nexo/issues/13) aporta la interfaz visual; sus estados de catálogo sin conexión o con error se abordan aquí.
- Los repos privados no aparecen en el catálogo. La lista no se obtiene descubriendo repositorios: mantenimiento revisa e incluye cada app. No se publican enlaces privados, tokens ni metadatos privados.
- Solo la fuente oficial alimenta Novedades mediante `releasedAt`, `featured` y `news[]`. Las apps locales y futuras fuentes de terceros no aportan novedades.
- Fuera de esta issue: descubrimiento de apps instaladas y operaciones reales de gestión (#6 a #9), servidor IPC y estado de ejecución (#4), política y comportamiento completos de Novedades (#10), fuentes remotas de terceros, tokens privados y soporte multiplataforma. Las acciones de muestra no se presentan como operaciones reales.

### Contrato propuesto, sujeto a aprobación

1. Publicar un JSON Schema versionado, tipos y validadores equivalentes en Rust y TypeScript. Se propone un objeto con `schemaVersion: 1` y `apps: []`. Cada app incluye `id`, `name`, `description`, `iconUrl`, `installerUrl`, `latestJsonUrl`, `integrationLevel`, `releasedAt`, `featured`, `news`, `tagline` y `tags`. `artUrl`, `version`, `links.github` y `links.youtube` serían opcionales. Los nombres y la obligatoriedad son propuestas.
2. Cada `id` no está vacío, usa `[a-z0-9-]+` y es único en el catálogo, en línea con `docs/protocol.md`. Se proponen niveles `full`, `update` y `launch`. Todas las URL presentes, incluidas las de descubrimiento y los destinos de redirección, son HTTPS absolutas. Una `version` presente debe cumplir SemVer 2.0.0; las fechas son timestamps RFC 3339 válidos, no solo cadenas con el aspecto correcto. Se rechazan campos obligatorios ausentes y versiones de esquema no compatibles.
3. Cada entrada de `news[]` tendría `id` único dentro de su app, siguiendo la misma regla de ID, además de `title`, `text`, `publishedAt` y `kind` (`new`, `featured` o `update`). Los textos obligatorios no están vacíos. El JSON Schema y la validación de dominio aplican las mismas reglas en ambos lenguajes; `uniqueItems` no basta para garantizar IDs únicos dentro de objetos.
4. `latestJsonUrl` apunta al `latest.json` público HTTPS mantenido por cada app. El cargador del catálogo no lo descarga ni inventa su formato. Antes de consumirlo hay que confirmar su compatibilidad con el manifiesto real del actualizador Tauri de cada app. La actualización la ejecuta la app; una `version` opcional del catálogo es metadato, no prueba de instalación ni de una actualización disponible.

Ejemplo ilustrativo, con dominios reservados y sin afirmar que existan estas publicaciones:

```json
{
  "schemaVersion": 1,
  "apps": [{
    "id": "app-ejemplo",
    "name": "App ejemplo",
    "description": "Una app de ejemplo.",
    "iconUrl": "https://example.org/icon.png",
    "installerUrl": "https://example.org/installer.exe",
    "latestJsonUrl": "https://example.org/latest.json",
    "integrationLevel": "full",
    "releasedAt": "2026-01-01T00:00:00Z",
    "featured": false,
    "tagline": "Una frase breve.",
    "tags": ["Ejemplo"],
    "links": { "github": "https://github.com/example/example" },
    "news": [{
      "id": "lanzamiento",
      "title": "Lanzamiento",
      "text": "Ya disponible.",
      "publishedAt": "2026-01-01T00:00:00Z",
      "kind": "new"
    }]
  }]
}
```

### Cargador, modelo y confianza propuestos

- Al arrancar, el hub consulta la URL oficial fija por HTTPS, valida antes de usar y conserva solo el último catálogo válido. Muestra carga; una respuesta válida sin apps muestra el estado vacío normal. Ante fallo de red o HTTP, JSON malformado o datos inválidos, mantiene la caché válida e indica que está desactualizada o que hubo un error, con opción de reintentar. Sin caché válida muestra un error distinto con reintento. Una respuesta inválida nunca reemplaza la caché ni se presenta una muestra como dato real. Se propone consultar al arrancar y al reintentar, sin TTL ni ETag en v1.
- Mapear `id`, `name`, `description`, `tagline`, `tags` y `links` a `HubApp`; añadir campos explícitos para icono y arte, que el modelo actual no tiene. La capacidad del catálogo se mantiene separada de la procedencia y el estado. Una app oficial no instalada usa `catalog`; cuando está instalada, `full`, `update` y `launch` se traducen a `complete`, `updates` y `local` en la UI. Ajustar las etiquetas para que una app oficial de solo apertura no aparezca como fuente local.
- La instalación, la ejecución y la versión instalada proceden de #4 y de las issues de gestión #6 a #9, no del catálogo. Si aún se desconocen, ampliar el modelo para expresarlo sin inventar valores ni habilitar acciones falsas. Preservar las apps locales, las tarjetas y el estado vacío existentes.
- Preparar una proyección exclusivamente oficial para #10: cada entrada de `news` produce `NewsItem` con ID inequívoco `appId:newsId`, app, título, texto, badge según el tipo y CTA al catálogo. También se entregan `releasedAt` y `featured`; #10 decide actualidad, orden, selección y comportamiento del popup.
- Tratar el texto remoto como texto, no como HTML, y no ejecutar contenido ni instalar automáticamente. HTTPS y la validación protegen el transporte y la forma, pero no prueban la autoría ni la integridad del instalador. Se propone una v1 con una sola fuente oficial HTTPS, sin firma nueva obligatoria del catálogo ni hash obligatorio del instalador; documentar esa limitación y la verificación propia del actualizador de cada app. Hashes o firmas, claves, rotación y fuentes de terceros son decisiones de v2.
- Antes de publicar, mantenimiento verifica la inclusión deliberada y el carácter público de cada app. HTTPS y el esquema no demuestran que un repo sea público. Comprobar acceso anónimo al catálogo y a sus recursos y endpoints, CORS y estabilidad de las URL, sin cambiar la visibilidad de este repositorio privado. Toda escritura pública requiere autorización separada.

### Decisiones abiertas

**Dónde vive el catálogo oficial:**

1. Un repositorio público dedicado, servido mediante GitHub Pages o raw GitHub. Aísla la lista y su revisión, pero añade un repositorio y un despliegue.
2. GitHub Pages de un repositorio público existente. Reduce administración, pero acopla el catálogo a sus responsables y releases.
3. La web de egdev. Permite controlar el dominio, pero depende de su hosting y despliegue.

**Recomendación:** repositorio público dedicado con GitHub Pages y URL HTTPS estable; raw GitHub puede ser alternativa tras verificar CORS y caché. Elegir host y URL antes de publicar, sin hacer público este repo.

También se pide confirmar los nombres y la obligatoriedad de campos, niveles de integración, precisión de fechas y tipos de noticia; el formato real de `latest.json` por app; la representación de estado desconocido y la política de caché/reintento. La alternativa de exigir firmas del catálogo o hashes de instaladores en v1 necesita diseño de distribución y claves antes de implementar.

## ODD vigente

Las fases son propuestas y no están autorizadas. Aprobar o publicar este ODD no inicia la implementación ni autoriza publicar el catálogo.

### T1. Decisiones y publicación del plan

- Resultado: decidir host y defaults, aprobar el ODD y autorizar por separado el comentario en #5, su enlace desde #11 y la actualización del estado.
- Dependencias: #1 y nueva comprobación de la issue, roadmap, dependencias, responsables y PR relacionadas.
- Comprobación y salida: verificar cada operación de planificación autorizada. El borrador local o una publicación parcial no dejan la issue lista para contribuir.

### T2. Formato y validación

- Resultado: esquema versionado, tipos y validación Rust/TypeScript compatibles, fixtures y documentación de endpoint y confianza.
- Dependencias: T1 e inicio autorizado por separado.
- Comprobación y salida: fixtures válidos mínimos y completos, e inválidos por ID o duplicados, URL, versión, fecha, noticias, campos obligatorios y versión de esquema; comparar ambos validadores y pasar pruebas deterministas.

### T3. Cargador y adaptación del hub

- Resultado: carga y caché de la fuente oficial, estados de carga/vacío/error/sin conexión, mapeo de metadatos y estado desconocido, y proyección de noticias solo oficiales.
- Dependencias: T2; coordinar los contratos de #4, #6 a #9 y #10 sin implementar sus funcionalidades.
- Comprobación y salida: HTTP simulado para éxito, vacío, offline, error HTTP, respuesta malformada o inválida, fallos con y sin caché, reintento y recuperación; rechazar redirección insegura, conservar caché válida y comprobar mapeo y procedencia. Preservar tarjetas y apps locales; pasar pruebas deterministas y actualizar la documentación.

### T4. Publicación oficial y evidencia de entrega

- Resultado: publicar una lista revisada y pública en el host elegido, conectar su URL estable y registrar la evidencia de acceso anónimo, endpoints y CORS.
- Dependencias: T1 a T3, decisión de host/URL y autorización explícita posterior para escrituras públicas.
- Comprobación y salida: pruebas y verificaciones de lectura pública satisfactorias. La PR y su merge requieren permisos separados; abrirla no integra el trabajo y el squash merge corresponde a mantenimiento.

## Preparación y coordinación

#5 continúa planificada: solo queda lista para contribuir tras aprobar y verificar la publicación del ODD y sus enlaces/estado, y comprobar sus dependencias y demás condiciones vigentes. Antes de empezar, volver a revisar responsables, tomas y PR relacionadas; coordinar cualquier solapamiento. Un inicio explícito posterior es necesario para identificar al contribuidor y verificar la asignación. Este plan no reserva la issue ni autoriza commit, push, PR o cierre.

## Enlace desde el roadmap

Si se aprueba y autoriza la publicación de este comentario, verificarlo y enlazar su URL desde la entrada de #5 en [#11](https://github.com/egdev6/nexo/issues/11), además del cambio de estado autorizado. Si alguna operación falla, informar el estado parcial y no declarar sincronizado el plan.
