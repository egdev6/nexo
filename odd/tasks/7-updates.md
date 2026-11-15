# Updates from the official catalog (#7) — APPROVED v1 + L2
> Proposal: `nexo-i7-odd-v1`, approved and published (https://github.com/egdev6/nexo/issues/7#issuecomment-6883148947). L2 changes A2-A4 and T2.
> Roadmap: https://github.com/egdev6/nexo/issues/11, v1.6. Milestone: Catálogo y gestión.

## Specs

S1 — Original issue body, https://github.com/egdev6/nexo/issues/7, verbatim:

> <!-- odd-roadmap: proposal=nexo-roadmap-v1 operation=i7 -->
>
> ## Objetivo y motivo
> Consultar el endpoint de `latest.json` (el mismo de `tauri-plugin-updater`) de cada app instalada, avisar si hay una versión nueva y actualizar: cierra la app si está abierta, verifica la firma y ejecuta el instalador.
>
> ## Dependencias
> #5 y #6.
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

### Derived acceptance (S1; approved; A2-A4 amended by L2)

- A1 — Only uniquely detected, installed official apps participate. Reuse #6's HKCU observation and its
  `DisplayVersion`, not catalog `version` or IPC version. Compare strictly valid SemVer 2.0.0 values using
  precedence, including prereleases and ignoring build metadata; equal or older is not an update. Missing,
  invalid or ambiguous installation/version and unsupported platform mean unknown, never an inferred update.
- A2 — (L2) Update availability comes from the official catalog v3, not from app `latest.json`. Re-evaluate when
  the catalog loads or refreshes and when #6 detection changes; never block the UI. Before starting an update,
  require a fresh native v3 fetch (as #8 does); a stale cached catalog may show availability labelled stale but
  cannot start an update.
- A3 — (L2) An update is available when the catalog v3 entry has a valid `updaterPublicKey`, a policy-valid
  `installerUrl` and a `version` greater (SemVer precedence, A1) than the installed `DisplayVersion`. Show the new
  version beside the localized `Actualizar` action, with the catalog's latest news entry for that app as plain-text
  notes when present; no automatic install. `latestJsonUrl` is not fetched by the hub.
- A4 — (L2) Done by #8 (PR #32): catalog v3 with `updaterPublicKey`, release-asset URL policy, separate v3
  endpoint/cache and fallback. #7 reuses it unchanged; the URL policy is not widened.
- A5 — The catalog is the trust anchor, maintained by protected PRs; HTTPS alone does not authenticate a binary.
  Missing/invalid v3 key, legacy fallback without a key, invalid signature or untrusted URL disables/refuses update,
  with an explanation and no execution. Review key additions/changes via protected PR; never trust a key supplied
  by the manifest or silently use trust-on-first-use. Minisign authenticates the installer bytes, not manifest
  version, notes or date; a compromised catalog or app release source remains a trust/rollback risk.
- A6 — For a user-requested update, the native side accepts an official app ID, obtains fresh trusted metadata and
  downloads to a private, newly created system temp directory, not a UI-provided path. Allow only bounded HTTPS
  redirects needed for GitHub release assets to explicitly vetted GitHub asset hosts; validate every hop, forbid
  downgrade/credentials and never send secrets to redirects. Reject unknown hosts, malformed URLs and HTTP errors.
- A7 — Verify the chosen Windows NSIS installer's exact bytes with Tauri-compatible minisign handling and the
  catalog key before running anything. Bind verification to the exact file executed using protected handles or an
  equivalent tested mechanism; fail closed on replacement, unsafe temp paths or inability to ensure this binding.
  No shell, arbitrary command/arguments, unsigned fallback or elevation. Antena/Quorb configs specify `currentUser`
  and updater keys; confirm their actual artifacts and flags. Use the supported per-user NSIS silent/passive mode,
  not an assumed universal flag.
- A8 — Before launch, close a connected responsive plugin with #4's generation-fenced correlated `quit`; refusal,
  timeout, disconnect, unresponsive or missing capability stops the attempt and is explained. Acceptance or `bye`
  is not proof of OS exit. For an unconnected/non-plugin app ask the user to close it, never kill it; a user can
  close a failed plugin manually and retry. In all cases, confirm the uniquely resolved installed executable has
  no running instance via a bounded, transaction-scoped Windows process check; unknown/inaccessible means stop.
  Do not change #6's general running-state semantics or infer closure from IPC or the user's confirmation alone.
- A9 — Serialize hub updates per app and fence hub Open while one is active. Immediately before installer launch,
  re-detect HKCU version and installation, revalidate metadata/key and process state; abort/recheck if anything
  changed or became unknown. If the app updated itself to the target or newer, discard the download and show its
  actual version, not success for the hub. An independent updater can still race after the final check; preventing
  that race needs a shared installer lock with the apps, a separate coordination decision, not an IPC guarantee.
- A10 — Wait for the installer result, then re-detect. Report success only for a successful exit and the expected
  target version; a newer version indicates an external change, and missing/mismatched/ambiguous results remain
  unconfirmed. Show localized checking, download progress, verification, close, install, cancellation and errors
  using #17's EN/ES source; release notes and external diagnostics remain untrusted data. Cancel before launch;
  after launch do not kill the installer. Clean only hub-owned temp data on success, error or cancellation, report
  cleanup failure and safely recover leftovers after interruption.
- A11 — Test through injected HTTP, filesystem, signature and process interfaces, plus #6 registry and #4 IPC
  fakes. Preserve existing catalog, opening/closing, tray, local-app and locale behavior; #8 owns initial install,
  #9 local apps, and this issue neither publishes a feed nor modifies the apps' own updaters.

### OPEN DECISIONS and recommendations

- D1 — Recommend six-hour due checks on show and while running, bounded concurrency and server-directed backoff.
  Confirm interval and whether an explicit retry may bypass the local interval, but never server rate limits.
- D2 — Recommend strict SemVer and exact supported Windows NSIS artifact/platform; validate real Antena/Quorb
  manifests, updater signature encoding and per-user flags before work. Unsupported variants fail closed.
- D3 — Recommend checked GitHub asset-host redirects and a fresh v3 key at action time, with protected-PR key
  rotation. Confirm allowed redirect hosts and whether each app's asset must use its own repository; coordinate #8.
- D4 — Recommend IPC quit plus a transaction-scoped main-executable process check and manual closure for other
  apps; insufficient process visibility blocks the update. Confirm multi-instance/helper-process limitations.
- D5 — Recommend re-detection and per-hub serialization, explicitly accepting the residual race with an app's own
  updater unless a shared cross-process installer lock is separately designed and adopted by each app. Decide
  whether that residual race is acceptable before implementation; a lock would require external coordination.

## Tasks

All units are proposed and **not authorized**. Publication, explicit start/assignment, external catalog writes and delivery are separate gates.

- T1 (S1, D1–D5) Planning and coordination — route: maintainer/parent; status: authorized.
  - Outcome: settle decisions, confirm app updater artifacts/flags and coordinate the shared v3 work with #8.
    Revalidate #7, #11, #5/#6, assignees, take comments and related PRs; #11 v1.6 lists #5/#6 integrated,
    #7 planned and #28 deferred, blocking Antena/Quorb plugin integration. Do not assume plugin availability.
  - Exit: approve a concrete ODD and separately authorize/verify its issue comment and index operations; a
    local draft is not readiness. Any public feed or app-repository change needs separate authorization.
- T2 (S1, A4–A7) Shared catalog trust and download — status: done by #8 (PR #32, bf8fc14); reuse its install chain.
  - Outcome: first of #7/#8 implements v3 compatibility and validated key/URL contract; #7 reuses it to
    download, verify and bind signed Windows updater assets safely. Dependencies: T1 and explicit start.
  - Checks/exit: v1/v2 compatibility, isolated v3 cache and Rust/TS parity; invalid keys/URLs/redirects,
    tampering, missing/wrong signature and file replacement prevent execution. Cleanup failures are reported.
- T3 (S1, A1–A3, A8–A10) Update transaction and UI — route: focused writer, test-first; status: authorized.
  - Outcome: due checks, localized notes/progress, graceful closure, verified per-user install and re-detection.
    Dependencies: T2, #4/#6 and #17. Checks/exit: fake clock/network/filesystem/signature/process/registry/IPC
    cover versions, offline/rate limits, stale results, quit failures, manual closure, races, exit codes, cleanup,
    exact localized states in both languages and unchanged existing behavior; rejected input neither starts an
    installer nor changes installed data.
- T4 (S1, A11) Windows evidence and delivery preparation — route: independent verifier + maintainer/parent; status: authorized.
  - Outcome: isolated Windows tests using reviewed Antena/Quorb releases where available, both plugin and
    non-plugin paths, per-user flags, real signature failures, re-detection and interruption/cleanup.
    Dependencies: T2/T3; real installs or machine changes need separate authorization. Exit: deterministic and
    Windows evidence recorded with gaps; commit, PR, merge, publication and issue closure remain separate.

## Log

- L1 (verbatim): Parent: "¿Preparo sus ODD en paralelo, como las tandas anteriores?" User: "si". Parent interpretation: draft #7, #8 and #9 in parallel only; publication, assignment and implementation need later approval.
- L2 (verbatim): Parent: "¿Cómo descubre #7 las versiones nuevas?" Options: "B: el catálogo manda (recomendado) — Versión e instalador del catálogo v3; sin latest.json ni cambios en la política de URLs. Las actualizaciones aparecen al mergear la PR del catálogo que hace la skill de release." / "A: latest.json "latest" de GitHub". User selected: "B: el catálogo manda (recomendado)". Earlier approval of the ODD and implementation: user "si" to "¿Apruebo los tres ODD con esas recomendaciones, los publico y arranco la implementación en paralelo?". Effect: A2-A4 and T2 updated; T3-T4 authorized.
