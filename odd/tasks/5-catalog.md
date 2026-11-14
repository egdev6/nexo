# Official catalog format and publication (#5) — DRAFT v1
> Proposal: `nexo-i5-odd-v1`. Draft only: no publication, assignment, implementation or delivery is authorized. Roadmap: https://github.com/egdev6/nexo/issues/11. Milestone: Catálogo y gestión; approved dependency: #1.

## Specs

S1 — Original issue body, https://github.com/egdev6/nexo/issues/5, verbatim:

> <!-- odd-roadmap: proposal=nexo-roadmap-v1 operation=i5 -->
>
> ## Objetivo y motivo
> Definir el formato de `catalog.json` (id, nombre, descripción, icono, instalador, endpoint de `latest.json`, nivel de integración, `releasedAt`, `featured`, `news`) y publicar el catálogo oficial como lista blanca: solo aparecen las apps que el mantenedor incluya.
>
> ## Dependencias
> #1.
>
> ## Decisión abierta
> Dónde vive el catálogo oficial. Tiene que estar en un lugar público aunque este repo sea privado: un repo propio, GitHub Pages o la web de egdev.
>
> ## Plan ODD
> Pendiente de detallar cuando se acerque su milestone (planificación progresiva). Antes de empezar se publica su ODD como comentario aprobado.
>
> ## Coordinación
> Para buscar trabajo nuevo, solo cuentan las issues sin asignar. Al empezar una issue de forma explícita: se identifica a quien la toma, se lo agrega como assignee y se revisan las PR relacionadas. Los conflictos se coordinan sin quitarle la issue a nadie.
>
> ## Entrega
> Rama por issue, PR con squash merge y evidencia de las comprobaciones en la descripción. Abrir la PR no la integra: el merge lo hace el mantenedor.
>
> Estado: planificada; no está lista para contribuir hasta que se publique su ODD.

S2 — Approved revision v1.2, https://github.com/egdev6/nexo/issues/5#issuecomment-6874224023, verbatim:

> # Revisión ODD aprobada — nexo-roadmap-v1.2
>
> <!-- odd-roadmap: proposal=nexo-roadmap-v1.2 operation=rev-i5 -->
>
> - Issue: https://github.com/egdev6/nexo/issues/5
> - Sustituye: el cuerpo original (se conserva todo lo que no cambia).
> - Propuesta aprobada: nexo-roadmap-v1.2, 2026-11-14, aprobada por el mantenedor.
> - Motivo e impacto: el diseño v1 del hub (#13) muestra el catálogo con tarjetas más visuales y enlaces para descubrir cada app. El formato del catálogo tiene que darles soporte.
> - Cambios: se añaden campos visuales y de descubrimiento.
>
> ## Alcance vigente completo
> Definir el formato de `catalog.json` (id, nombre, descripción, icono, instalador, endpoint de `latest.json`, nivel de integración, `releasedAt`, `featured`, `news`) y publicar el catálogo oficial como lista blanca: solo aparecen las apps que el mantenedor incluya.
>
> Además: campos visuales (arte o icono para la tarjeta, frase corta de presentación y etiquetas) y enlaces de descubrimiento opcionales a GitHub y YouTube, validados como URL `https`.
>
> ## ODD vigente
> Sin cambios: pendiente de detallar cuando se acerque su milestone. Dependencias: #1. Decisión abierta: dónde vive el catálogo oficial (tiene que ser público).
>
> ## Preparación y coordinación
> Milestone «Catálogo y gestión». Estado: planificada.

### PROPOSED derived acceptance (S1, S2; not approved)

- A1 — The public official catalog is an explicit maintainer-curated allowlist, not repository discovery. Private repos never appear; neither private URLs, tokens nor private metadata enter the public artifacts. Only the official source supplies News, via `releasedAt`, `featured` and `news[]`.
- A2 — Publish a versioned `catalog.json`, a JSON Schema and matching Rust/TypeScript types and validators.
  Proposed v1 envelope: `schemaVersion: 1`, `apps: []`. Each app has `id`, `name`, `description`, `iconUrl`,
  `installerUrl`, `latestJsonUrl`, `integrationLevel`, `releasedAt`, `featured`, `news`, `tagline` and `tags`;
  optional `artUrl`, `version` and `links.github`/`links.youtube`. Field names and requiredness are proposals.
- A3 — IDs are nonempty lowercase `[a-z0-9-]+`, matching `docs/protocol.md`, and app IDs are unique.
  Proposed `integrationLevel`: `full`, `update`, `launch`. Validate all present URLs as absolute HTTPS,
  including discovery links and redirect destinations; parse optional `version` as SemVer 2.0.0 and dates as
  real RFC 3339 timestamps. Reject missing required fields and unsupported schema versions.
- A4 — Proposed `news[]` entries have an app-unique ID under the same ID rule, `title`, `text`, `publishedAt`
  and `kind` (`new`, `featured`, `update`). Validate duplicate IDs, kinds, dates and nonempty required text.
  JSON Schema plus domain validation must enforce the same invariants in both languages; JSON Schema's
  `uniqueItems` alone cannot enforce uniqueness by ID.
- A5 — Each entry points to that app's public HTTPS `latest.json`; it is maintained by the app, not invented
  or fetched by the catalog loader. Document compatibility with the app's actual Tauri updater manifest before
  consumption; update execution remains with the app and the management issues #6–#9. The optional catalog
  `version` is metadata, not proof of an installed or available update.
- A6 — Map official metadata into `HubApp`: id, name, description, tagline, tags and links; add explicit
  icon/art fields because the current model lacks them. Keep catalog capability separate from source and state:
  uninstalled official apps use UI `catalog`; for installed apps map `full`/`update`/`launch` to
  `complete`/`updates`/`local`. Adjust labels so a launch-only official app is not presented as a local source.
- A7 — Installation, running state and installed version come from #4 and the management issues #6–#9,
  not the catalog. Until known, extend the UI model/state to express unknown rather than reporting a fabricated
  installed/running value or enabling a fake action. Preserve local apps and the #13 card and empty-state behavior.
  Installation, update, IPC actions and their real data remain in their owning issues.
- A8 — Provide an official-only projection for #10: map news entries to `NewsItem` with an unambiguous
  `appId:newsId`, app ID, title, text, kind-to-badge and catalog CTA; also supply `releasedAt` and `featured`.
  #10 decides recency, ordering, selection and popup behavior. Local or future third-party sources cannot contribute news.
- A9 — On startup fetch the fixed official HTTPS endpoint, validate before use and persist only the last valid
  catalog. Show loading; on successful empty data show the normal empty state. On network, HTTP, parse, schema
  or domain errors, keep a valid cache and show a stale/error indication with retry; with no valid cache show a
  distinct error/retry state. No invalid response replaces the cache, and no sample data masquerades as live data.
  Proposed freshness: fetch at startup and explicit retry; no TTL/ETag policy in v1.
- A10 — Treat remote text as text, not HTML; do not execute content or auto-install. HTTPS and validation
  protect transport/shape but are not publisher signatures or artifact integrity. Proposed v1 uses the single
  official HTTPS origin without a new catalog signature or mandatory installer hash; document this limitation
  and existing app-updater verification separately. Hash/signature verification, keys, rotation and third-party
  sources are v2 decisions, not implied by HTTPS.
- A11 — Before official publication, a maintainer reviews each included app for public status and intended
  inclusion; HTTPS/schema validation cannot prove a repo is public. Verify the public catalog and referenced
  assets/endpoints anonymously, without exposing this private repo. Check CORS and stable URLs for the chosen
  host. Actual public writes require separate authorization.

### OPEN DECISIONS and recommendations

- **Dónde vive el catálogo oficial:** (1) a dedicated public catalog repo, served via GitHub Pages or raw GitHub; (2) Pages from an existing public repo; (3) the egdev website. Recommend a dedicated public repo with Pages: isolated allowlist/review and stable HTTPS, at the cost of another repo/deploy; raw is a possible alternative subject to CORS/cache checks. Existing-repo Pages reduces administration but couples ownership/releases; the website offers domain control but couples hosting/deployment. Choose the host and URL before publication; do not change this repo's visibility.
- Confirm A2-A4 field names, requiredness, integration enum, timestamp precision and news kinds; confirm A5's per-app updater format with actual app owners. No example URL implies an existing release.
- Confirm A6-A9 unknown-state treatment and cache lifetime/retry policy. Confirm A10's v1 trust baseline versus a signed catalog or mandatory installer hashes; a stronger policy needs key/distribution design before work starts.

## Tasks

All units below are proposed and **not authorized**. Approval to publish the ODD, explicit start/assignment, public catalog publication and delivery are separate gates.

- T1 (S1, S2) Plan and hosting gate — route: maintainer/parent; commit: n/a; status: proposed, not authorized.
  - Outcome: decide hosting and open defaults, approve the ODD, then separately authorize its comment on #5, link from #11 and status update.
  - Dependencies: #1 and a fresh check of the issue, roadmap, dependencies, assignees and related PRs. Exit: authorized planning writes individually verified; a local draft alone does not make #5 ready.
- T2 (S1, S2) Format and validation — route: focused writer; commit: TBD; status: proposed, not authorized.
  - Outcome: versioned schema, Rust/TS types and compatible validation, example/fixtures, updater endpoint and trust documentation.
  - Checks: valid minimal/full fixtures and invalid IDs/duplicates, URLs, versions, dates, news, missing fields and unsupported schema; compare Rust/TS outcomes. Exit: documented invariants and deterministic tests pass.
- T3 (S1, S2) Hub loader and mapping — route: focused writer; commit: TBD; status: proposed, not authorized.
  - Outcome: official fetch/cache, card loading/empty/stale/error/retry states, metadata/unknown-state mapping and official-only News projection; coordinate #4/#6 and #10 without implementing their features.
  - Checks: fake HTTP success/empty, offline, HTTP, malformed/invalid data, cached and uncached failures, retry/recovery, HTTPS redirect rejection, cache preservation and UI mapping/provenance; preserve existing card/local-app behavior. Exit: deterministic tests and relevant docs pass.
- T4 (S1, S2) Official publication and delivery evidence — route: maintainer/parent; commit: TBD; status: proposed, not authorized.
  - Outcome: after explicit permission, publish a reviewed public-only allowlist to the chosen host and connect its stable URL; record anonymous access, referenced endpoint and CORS evidence.
  - Dependencies: T1-T3, host/URL decision and separate public-write authorization. Exit: tests and public-read checks pass; PR/merge remain separate and the maintainer performs any squash merge.

## Log

- L1 (user, verbatim): "sigue. puedes paralelizar agentes". Parent interpretation: draft the next eligible issues' ODDs in parallel; this is draft only, not authorization for publication, assignment or implementation.
