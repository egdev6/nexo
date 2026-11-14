# News popup (#10) - DRAFT v1

> Proposal: `nexo-i10-odd-v1`. Draft only; publication, assignment and implementation require separate approval.
> Issue: https://github.com/egdev6/nexo/issues/10; roadmap: https://github.com/egdev6/nexo/issues/11.
> Milestone: Novedades. Recommendations below are not approved behavior or evidence of tests.

## Specs

S1 - Original issue body, https://github.com/egdev6/nexo/issues/10, verbatim:

> <!-- odd-roadmap: proposal=nexo-roadmap-v1 operation=i10 -->
>
> ## Objetivo y motivo
> Mostrar las apps recién liberadas y las destacadas del catálogo oficial, con badge de novedad según la última visita guardada localmente. Solo la fuente oficial alimenta esta vista.
>
> ## Dependencias
> #5.
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

S2 - Approved revision v1.2, https://github.com/egdev6/nexo/issues/10#issuecomment-6874224608, verbatim:

> # Revisión ODD aprobada — nexo-roadmap-v1.2
>
> <!-- odd-roadmap: proposal=nexo-roadmap-v1.2 operation=rev-i10 -->
>
> - Issue: https://github.com/egdev6/nexo/issues/10
> - Sustituye: el cuerpo original.
> - Propuesta aprobada: nexo-roadmap-v1.2, 2026-11-14, aprobada por el mantenedor.
> - Motivo e impacto: en el diseño v1 del hub (#13), Novedades deja de ser una vista o pestaña y pasa a ser un popup llamativo al abrir el hub.
> - Cambios: vista de Novedades → popup en el panel con carrusel de la última novedad.
>
> ## Alcance vigente completo
> Mostrar las apps recién liberadas y las destacadas del catálogo oficial (solo la fuente oficial alimenta Novedades) como un popup superpuesto en la parte superior del panel al abrir el hub, con el contenido de debajo ofuscado. Usa el `Carousel` de egdev con una diapositiva por novedad, empezando por la última. Se muestra solo si hay novedades no vistas según la última visita guardada localmente, y respeta la preferencia «Mostrar novedades al abrir» / «No mostrar al abrir».
>
> ## ODD vigente
> Pendiente de detallar cuando se aborde. Dependencias: #5 (datos de novedades), #13 (vista del popup) y la issue de ajustes persistentes (preferencia).
>
> ## Preparación y coordinación
> Milestone «Novedades». Estado: planificada.

### PROPOSED derived acceptance (S1, S2; subject to approval)

- A1: Use only validated official #5 data, never local/third-party sources or sample data in the native hub.
  Propose an eligible app as released at or before now and either released in the last 30 days (inclusive)
  or currently `featured`. Include its `news[]` entries of any defined kind published at or before now
  within the last 30 days; updates on older, non-featured apps are not included by this recommendation.
- A2: If an eligible app has no eligible explicit `new` or `featured` entry, synthesize one release/feature
  item from its `releasedAt`; prefer the featured badge when `featured` is true, otherwise new. This can
  include an older currently featured app on first visit. Do not duplicate an explicit release/feature item.
  Preserve explicit `new`, `featured`, and `update` kinds; identify entries by typed `(appId, newsId)` keys
  and synthetic items by a separate typed app key. Use one slide per selected item, never one per app alone.
- A3: Sort by actual RFC 3339 instant descending, then stable typed key ascending; exclude future dates.
  Show at most 10 unseen items per opening. The cap must not mark undisplayed items seen; they remain
  eligible for a later opening while they still qualify. A1-A3 are recommendations, not existing #5 rules.
- A4: Extend #16's Rust-owned config from version 1 to version 2 using its existing patch/queue and recovery
  invariants. A visit marker records local `lastVisitAt` on actual flyout show and stable seen item keys;
  unseen means eligible keys absent from that persisted set, not timestamp comparison alone. Migration
  preserves all settings and starts with no seen items; first visit can show the newest qualifying items.
- A5: Recommend recording as seen only slides actually presented, including the initial slide, on close,
  Escape, CTA or flyout hide; navigating does not mark unvisited slides. Freeze the open snapshot. Save
  viewed keys and the visit marker without losing concurrent settings edits; failed writes retain the last
  confirmed marker and expose retry, never falsely claiming persistence. Corrupt/future config keeps #16's
  recovery/read-only safeguards. Prune removed item keys only against a fresh valid official catalog, not
  a stale cache; retain synthetic keys while their app remains. IDs must not be reused for new events.
- A6: After settings and onboarding hydrate, evaluate on each actual flyout show, not every focus event.
  Open at most once in that show cycle when the preference is on and unseen items exist. If data arrives
  late while still visible, evaluate then; after dismissal defer later arrivals until the next show. With
  the preference off, never auto-open or mark items seen; re-enabling it preserves eligible unseen items.
- A7: Reuse #13's in-panel top overlay, obscured/inert background, accessible focus trap, Escape/close and
  egdev manual `Carousel`; no News tab or autoplay. The external `Ver en el catálogo` action uses the
  current slide's app ID, closes the popup and opens/focuses that app in Catálogo, including an installed
  official app otherwise filtered from cards. If it disappeared, show a recoverable unavailable state;
  never navigate to a different app. Installation remains #8 and must not be simulated.
- A8: Reuse #5's validated cache and its loading, stale/error and retry states. An offline/error response
  may show unseen news from a valid cache with a visible stale indication; without a valid cache show no
  news, not sample data. An invalid response must not replace the cache or mark anything seen. The native
  official URL is currently unset, so production news depends on separately authorized #5 publication.
- A9: Preserve the popup's category badges and propose a novelty indication for unseen items there. S1
  asks for a novelty badge but does not say catalog cards; S2 replaces the body and does not specify one.
  Recommend no additional card badge without approval of that placement/scope. If approved, derive it
  from the same unseen keys and cover card visibility and clearing; do not invent a second tracker.

### PROPOSED decisions and baseline

- Confirm the 30-day window, 10-item cap, eligibility of updates on qualifying apps, fallback synthesis,
  and first-visit policy (A1-A3). `featured` has no activation timestamp: featuring an old app later
  cannot be dated; recommend a new uniquely identified official `news[]` entry for each new promotion.
- Confirm viewed-only versus treating all displayed slides as seen on dismissal (A5); viewed-only avoids
  silently losing unvisited slides but may reopen the popup. Confirm per-flyout-show cadence (A6).
- Confirm whether the original badge belongs on catalog cards (A9). A card badge beyond the popup needs
  an explicit scope decision, not an assumption that the superseded body or design already specifies it.
- Existing code at `95b2209`: #13 already supplies the modal and carousel; #16 persists and synchronizes
  `showNewsOnOpen`. `App.tsx` currently opens on late catalog data and focus without unseen tracking;
  the popup CTA is illustrative. #5 maps official `news[]`, not synthetic release/featured events, and
  its native endpoint is unset. Reuse these seams rather than recreating them. No Windows check is implied.

## Tasks

All units are proposed, not authorization to publish, assign, implement or deliver.

- T1 (S1, S2): Refresh #5/#13/#16, issue, roadmap and related work; resolve decisions and approve the plan.
  Separate authorization is needed to publish the comment and update its roadmap link. Exit: verified
  planning writes after approval; an unpublished draft is not a publicly ready issue.
- T2 (S1, S2): Implement official eligibility, identities, ordering, cap and #16 marker migration using
  existing boundaries. Depends on T1 and explicit start. Exit: deterministic data/store tests pass.
- T3 (S1, S2): Integrate actual flyout-show and async loading, seen tracking, preference, accessible popup,
  targeted catalog CTA and #5 cache/error handling. Depends on T2 and coordination with #5/#8. Exit: UI
  behavior, persistence, failure/retry, offline and preservation tests pass; docs reflect actual behavior.
- T4 (S1, S2): Validate on real Windows, capture evidence and prepare delivery. Depends on T2/T3 and the
  official source or clearly identified controlled data. Exit: tests and Windows checks pass; publication,
  assignment, public catalog writes, PR and merge remain separately authorized operations.

### PROPOSED verification plan

- Deterministic data: source isolation; release/feature/news kinds, 30-day boundaries, future dates,
  timezone and equal-instant ordering, duplicates, fallback, empty catalog, first visit and cap overflow.
- Store/UI: v1-to-v2 migration, restart, stable IDs, partial slide viewing, hide/Escape/CTA, cap backlog,
  off/on preference, settings concurrency, failed save/retry, corrupt/future files and safe pruning. Test
  actual show versus focus, late data, no duplicate per show, live updates and missing/installed CTA targets.
- Preserve #13 carousel accessibility/focus/inert behavior and #16 inverse preference/settings persistence;
  cover #5 stale cache, invalid response and uncached offline/error, never substituting sample data.
- Real Windows: tray open/hide/reopen, onboarding, async feed, scrim/focus/keyboard, slide order and CTA,
  preference off/on and restart, valid cache/offline and save failure; record build, data setup and results.

## Log

- L1 (verbatim exchange): Parent: "¿Seguimos con esas tres en paralelo, o preferís probar primero en Windows?" User: "si". Interpretation: draft the #17, #6 and #10 ODDs in parallel only; publication, assignment and implementation require later explicit approval.
