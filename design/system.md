# Nexo · sistema de diseño egdev

Sincronización de lectura de EGDEV Foundation, commit `247752f`. Es una selección de tokens y reglas de producto para estas exploraciones, no un sistema inicial ni un volcado de todos los tokens. Fuente canónica de valores: `packages/tokens/src/theme.css` (en el repositorio egdev-design-system); el color resuelto entre paréntesis facilita su uso sin compilar Tailwind. `docs/MATERIAL.md` explica Material v2, pero su valor histórico de `--color-fg-brand-raised` contradice la fuente actual: manda `theme.css`. No se han añadido tokens propios de Antena.

## Colores

| Token | Valor en la fuente | Uso / valor resuelto | Fuente |
| --- | --- | --- | --- |
| `--color-bg-canvas` | `var(--color-primitive-graphite-950)` | Fondo · `#141518` | `packages/tokens/src/theme.css` |
| `--color-surface-0` | `var(--color-primitive-graphite-950)` | Base y pozo · `#141518` | `packages/tokens/src/theme.css` |
| `--color-surface-1` | `var(--color-primitive-graphite-900)` | Panel · `#1B1C20` | `packages/tokens/src/theme.css` |
| `--color-surface-2` | `var(--color-primitive-graphite-850)` | Cabecera, hover · `#232428` | `packages/tokens/src/theme.css` |
| `--color-surface-3` | `var(--color-primitive-graphite-750)` | Selección · `#2D2E33` | `packages/tokens/src/theme.css` |
| `--color-surface-overlay` | `rgba(35, 36, 40, 0.84)` | Superficie flotante, con fallback sólido | `packages/tokens/src/theme.css` |
| `--color-fg-default` | `var(--color-primitive-white)` | Texto principal · `#FFFFFF` | `packages/tokens/src/theme.css` |
| `--color-fg-secondary` | `var(--color-primitive-neutral-200)` | Texto secundario · `#CCCCCC` | `packages/tokens/src/theme.css` |
| `--color-fg-muted` | `var(--color-primitive-graphite-400)` | Metadatos · `#A1A2A8` | `packages/tokens/src/theme.css` |
| `--color-border-default` | `var(--color-primitive-graphite-800)` | Separador decorativo · `#2A2B30` | `packages/tokens/src/theme.css` |
| `--color-border-control` | `var(--color-primitive-graphite-500)` | Contorno de controles · `#7A7B81` | `packages/tokens/src/theme.css` |
| `--color-border-hairline` | `rgba(255, 255, 255, 0.08)` | Borde decorativo de superficie | `packages/tokens/src/theme.css` |
| `--color-border-hairline-strong` | `rgba(255, 255, 255, 0.14)` | Borde de overlay | `packages/tokens/src/theme.css` |
| `--color-primitive-red-neon` | `#FF0036` | Marca, relleno, foco | `packages/tokens/src/theme.css` |
| `--color-primitive-red-dark` | `#CC002B` | Borde de acción | `packages/tokens/src/theme.css` |
| `--color-primitive-red-light` | `#FF335E` | Hover de marca | `packages/tokens/src/theme.css` |
| `--color-primitive-red-200` | `#FF8FA6` | Etiqueta de marca sobre superficies elevadas | `packages/tokens/src/theme.css` |
| `--color-primitive-red-300` | `#FF6680` | Error legible | `packages/tokens/src/theme.css` |
| `--color-alpha-red-12` | `rgba(255, 0, 54, 0.12)` | Tinte de marca | `packages/tokens/src/theme.css` |
| `--color-alpha-red-22` | `rgba(255, 0, 54, 0.22)` | Borde decorativo de etiqueta | `packages/tokens/src/theme.css` |
| `--color-bg-brand-subtle` | `var(--color-alpha-red-10)` | Tinte · `rgba(255, 0, 54, 0.10)` | `packages/tokens/src/theme.css` |
| `--color-action-primary-solid-bg` | `var(--color-primitive-red-neon)` | Acción principal · `#FF0036` | `packages/tokens/src/theme.css` |
| `--color-action-primary-solid-fg` | `var(--color-primitive-black)` | Texto sobre acción · `#000000` | `packages/tokens/src/theme.css` |
| `--color-focus-ring` | `var(--color-primitive-red-neon)` | Foco sobre superficies oscuras · `#FF0036` | `packages/tokens/src/theme.css` |
| `--color-focus-ring-inverse` | `var(--color-primitive-white)` | Foco sobre rojo · `#FFFFFF` | `packages/tokens/src/theme.css` |
| `--color-status-success` | `#2DE2C4` | Activo, acompañado de texto | `packages/tokens/src/theme.css` |
| `--color-status-warning` | `#FFB224` | Actualización, acompañado de texto | `packages/tokens/src/theme.css` |
| `--color-status-info` | `#8AB4FF` | Información | `packages/tokens/src/theme.css` |
| `--color-status-danger` | `var(--color-primitive-red-300)` | Error · `#FF6680` | `packages/tokens/src/theme.css` |

El borde tenue es decorativo, no es el único límite de un control; usar `--color-border-control` para los controles secundarios. El neón pequeño no alcanza AA sobre las superficies 1–3; para etiquetas pequeñas de marca usar `--color-primitive-red-200`. El texto negro sobre el rojo sólido alcanza 5,31:1 según `theme.css`.

## Tipografía

| Token | Valor en la fuente | Uso | Fuente |
| --- | --- | --- | --- |
| `--font-display` | `"Barlow Condensed", "Arial Narrow", sans-serif` | Títulos | `packages/tokens/src/theme.css` |
| `--font-sans` | `"Barlow", system-ui, sans-serif` | Interfaz | `packages/tokens/src/theme.css` |
| `--font-mono` | `"JetBrains Mono", ui-monospace, monospace` | Versiones | `packages/tokens/src/theme.css` |
| `--text-display-pro` | `51.2px` | Título display Pro, peso `800`, interlineado `0.95` | `packages/tokens/src/theme.css` |
| `--text-display-stat` | `28.8px` | Título destacado, peso `800`, interlineado `1` | `packages/tokens/src/theme.css` |
| `--text-heading-small` | `19.2px` | Título de sección, peso `700`, interlineado `1.2` | `packages/tokens/src/theme.css` |
| `--text-body-large` | `16px` | Texto grande, peso `500`, interlineado `1.6` | `packages/tokens/src/theme.css` |
| `--text-body-default` | `12.8px` | Texto de interfaz, peso `500`, interlineado `1.6` | `packages/tokens/src/theme.css` |
| `--text-label-default` | `11.2px` | Etiquetas, peso `600`, interlineado `1.2` | `packages/tokens/src/theme.css` |
| `--text-label-eyebrow` | `11.2px` | Sobretexto, peso `700`, tracking `0.12em` | `packages/tokens/src/theme.css` |
| `--text-meta` | `11.2px` | Metadatos, peso `600`, interlineado `1.3` | `packages/tokens/src/theme.css` |
| `--text-cta-label` | `12.8px` | Acciones, peso `700`, interlineado `1.2` | `packages/tokens/src/theme.css` |
| `--text-code` | `11.2px` | Código y versiones, interlineado `1.6` | `packages/tokens/src/theme.css` |

Las fuentes declaradas son Barlow Condensed, Barlow y JetBrains Mono. Las láminas son autocontenidas y no cargan fuentes: sustituyen por las alternativas del propio sistema `"Arial Narrow", sans-serif`, `system-ui, sans-serif` y `ui-monospace, monospace`, respectivamente.

## Espaciado

| Token | Valor | Uso | Fuente |
| --- | --- | --- | --- |
| `--space-0` | `0px` | Sin espacio | `packages/tokens/src/theme.css` |
| `--space-1` | `3.2px` | Paso mínimo | `packages/tokens/src/theme.css` |
| `--space-2` | `6.4px` | Separación compacta | `packages/tokens/src/theme.css` |
| `--space-3` | `9.6px` | Padding compacto | `packages/tokens/src/theme.css` |
| `--space-4` | `12.8px` | Padding base | `packages/tokens/src/theme.css` |
| `--space-5` | `16px` | Separación | `packages/tokens/src/theme.css` |
| `--space-6` | `19.2px` | Padding de tarjeta | `packages/tokens/src/theme.css` |
| `--space-7` | `22.4px` | Separación | `packages/tokens/src/theme.css` |
| `--space-8` | `25.6px` | Separación de bloques | `packages/tokens/src/theme.css` |
| `--space-10` | `32px` | Separación | `packages/tokens/src/theme.css` |
| `--space-12` | `38.4px` | Separación | `packages/tokens/src/theme.css` |
| `--space-14` | `44.8px` | Separación, altura de acción grande | `packages/tokens/src/theme.css` |
| `--space-16` | `51.2px` | Separación de secciones | `packages/tokens/src/theme.css` |
| `--space-20` | `64px` | Separación amplia | `packages/tokens/src/theme.css` |
| `--space-24` | `76.8px` | Separación amplia | `packages/tokens/src/theme.css` |

## Radios

| Token | Valor | Uso | Fuente |
| --- | --- | --- | --- |
| `--radius-none` | `0px` | Bandas | `packages/tokens/src/theme.css` |
| `--radius-sm` | `3.2px` | Detalle | `packages/tokens/src/theme.css` |
| `--radius-md` | `9.6px` | Controles | `packages/tokens/src/theme.css` |
| `--radius-lg` | `12.8px` | Panel | `packages/tokens/src/theme.css` |
| `--radius-xl` | `17.6px` | Superficie | `packages/tokens/src/theme.css` |
| `--radius-2xl` | `19.2px` | Superficie amplia | `packages/tokens/src/theme.css` |
| `--radius-full` | `9999px` | Píldora / círculo | `packages/tokens/src/theme.css` |

## Sombras

| Token | Valor | Uso | Fuente |
| --- | --- | --- | --- |
| `--shadow-focus` | `0 0 0 2px #141518, 0 0 0 4px #FF0036` | Foco exterior | `packages/tokens/src/theme.css` |
| `--shadow-edge` | `inset 0 1px 0 rgba(255, 255, 255, 0.07)` | Canto de luz | `packages/tokens/src/theme.css` |
| `--shadow-edge-strong` | `inset 0 1px 0 rgba(255, 255, 255, 0.13)` | Canto de overlay | `packages/tokens/src/theme.css` |
| `--shadow-elev-1` | `0 1px 2px rgba(0, 0, 0, 0.7), 0 4px 14px -2px rgba(0, 0, 0, 0.55)` | Tarjeta | `packages/tokens/src/theme.css` |
| `--shadow-elev-2` | `0 2px 4px rgba(0, 0, 0, 0.7), 0 14px 36px -6px rgba(0, 0, 0, 0.75)` | Elevación media | `packages/tokens/src/theme.css` |
| `--shadow-elev-3` | `0 4px 10px rgba(0, 0, 0, 0.7), 0 28px 70px -10px rgba(0, 0, 0, 0.9)` | Overlay | `packages/tokens/src/theme.css` |
| `--shadow-well` | `inset 0 1px 2px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(0, 0, 0, 0.28)` | Pozo | `packages/tokens/src/theme.css` |
| `--shadow-btn-primary` | `inset 0 1px 0 rgba(255, 255, 255, 0.38), inset 0 -1px 0 rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0, 0, 0, 0.6), 0 8px 22px -8px rgba(255, 0, 54, 0.7)` | Botón primario | `packages/tokens/src/theme.css` |

## Material y componentes

| Token | Valor | Uso | Fuente |
| --- | --- | --- | --- |
| `--gradient-sheen` | `linear-gradient(180deg, rgba(255, 255, 255, 0.045) 0%, rgba(255, 255, 255, 0) 42%)` | Brillo cenital | `packages/tokens/src/theme.css` |
| `--gradient-btn-primary` | `linear-gradient(180deg, #FF2D57 0%, #FF0036 52%, #EE0031 100%)` | Botón primario, texto negro | `packages/tokens/src/theme.css` |
| `--gradient-btn-secondary` | `linear-gradient(180deg, rgba(255, 0, 54, 0.20) 0%, rgba(255, 0, 54, 0.08) 100%)` | Botón secundario sobre surface-1 | `packages/tokens/src/theme.css` |
| `--blur-overlay` | `20px` | Desenfoque de overlay con `saturate(150%)` | `packages/tokens/src/theme.css` |
| `--focus-width` | `2px` | Grosor del foco | `packages/tokens/src/theme.css` |
| `--focus-offset` | `2px` | Separación del foco | `packages/tokens/src/theme.css` |

- **Surface**: escalera Grafito, brillo cenital, borde de luz y sombra de dos capas; overlay solo para superficies flotantes y con alternativa sólida para transparencia reducida o sin soporte (`packages/ui/src/primitives/surface/types.ts`, `docs/MATERIAL.md`).
- **Button**: primario con degradado rojo y texto negro; secundario tintado o neutral. Tamaños mínimos `44.8px`, `38.4px`, `32px`; foco exterior y movimiento reducido (`packages/ui/src/atoms/button/types.ts`).
- **Badge / StatusDot**: la etiqueta visible explica el estado; el punto es decorativo. Badge de marca usa `--color-primitive-red-200`; estados `running`, `warning`, `stopped` se acompañan de texto (`packages/ui/src/atoms/badge/types.ts`, `packages/ui/src/atoms/status-dot/types.ts`).
- **NavList / Tabs**: la ubicación activa añade marcador y texto; las pestañas pueden ser subrayadas o segmentadas, con foco diferenciado (`packages/ui/src/molecules/nav-list/types.ts`, `packages/ui/src/molecules/tabs/types.ts`).
- **Input**: pozo en surface-0, contorno de control y etiqueta accesible; foco visible (`packages/ui/src/atoms/input/types.ts`).
- **ModuleCard / Table / Notice**: agrupación de contenido y acciones cercanas, filas alineadas, aviso con resumen, icono y recuperación (`packages/ui/src/molecules/module-card/types.ts`, `packages/ui/src/molecules/table/types.ts`, `packages/ui/src/molecules/notice/types.ts`).

Las recetas históricas CSS de botones, tarjetas en bandas y tablas se contrastaron con `packages/ui/src/styles/legacy/bundle.css`; para las reglas actuales de componentes prevalecen los contratos `types.ts` citados arriba. Las láminas son propuestas estáticas, no implementaciones de `@egdev/ui`; las fichas con iniciales son identificadores provisionales, no logotipos oficiales.
