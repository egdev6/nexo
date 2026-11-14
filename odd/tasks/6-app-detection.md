# Installed app detection and launch (#6) — DRAFT v1
> Proposal: `nexo-i6-odd-v1`. Draft only: publication, assignment, implementation and delivery need separate approval. Roadmap: https://github.com/egdev6/nexo/issues/11. Milestone: Catálogo y gestión.

## Specs

S1 — Original issue body, https://github.com/egdev6/nexo/issues/6, verbatim:

> <!-- odd-roadmap: proposal=nexo-roadmap-v1 operation=i6 -->
>
> ## Objetivo y motivo
> Detectar las apps del catálogo instaladas a partir del registro de desinstalación de NSIS (`HKCU\\...\\Uninstall`), mostrar su versión, abrirlas y cerrarlas (con `quit` por IPC si tienen el plugin).
>
> ## Dependencias
> #5; #4 para el cierre limpio.
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

- A1 — Detect only apps in the validated official allowlist, not arbitrary installed software. Read the current user's
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` read-only, including applicable 32/64-bit registry views;
  deduplicate the same physical entry across views. This proposal excludes HKLM; machine-wide detection is a decision below.
- A2 — Propose a per-app catalog field `detection.windows` with required `displayName`, `publisher` and
  `executableRelativePath`. Match `DisplayName` and `Publisher` exactly after trimming and Windows ordinal
  case-insensitive comparison; never fuzzy-match or use catalog display name alone. Hints and actual NSIS installer
  metadata must be checked together; missing or different installer fields need a coordinated catalog/installer decision.
- A3 — A unique matching entry means installed even if its `InstallLocation` or `DisplayVersion` is missing. A missing
  hint, unreadable scan, candidate with missing/invalid identity, multiple distinct matches, or one entry matching
  multiple app IDs means unknown, not absent or a guessed winner. Only a complete, successful scan with no candidate
  establishes not installed. Expose the reason and never enable path-based launch on an ambiguous or stale match;
  live IPC actions depend on the current connection rather than an installation observation.
- A4 — Take the installed version from the matched entry's `DisplayVersion`, as plain text, with unavailable indicated
  if missing or invalid; do not substitute catalog `version` or `latest.json`. A connected app's IPC-reported version
  remains separately identified; it does not prove an installation or replace the registry observation.
- A5 — #5's current `schemaVersion: 1` Rust and TypeScript validators reject unknown fields. Adding `detection` to v1
  would break deployed v1 readers. Recommend a coordinated catalog v2 with optional hints, matching schema, types,
  Rust/TS validation, fixtures and documentation. New readers accept valid v1 and v2; v1 or v2 without a hint means
  unknown for that app. IPC v1 is unchanged: app IDs join the two sources, and no detection data travels on the wire.
- A6 — Plan a versioned v2 endpoint and separate per-version caches; keep the v1 endpoint/cache for old clients.
  New clients prefer valid v2 and may fall back to valid v1 with unknown detection; invalid responses never replace a
  valid cache and stale data is labelled. Old clients reject v2, so never replace their v1 feed/cache in place.
  The official endpoint is currently unconfigured; choosing and publishing feeds is a separate maintainer authorization.
- A7 — Resolve a relative `.exe` below the matched entry's absolute local `InstallLocation`; canonicalize and check
  containment, regular-file existence and reparse/escape cases immediately before launch. Missing, ambiguous, unsafe
  or inaccessible paths disable Open with an explanation, not a guessed executable. Treat registry values as untrusted.
- A8 — A native command accepts only an official app ID, obtains the validated catalog and fresh matching observation
  itself, and revalidates the path at the action boundary. Launch the explicit executable directly, detached from hub
  lifetime, without shell, command search, arguments from metadata, `UninstallString`, elevation or arbitrary UI paths.
  Surface launch errors; a successful spawn is not proof that an app opened or is now running.
- A9 — For a responsive connected plugin with `show`, use #4's current-generation IPC `show` instead of spawning.
  A failed dispatch is an error, not proof of showing; do not blindly spawn a second process on that failure.
  If a connected plugin is unresponsive or lacks `show`, disable Open and explain why, rather than spawning. When no
  plugin is connected and the installation/path are unambiguous, request direct launch. The app's own single-instance
  handler must perform handoff/focus; do not promise no duplicates or focus for apps without it.
- A10 — Keep installation, connection and running evidence independent. A responsive IPC registration establishes
  connected state; missed heartbeats or disconnect leave running unknown, not stopped. For non-plugin apps recommend
  unknown running state, not OS process-name/path detection; even after launch there is no inferred running/stopped state.
  `HubApp.statusKnown` currently conflates installation and running and needs independent representation.
- A11 — For a responsive connected app declaring `quit`, route Close through #4's generation-fenced correlated IPC
  `quit` with reason `user`, honoring its 10-second result, refusal, timeout and disconnection behavior. Accepted or
  `bye` is not proof of OS exit. Missing capability/connection, including non-plugin apps, disables Close with a clear
  reason and instructions to close in the app; never kill, terminate or fall back to OS process termination.
- A12 — Refresh on startup once a catalog is available, explicit user refresh, flyout focus and after launch/quit;
  do not block the UI. Fence overlapping catalog/scan results so older results cannot overwrite newer ones. On partial
  failure show unknown or explicitly stale data, not false absence, and keep unsafe actions disabled until revalidated.
- A13 — Join official observations and connected apps by stable app ID without duplicate rows; retain connected-only
  entries and existing tray behavior. Reflect installed/version, connected and unknown states without fake counts or
  enabled placeholder actions. Preserve local/sample separation. #9 owns adding local executables and local catalogs;
  this issue does not import, discover, execute or change their storage, nor implement install/update (#7/#8).
- A14 — Registry enumeration and launching sit behind injectable interfaces with fakes. Test public behavior, schema
  parity, refresh races, UI states and real Windows behavior. Text is rendered as text. Matching path and publisher is
  not publisher authentication: HKCU and same-user files can be spoofed, and HTTPS is not an executable signature.

### OPEN DECISIONS and recommendations

- D1 — Registry scope: recommend HKCU and both applicable views only for v1. HKLM read-only would cover machine-wide
  installs but increases ambiguity and testing; require explicit approval and define cross-hive conflict policy first.
- D2 — Identity and path: recommend exact name plus publisher and relative executable hint. Confirm actual NSIS values,
  missing Publisher/InstallLocation and app-specific paths with owners; otherwise keep the affected app unknown or
  unlaunchable. Alternative identity keys or any fallback need a reviewed migration and collision policy.
- D3 — Catalog compatibility: recommend schema v2 with separate versioned feeds/caches, v1 fallback and no IPC change.
  Coordinate #5 schema, validators, loader, official publisher and rollout; approve the host/URLs separately.
- D4 — Running detection: recommend unknown for non-plugin apps over executable-path process enumeration, which has
  permission, multiple-instance and race ambiguities. Do not offer a forced-close alternative.
- D5 — Single-instance handoff: recommend using the app's own handler and documenting the limitation; an app without
  such a handler may start another instance, and `show` has no acknowledgement. Confirm expected UX before implementation.

## Tasks

All units are proposed and **not authorized**. Approval to publish the ODD, explicit start/assignment, catalog publication and delivery are separate gates.

- T1 (S1) Planning and compatibility gate — route: maintainer/parent; status: proposed, not authorized.
  - Outcome: decide D1–D5, confirm real NSIS metadata and catalog rollout; approve the ODD and separately authorize its
    #6 comment and #11 link/status changes. Dependencies: #5 and #4; both reported merged, revalidate their integration,
    issue, roadmap, assignees, related PRs and publisher coordination. A local draft does not make #6 ready.
  - Exit: verify each authorized planning operation separately; explicit start/take remains a later gate.
- T2 (S1, A1–A6) Catalog contract and registry observations — route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: coordinated versioned hint/schema/validators/cache and read-only registry adapter behind a trait; explicit
    installed/absent/unknown states and version provenance, without changing IPC or local-app storage.
  - Checks/exit: fake registry and Rust/TS parity cover both views, missing/invalid fields, duplicates, collisions,
    errors, valid v1/v2, unsupported versions, cache preservation, old-reader behavior and isolated versioned feeds.
- T3 (S1, A7–A11) Native launch and IPC controls — route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: ID-only, revalidated path launch behind a trait, detached lifecycle, IPC show/quit and explicit failures.
  - Checks/exit: fakes cover path traversal, absolute/UNC/reparse escapes, missing files, arguments, stale observations,
    spawn failures, single-instance handoff contract, missing `show`/unresponsive and dispatch failure, quit
    refusal/timeout/disconnect and no kill.
- T4 (S1, A10–A13) Hub projection and refresh — route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: independently represented states, safe actions and ordered refresh on official rows, preserving IPC-only,
    local and catalog UI boundaries. Dependencies: T2–T3 and #4's existing snapshot/generation rules.
  - Checks/exit: UI/public-interface tests cover no-match versus unknown, installed version, duplicates, non-plugin Close,
    refresh/error/race handling, clear messaging, correct counts, prior tray behavior and no fake action success.
- T5 (S1, A14) Windows evidence and delivery preparation — route: independent verifier + maintainer/parent; status: proposed, not authorized.
  - Outcome: record environment and native results on an isolated Windows account/VM; real NSIS installation and any
    machine changes require separate authorization. Verify registry views, installed/absent/ambiguous records, version,
    detached launch, single-instance handoff, plugin show/quit/refusal/timeout and non-plugin no-kill UI.
  - Exit: deterministic checks plus actual Windows evidence pass; report gaps. PR, merge and issue closure are separate.

## Log

- L1 (verbatim): Parent: "¿Seguimos con esas tres en paralelo, o preferís probar primero en Windows?" User: "si". Parent interpretation: prepare the three ODDs in parallel; draft only, not authorization for publication, assignment or implementation.
