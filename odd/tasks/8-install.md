# Install apps from the catalog (#8) — DRAFT v1
> Proposal: `nexo-i8-odd-v1`. Draft only: publication, assignment, implementation and delivery require separate approval. Roadmap: https://github.com/egdev6/nexo/issues/11, v1.6; milestone: Catálogo y gestión.

## Specs

S1 — Original issue body, https://github.com/egdev6/nexo/issues/8, verbatim:

> <!-- odd-roadmap: proposal=nexo-roadmap-v1 operation=i8 -->
>
> ## Objetivo y motivo
> Descargar e instalar desde el hub las apps del catálogo que no estén instaladas, verificando la integridad del instalador.
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

### PROPOSED derived acceptance (S1; not approved)

- A1 — On Windows, an official catalog card offers Install only for a freshly established `notInstalled` state.
  Installed, unknown, ambiguous, stale or already-installing apps cannot start; explain why. Preserve #6's
  observation semantics, installed/connected/local rows, News and the clearly labeled sample preview. No auto-install.
- A2 — A localized confirmation identifies the app and action before download or process execution. Cancel or dismiss
  has no side effects. A native one-shot approval is bound to the app and selected release; the native action accepts
  an official ID, never a UI-provided URL, key, signature, executable path or arbitrary command. Recheck #6 at action
  and immediately before spawn; if installed or unknown meanwhile, refuse. Serialize each app's operations so rapid
  clicks, concurrent calls or a retry cannot start two installers.
- A3 — #7 and #8 share a proposed catalog schema v3: optional per-app `updaterPublicKey`, containing the same minisign
  public key as that app's `plugins.updater.pubkey`. Whichever lands first implements this shared change; the other
  reuses it. Coordinate schema, Rust/TypeScript types and validators, fixtures, docs, loader and native cache.
  Keep v1/v2 endpoints and caches untouched; add a separate v3 endpoint/cache beside them, as v2 was added beside v1.
  New readers prefer v3 and can fall back to v2/v1 for display/detection; missing, invalid or older keys never permit
  installation or updating. Invalid data never overwrites a valid versioned cache. Public catalog changes and rollout
  require separate approval and coordination with its maintainers.
- A4 — For v3, restrict `installerUrl`, `latestJsonUrl` and update artifact URLs consumed by #7 to HTTPS GitHub release
  assets under `https://github.com/egdev6/`. Parse and validate the exact host, owner and release-asset path, not a
  string prefix; reject credentials, deceptive hosts/paths, malformed URLs and non-HTTPS. Disable automatic
  redirects and validate every hop before requesting it: follow only a bounded number of HTTPS redirects whose host
  is exactly `release-assets.githubusercontent.com` or `objects.githubusercontent.com` (GitHub's release asset
  hosts; verified 2026-11-14 that release downloads redirect to `release-assets.githubusercontent.com`); any other
  host, credentials or scheme fails closed. Apply the policy to installer, derived `.sig` and update downloads too.
  Preserve v1/v2 validation and endpoints. The signature check (A6) remains mandatory regardless of host (see L2).
- A5 — At the native trust boundary obtain and validate the official v3 feed from the fixed official HTTPS source,
  not arbitrary renderer-supplied catalog bytes. Propose requiring a current successful fetch for each installation;
  v1/v2 or stale cache may remain visible but cannot authorize execution. Recheck the chosen ID, URL and key before
  spawn; a changed/removed entry or key aborts. Protected PRs and HTTPS are the catalog trust root, not a catalog
  signature; same-user compromise, compromised publisher keys and signed malicious installers remain risks.
- A6 — Download the installer and the detached signature at the installer URL plus `.sig` into a unique, private
  system temporary directory. Stream with both byte and elapsed/connect time limits even when Content-Length is
  missing or false; reject truncated, oversized and failed responses. Recommend 512 MiB for the installer, 16 KiB
  for the signature, 10 seconds to connect and 15 minutes total per download. Present bytes/percent where known,
  otherwise indeterminate progress; keep the UI responsive and never use remote filenames as local paths.
- A7 — Verify the actual installer bytes with a Tauri-updater-compatible minisign verifier and the selected catalog v3
  public key before execution. Missing/malformed key or signature, wrong key, tampered bytes or any verification
  error fail closed; hashes or HTTPS alone are not substitutes. Protect the temporary file against reparse/path escape
  and replacement between verification and spawn, keeping appropriate exclusive handles where Windows permits; if
  the same verified bytes cannot be ensured at spawn, refuse. No shell, PATH search or arbitrary metadata arguments.
- A8 — Launch only the verified NSIS installer, directly and unelevated, with a confirmed per-user build and a
  recommended `/S` silent flag; do not request elevation, use `runas` or retry elevated. Reject an elevated hub or an
  executable requiring elevation rather than bypassing the rule. Antena and Quorb are reported to use
  `bundle.windows.nsis.installMode: currentUser` and publish `*_x64-setup.exe` with `.sig`; confirm the actual
  release and supported flags in an authorized Windows check. A signed executable is still code running as the user.
- A9 — Show downloading, verifying and installing states. Cancellation before spawn stops work and removes temporary
  files; after spawn, do not kill the installer or pretend cancellation succeeded. Keep tracking it, prevent duplicates
  and show that cancellation is unavailable. On hub exit/crash, clean only owned, no-longer-in-use leftovers at a
  subsequent start. Report cleanup failure without reporting a false clean result.
- A10 — On process exit, report nonzero exit and spawn failures. After a zero exit, refresh #6's registry observation;
  only a fresh installed result is presented as installed. Absent/unknown or failed re-detection is an explicit
  unresolved result, not success. Do not infer version from the catalog or a successful spawn. Retry only after
  rechecking installation and ensuring no operation is still running.
- A11 — Localize confirmation, progress, cancellation, disabled reasons and actionable network, size/timeout, URL,
  signature, permission, spawn, process, detection and cleanup errors in ES/EN through #17. Keep diagnostics safe,
  text-only and distinguish rejection from success. No tokens, private data or executable content in logs.
- A12 — HTTP, filesystem/temp, minisign verification, process launching and #6 detection have injectable boundaries.
  Deterministic behavior tests cover each rule, UI/command authorization, both translations, progress, cleanup and
  races; include a real signed fixture and tampering, schema parity/compatibility, and Windows-native evidence.
  Preserve v1/v2 behavior and unrelated catalog, tray, launch and sample actions; no real installation in unit tests.

### OPEN DECISIONS and recommendations

- D1 — RESOLVED (L2): GitHub release downloads redirect to `release-assets.githubusercontent.com`; the approved
  policy for both #7/#8 allows only that host and `objects.githubusercontent.com` as redirect targets (A4).
- D2 — Recommend the fresh-v3-only trust rule, independent native feed validation and limits in A5–A6. Confirm values,
  key rotation/revocation and catalog rollback handling with #7 and catalog maintainers; offline install remains blocked.
- D3 — Recommend `/S`, current-user NSIS only, no elevation, and cancellation only before spawn. Confirm actual flags,
  UI expectations and Windows behavior; decide handling for other packages before adding them, not a silent fallback.
- D4 — Confirm the installer and `.sig` asset pairs and exact updater-key encoding for Antena/Quorb with their owners;
  catalog public keys are optional, so apps without a verified key stay visible but non-installable. Real machine changes
  and public catalog publishing require their own authorizations.

## Tasks

All units are proposed and **not authorized**. ODD publication, assignment/start, catalog publication, real installations and delivery are separate gates.

- T1 (S1, A1–A12) Planning and coordination — route: maintainer/parent; status: proposed, not authorized.
  - Outcome: resolve D1–D4 and coordinate the shared #7/v3 contract and publisher rollout; separately approve this
    #8 comment and #11 link/status. Recheck roadmap, #5/#6 integration, assignees, active work and related PRs.
  - Exit: decisions and authorized planning writes verified; a local draft neither reserves nor readies #8.
- T2 (S1, A3–A5) Shared v3 catalog and trust boundary — route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: first of #7/#8 supplies v3 keys, allowlist, separate feed/cache and Rust/TS validation; the other reuses it.
  - Checks/exit: valid/invalid keys and URLs, host/path/redirect escapes, v1/v2 parity and old readers, cache separation,
    fallback with install blocked, native source binding, key changes and approved release publishing plan.
- T3 (S1, A2, A6–A10) Download, verify and install service — route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: ID-bound approval, per-app single-flight, bounded streaming, detached verification, protected temp files,
    unelevated process, cancellation, cleanup and fresh #6 detection behind injectable boundaries.
  - Checks/exit: fake HTTP/filesystem/signature/process/registry cover limits, timeouts, redirects, tampering, races,
    duplicate calls, every rejection with no spawn, nonzero exit, re-detection and cleanup; real signed fixture passes.
- T4 (S1, A1, A9–A12) Catalog UI and localization — route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: confirmation, disabled reasons, progress, cancellation, errors and truthful installation states in ES/EN.
  - Checks/exit: behavior tests cover unknown/installed/installing, retries, locale changes and progress, preserving
    existing catalog, connected/local/sample rows, News and tray behavior. Coordinate changes shared with #7/#9.
- T5 (S1, A4, A7–A12) Windows evidence and delivery preparation — route: maintainer/verifier; status: proposed, not authorized.
  - Outcome: verify actual release redirects, signatures, installer flags, per-user behavior and re-detection on an
    isolated Windows account/VM. Real downloads/installations and machine changes require separate authorization.
  - Exit: record environment, deterministic and authorized native results and any gaps; PR, merge and closure remain separate.

## Log

- L1 (verbatim): Parent: "¿Preparo sus ODD en paralelo, como las tandas anteriores?" User: "si". Parent interpretation: draft the ODDs for #7, #8 and #9 in parallel only; no publication, assignment or implementation is authorized.
- L2 (verbatim): Parent: "Un ajuste a la recomendación del borrador de #8: proponía bloquear la instalación mientras GitHub redirigiera a otro host. Lo comprobé: las descargas de releases redirigen a `release-assets.githubusercontent.com`. Bloquear eso impediría instalar cualquier app, así que recomiendo permitir **solo** esa redirección de GitHub. La firma es la verdadera garantía: aunque el host fallara, un instalador sin firma válida no se ejecuta. ¿Apruebo los tres ODD con esas recomendaciones, los publico y arranco la implementación en paralelo?" User: "si". Effect: A4 and D1 updated; T2-T4 authorized.
