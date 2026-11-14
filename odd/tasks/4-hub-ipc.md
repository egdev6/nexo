# Hub IPC server and unified tray (#4) — DRAFT v1
> Proposal: `nexo-i4-odd-v1`; local draft only, not approved, published, assigned or authorized to implement.
> Milestone: Bandeja unificada; roadmap: https://github.com/egdev6/nexo/issues/11. All defaults and units below are PROPOSED.

## Specs

- S1: "El hub expone el named pipe, acepta registros y heartbeats, compone en su menú de bandeja las acciones de cada app y permite elegir por app si se unifica o mantiene su icono."
- S2: "#1 y #2."
- S3: "Pendiente de detallar cuando se acerque su milestone (planificación progresiva). Antes de empezar se publica su ODD como comentario aprobado."
- S4: "Para buscar trabajo nuevo, solo cuentan las issues sin asignar. Al empezar una issue de forma explícita: se identifica a quien la toma, se lo agrega como assignee y se revisan las PR relacionadas. Los conflictos se coordinan sin quitarle la issue a nadie."
- S5: "Rama por issue, PR con squash merge y evidencia de las comprobaciones en la descripción. Abrir la PR no la integra: el merge lo hace el mantenedor."
- S6: "Estado: planificada; no está lista para contribuir hasta que se publique su ODD."

### PROPOSED derived acceptance (S1; boundaries from approved protocol v1)

- A1: On Windows, listen on `pipe_name(user_sid)` (`\\.\pipe\nexo-hub-<user-sid>`), restricted to the current user.
  Acquire the first instance with `FILE_FLAG_FIRST_PIPE_INSTANCE`; a competing pipe owner must not be disturbed.
  A second Tauri instance still shows the existing flyout when the existing single-instance handler intercepts it;
  if pipe ownership itself fails, report the failure and do not run a second IPC server.
- A2: Support multiple concurrent clients without blocking the tray/UI. Negotiate `hello` then `welcome`,
  accept valid `register` with `registered`, receive menu replacements, and acknowledge heartbeats.
  Atomically reject duplicate app IDs without changing the original registration; remove only the session that owns
  an entry. On `bye` or EOF remove its connected entry and menu; a later valid registration can reconnect.
- A3: Keep each registered app's identity, declared capabilities, menu, connection generation and liveness.
  At three missed heartbeat intervals mark it unresponsive in the menu, without killing or assuming exit;
  a subsequent heartbeat restores responsiveness. An EOF without `bye` is an unexpected disconnect, not proof of exit.
- A4: Right-click shows a separate submenu per registered app, including not-unified apps, plus the hub's `Salir`.
  Show app actions with enabled/disabled and optional checked state; a replacement removes old actions.
  Route clicks by app and current item ID; ignore stale, disabled or disconnected actions. Offer hub-owned Open and
  Quit only when `show` and `quit` are declared. Labels are plain text and UI work uses the appropriate Tauri thread.
- A5: A per-app checkbox changes whether that app keeps its own tray icon: send `unified` and update the menu.
  Default to unified; retain choices by app ID across reconnects during this hub session. Persistence across hub
  restarts is a separate decision, proposed for later settings work, not silently attributed to #16.
- A6: **Handshake limitation:** `welcome` precedes `register`, so the hub does not yet know the app ID. Propose
  `welcome.unified: true` and, immediately after `registered`, send `unified: false` for a non-unified override.
  A non-unified app's icon may briefly be absent until that message arrives. This preserves the #3 unified-start
  zero-creation guarantee without changing v1; instant per-app choice at welcome cannot be guaranteed by this wire.
- A7: Emit a read-only registry snapshot/event to the main flyout and fetch an initial snapshot without a subscription
  race; version snapshots or use an equivalent ordering guarantee, and unsubscribe on cleanup. Join by stable ID,
  avoid duplicate rows, and include live registrations absent from sample metadata. Registration establishes a live
  connected state, not installed/catalog metadata or proof of process lifetime after disconnect; unresponsive or
  disconnected means unknown, not falsely stopped. Clearly separate remaining illustrative sample data from real state.
- A8: `updates` and `local` apps do not connect under v1; do not invent IPC registration, process detection or
  running state for them. Their catalog, launch and external management belong to later roadmap work. Existing
  illustrative flyout controls stay clearly non-functional until their own approved issues implement them.
- A9: Per-app Quit and hub `Salir` use correlated `quit` with reason `user` for each capable connection, wait at most
  the protocol's 10 s for each result and present refusals/reasons or timeouts. Never force-kill. Do not treat an
  acceptance or `bye` as proof that the OS process exited; #3 can send both then recover/reconnect if UI finalization fails.
- A10: Proposed hub-exit policy: on refusal, timeout or missing `quit` capability keep the hub open, explain what
  happened and offer an explicit hub-only exit; apps already accepting may already have closed. Hub-only exit closes
  the pipe cleanly so remaining clients recover their icons. No rollback or forced process termination is implied.
- A11: Preserve left-click flyout toggle, focus behavior and the existing right-click `Salir` entry. Hub exit cancels
  listener/session work and closes handles; hub crash or pipe loss lets the existing client restore its personal tray.

### PROPOSED protocol boundaries and open decisions

- Reuse `docs/protocol.md`, `crates/nexo-protocol` types, `encode`, `decode` and `negotiate`; no new wire fields,
  message types or production endpoint override. UTF-8 newline-delimited JSON is at most 64 KiB excluding newline.
- `hello` is `v: 1`; use the highest common version and the negotiated version thereafter. Reject no overlap with
  `unsupported_protocol` plus the hub range; reject malformed registration with `invalid_message`; reject a
  duplicate with `duplicate_app`, then close. Wrong-version, malformed, oversized and out-of-order frames close the
  session as protocol errors. Ignore unknown fields and capabilities as v1 requires.
- Validate the registered stable ID `[a-z0-9-]+`, semver version and message limits; accept at most 20 app menu
  items. `menu` replaces the previous list. Send only declared capabilities; echo heartbeat sequence; the default
  interval is 5 s within the allowed 1,000–60,000 ms. No received text is executed.
- #3 client policy: `unsupported_protocol` and `duplicate_app` are permanent until client restart;
  `invalid_message` retries with backoff. Client quit decision times out at 9 s with a refusal; accepted result plus
  `bye` can precede a failed finalize dispatch and recovery. Preserve these existing client behaviors, not new server rules.
- **Decision D1, layout:** recommend app submenus rather than a flat list; disambiguate identical item IDs by app.
- **Decision D2, preference:** recommend in-memory per-app choice and `welcome`/override sequence in A6; persistence
  and any transient icon absence for not-unified starts need explicit acceptance before implementation.
- **Decision D3, hub exit:** recommend A10 over exiting silently or forcing apps closed; confirm the hub-only option.
- **Decision D4, non-plugin apps:** recommend A8 and unknown status rather than inventing external running detection.

## Tasks

All units are proposed, not authorized. Behavior changes require test-first evidence where applicable, with tests and
relevant docs in the same implementation unit; a passive plan does not establish functional behavior.

- T1 (S2–S6) Planning gate — route: maintainer/parent; status: proposed-not-authorized.
  - Outcome: decide D1–D4, approve a concrete version and, separately, exact publication operations.
  - Validation/exit: re-read #4, #1/#2, #11, comments, assignees and related PRs; verify any authorized issue comment,
    index link and status operation individually. Explicit later start/take remains separate; a local draft is not readiness.
- T2 (S1, A1–A3) Secure server and registry — route: focused writer, test-first; status: proposed-not-authorized.
  - Outcome: isolated concurrent IPC sessions, handshake, registration, liveness and cleanup with tests/docs.
  - Validation/exit: scripted clients prove v1 ordering, ownership, rejects, frame limits, duplicates, heartbeat and
    stale-session isolation; Windows named-pipe checks pass without touching a real hub endpoint.
- T3 (S1, A4–A8, A11) Tray, preference and flyout state — route: focused writer, test-first; status: proposed-not-authorized.
  - Outcome: app submenus, action routing and per-app unify, plus minimal ordered snapshot/event bridge to Mis apps.
  - Validation/exit: menu and UI tests prove replacement, capabilities, check states, identity routing, event races,
    real/illustrative separation, and preservation of the flyout left-click and `Salir` interactions.
- T4 (S1, A9–A11) Clean quit and lifecycle — route: focused writer, test-first; status: proposed-not-authorized.
  - Outcome: correlated per-app and hub-wide graceful quit with refusal, timeout, recovery and shutdown handling.
  - Validation/exit: controlled-time tests prove acceptance, refusal, timeout, incapable app, explicit hub-only exit,
    reconnection after `bye`, no process kill and cancellation/resource cleanup.
- T5 (S1–S6) Windows evidence and delivery preparation — route: independent verifier + maintainer/parent; status: proposed-not-authorized.
  - Outcome: native Windows pipe and real tray/window checks, recorded evidence and a separately authorized delivery proposal.
  - Validation/exit: all approved checks pass, risks and missing evidence are reported; no PR, merge or closure is implied.

### PROPOSED future verification, not run

- Unit and behavior tests use in-crate scripted clients mirroring the plugin's scripted-hub harness, controlled time,
  isolated `nexo-test-` pipe names and public observable messages/state. Cover concurrent app IDs, duplicate races,
  wrong order/version, invalid UTF-8, fragmented and 64 KiB/oversized frames, menu 20/21 limits and replacement,
  heartbeats and stale actions, reconnect and generation fencing, denied capabilities, and quit result correlation.
- Exercise initial snapshot plus event ordering and cleanup, live registry entries, unknown external-app state,
  current sample placeholders and the unchanged left-click/focus behavior in frontend and native tests.
- Windows: test first-instance ownership and same-user-only access, including a second account if available; never
  disturb a real server. If feasible, use the real plugin client in an isolated Windows user/session or VM with
  exclusive production-pipe ownership; its production connector has no endpoint override. Record any gap honestly.
- Real Windows: use Antena if available or a real plugin-enabled host, plus a second/simulated app as needed. Check
  standalone and unified startup, right-click layout/actions, non-unified preference, Mis apps state, show, refusal,
  accepted quit, hub-only exit, crash/loss recovery and reconnect without duplicate icons. Record environment/evidence.
- Candidate focused checks: `cargo test -p nexo-hub --locked` and, from `apps/hub`, `npm test`; native Windows runs
  the focused Rust checks too. Candidate closure checks: `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo test --workspace --locked`,
  `cargo build --workspace --locked`, and, from `apps/hub`, `npm run build`. Exact runners need later authorization.

## Log

- L1: User request: "sigue. puedes paralelizar agentes". This is a draft only; publication, assignment and implementation require later explicit approval.
