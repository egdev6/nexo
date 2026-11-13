# Conditional app tray plugin (#3) — APPROVED v1
> Proposal: `nexo-i3-odd-v1`. Approved and published: https://github.com/egdev6/nexo/issues/3#issuecomment-6858784423. Implementation/start authorized (L10); assigned to egdev6 and status:in-progress verified (L11). Roadmap: https://github.com/egdev6/nexo/issues/11
> Milestone: Bandeja unificada. Branch: feat/3-plugin-tray (base b4dd85b); delivery_strategy: single-pr; chain_strategy: not-applicable; forecast: approximately 1,300–2,100 authored lines (generated locks excluded). Runner: Rust tests plus Windows named-pipe/manual checks. #2 S8 remains deferred.

## Specs

- S1: "Plugin que integra cada app: al arrancar se conecta al hub; si este responde y la app está unificada, no crea su icono y se registra con su menú; si no hay hub, crea su icono normal."
- S2: "Si se pierde la conexión, recupera el icono (`set_visible(true)`) y lo vuelve a ocultar cuando el hub regresa."
- S3: "Atiende `show` y `quit`."

### APPROVED derived acceptance — plan, not implemented behavior

- A1 (S1): When the hub responds at startup and the app is unified, do **not create** a personal tray icon;
  hiding an already-created icon does not meet this startup case. Register the app and send its menu.
  If the hub is absent, create the app's normal icon and retry in the background.
- A2 (S1, S2): When connected but not unified, retain the normal app icon and also register with the hub.
  Apply later `unified` changes immediately; the hub's setting wins over app icon-visibility preferences
  while connected, without changing the app's usual minimize-to-tray window behavior.
- A3 (S1): Follow `hello` → `welcome` → `register` → `registered` → `menu`; advertise the supported
  `show`, `quit` and `menu` capabilities. Send updated menus as replacements, at most 20 items,
  without the hub's own Open/Quit entries; dispatch known `action` items and ignore unknown IDs.
- A4 (S2): On EOF/broken pipe, three missed heartbeat intervals or a protocol error, restore access immediately.
  If startup never created an icon, create the normal icon; otherwise reuse it with `set_visible(true)`.
  Close the connection, and retry with 1 s, 2 s, 4 s … backoff capped at 10 s, subject to the rejection exceptions below.
- A5 (S2): On reconnection follow the new `welcome.unified`; hide the existing icon when true and keep it
  visible when false. Repeated loss, return and `unified` changes must not create duplicate icons or reconnect loops;
  when false arrives before any icon exists, create the normal one.
- A6 (S3): `show` shows, unminimizes and focuses the main window. For `quit`, return the correlated
  `quit_result` within the protocol's 10 s: accepted sends `bye` and exits cleanly; refused stays open
  with a reason. The hub does not kill an unresponsive app.
- A7 (S1–S3): Normal app exit sends `bye` when possible and stops connection, heartbeat and retry work
  without leaving orphan tasks or stale tray state. Handle a rejection or failure during startup safely
  as standalone, including when no icon exists yet.

### APPROVED protocol boundaries — planned checks, not implementation evidence

Reuse `docs/protocol.md` and `crates/nexo-protocol`; these are existing approved behavior, not a new wire contract:

- Windows client discovers `pipe_name(user_sid)` (`\\.\pipe\nexo-hub-<user-sid>`); exchange UTF-8
  newline-delimited JSON, max `MAX_LINE_BYTES` = 64 KiB excluding the newline. Use `encode`/`decode` and existing types.
- `hello` uses `v: 1`; after `welcome`, use the negotiated version. A mismatch yields typed `UnsupportedVersion`,
  closes the connection and falls back; malformed or oversized frames are protocol errors too.
  Ignore unknown fields and capabilities as specified; do not add message types or fields.
- Use the `welcome.heartbeat_interval_ms` range 1,000–60,000 ms (default 5,000), increasing heartbeat sequence
  and echoed `heartbeat_ack`; three consecutive missed intervals indicate loss. Avoid real-time sleeps in deterministic tests.
- For `reject: unsupported_protocol` or `duplicate_app`, stay standalone without retry until app restart.
  For `invalid_message`, stay standalone and log the error; do not invent a retry policy where the protocol does not specify one.

### APPROVED exclusions and recommended defaults

- Windows v1 only. No external app integration, hub server #4, catalog #5, installer/release, i18n or visual design.
  No API or wire change is approved by this plan.
- **Recommended tray ownership (S1, S2):** the host owns its icon/menu and supplies a lazy tray factory/handle.
  The plugin coordinates when that single icon is created, shown or hidden, dispatching UI work appropriately.
  This preserves app-specific tray behavior and permits zero icon creation at unified startup; the Rust API shape remains to be designed.
- **Recommended startup decision (S1):** a 1 s total initial connect/handshake/registration budget, without blocking
  the UI. A missing pipe falls back immediately; expiry falls back to the normal icon and background retry.
  Cancel the expired attempt and ignore its late responses; a later valid new session may hide the icon.
  This is an approved client policy for the plan, not an existing protocol deadline or new wire field.
- **Recommended host actions (S1, S3):** host-supplied callbacks use the app's main-window and normal quit flows.
  The host may refuse quit with a reason; the plugin never substitutes an unconditional exit or changes the wire contract.
  Advertise only capabilities actually supplied and supported; no external app API is presumed.
- **Prospective implementation risks:** #4 may advance concurrently and must remain compatible with the approved protocol;
  isolate simulated pipe endpoints from a real hub and coordinate shared protocol changes separately. A single tray owner
  and cancellation of stale connection work are necessary to avoid duplicate or inaccessible icons.
- **Implementation risk:** item 4 (concurrent transport, heartbeat/reconnection cancellation and tray ownership); item 5 if dependencies change. Independent verification is required after implementation. Planning/publication-only changes were passive.

## Tasks

T1 publication is done and verified. T2–T4 implementation and applicable checks are authorized by L10; delivery operations remain separate. T2 starts with verified take, branch preparation and a bounded technical map before source edits. Keep behavior, tests and relevant docs together; use one focused writer, not artificial parallel workstreams.

- T1 (S1–S3) Plan gate — route: maintainer/parent; commit: n/a (GitHub planning); evidence: comment 6858784423, #11 scope link and status:approved; status: done.
  - Outcome: `nexo-i3-odd-v1` and its recommended defaults are approved. Authorized publication operations:
    post the full approved ODD as a comment on #3, link that comment from #11, and move #3 from `status:needs-review` to `status:approved`.
  - Dependencies: approved plan and integrated #1/#2, with #2 S8 deferred; refresh issue, dependencies and related PRs
    before any publication or start.
  - Validation/exit: approved and authorized publication verified; only a later explicit start authorizes identifying,
    assigning and verifying the contributor. A local draft alone does not make #3 ready.
- T2 (S1, S2) Conditional tray and connection lifecycle — route: parent coordination + bounded writer (context backstop), test-first; commit: TBD; status: in progress (branch ready; preparing bounded runtime/test implementation).
  - Outcome: startup, registration/menu and dynamic tray recovery with a bounded in-repo simulated hub, plus behavior tests and docs in the same unit.
  - Dependencies: T1 and a separately authorized start; #4 is **not** required to finish first.
  - Validation/exit: deterministic public-behavior checks and Windows named-pipe/mock-hub checks cover the S1/S2 cases below, including failures, reconnection and no duplicate icons.
- T3 (S1, S3) Host actions and clean shutdown — route: focused writer per routing, test-first; commit: TBD; status: pending (after T2).
  - Outcome: menu action dispatch, `show`, accepted/refused `quit` and shutdown behavior with tests and docs together.
  - Dependencies: T1 and T2's connection/host integration; advertise only capabilities actually supported.
  - Validation/exit: observable host effects and protocol responses pass deterministic and mock-hub checks, including close/refusal cleanup.
- T4 (S1–S3) Windows evidence and delivery preparation — route: independent verifier + maintainer/parent; commit: TBD; status: pending (after T2/T3).
  - Outcome: real Windows tray/window checks and recorded evidence against each spec; distinguish implementation, PR and integration.
  - Dependencies: T2 and T3; any delivery operation requires separate authorization.
  - Validation/exit: the approved planned checks below pass, including real Windows behavior; report failures and unmet specs
    rather than implying integration. Work on an issue branch; any authorized PR carries evidence and is squash-merged by the maintainer.

### APPROVED planned future verification — NOT RUN

- **Deterministic public-behavior/state tests (S1–S3):** observable tray creation/visibility counts, host effects
  and outgoing messages with controlled transport/time. Cover unified startup with zero icon creation, absent hub,
  non-unified startup, menu registration/replacement, `unified` transitions and repeated loss/return without duplicates;
  preserve normal standalone and minimize-to-tray behavior. Cover EOF, three missed acknowledgements, reject cases,
  version/frame errors, backoff, known/unknown actions, show, accepted/refused quit and cleanup.
- **Windows named-pipe/mock-hub tests (S1–S3):** use a small in-repo scripted server, not #4, with isolated test
  endpoints and the actual v1 framing/messages. Exercise handshake/registration/menu, heartbeat, malformed/oversized/
  wrong-version frames, permanent rejects, disconnect and reconnection, action/show/quit responses and resource cleanup.
  Test isolation must not change production discovery or the wire contract.
- **Real Windows tray/show/quit checks (S1–S3):** use an appropriate in-repo test host and simulated hub; inspect
  standalone and unified startup, non-unified mode, loss/return cycles, icon count, menu actions, window focus and
  accepted/refused quit. Record the environment and evidence; visual inspection supplements rather than proves zero icon creation.
- Planned focused command (NOT RUN): `cargo test -p tauri-plugin-nexo --locked`.
- Existing workspace/CI command forms (NOT RUN): `cargo fmt --all -- --check`; `cargo clippy --workspace --all-targets --locked -- -D warnings`; `cargo test --workspace --locked`; `cargo build --workspace --locked`.
- Existing frontend prerequisite, if workspace build needs it (NOT RUN, from `apps/hub`): `npm run build`. Any later CI run or delivery is separately authorized; no current test totals or functional pass are asserted.

## Log

- L1: Parent: "¿Preparo el ODD de #3?" User: "si" — authorization is for this draft only.
- L2: Source issue #3 and roadmap #11 v1.1: #3 is ordered before #4 in Bandeja unificada; #4 can advance in parallel
  and #5 is independent in a later milestone. The supplied read-only snapshot showed #3 open, unassigned,
  `status:needs-review`, with no related PR or take comment; this is not a live reservation.
- L3: #1 and #2 were integrated via PR #12/#14 (snapshot `origin/main` b4dd85b); #2 S8 required-check enforcement
  is explicitly deferred after HTTP 403. The existing local #2 task notes are unrelated and preserved.
- L4: Approval and separately authorized publication must precede implementation; assignment/start requires a later explicit
  start. An issue branch, separately authorized delivery and maintainer squash merge remain the strategy. No implementation,
  GitHub publication or assignment was performed.
- L5: Draft-only evidence: the three S# quotes were traced to the supplied original and the proposed checks to S1–S3.
  Worker and parent structural checks passed (section order, original scope quotes and whitespace); `git diff --check` passed.
  Status showed only the pre-existing #2 notes and this new #3 draft. No plugin functional checks or CI rerun; no S# functional verdict is PASS.
- L6: Parent draft recommendation: host-owned lazy tray factory/handle, host action callbacks with quit refusal, and a 1 s initial budget with immediate fallback for a missing pipe, cancellation of expired attempts and normal background retry. These defaults and the explicit T1 publication operations remain proposals pending human approval; no source, GitHub or assignment change was made.
- L7: Parent proposal: "¿Aprobás `nexo-i3-odd-v1` y autorizás publicarlo como comentario en #3, enlazarlo desde #11 y marcar #3 como aprobada? Sin iniciar todavía la implementación." User: "apruebo". The three authorized publication operations are: post the complete approved ODD as a comment on #3; link that comment from #11; and mark #3 approved by moving it from `status:needs-review` to `status:approved`. Publication was pending at approval; assignment and implementation are not authorized.
- L8: Publication completed and individually verified (job-12, exit 0). Authoritative ODD: https://github.com/egdev6/nexo/issues/3#issuecomment-6858784423, comment ID 6858784423, marker `proposal=nexo-i3-odd-v1 operation=i3-odd`. Posted body equals the local 117-line publication artifact; SHA-256 e3d9a9124fcbbc941d48c5f5803d5eae78e07b7a435adfb0b3886252a7092fc5.
- L9: #11 now links that comment from #3's row and shows `lista para contribuir`; unrelated rows/history were preserved. #3 is open with enhancement, odd and status:approved, without status:needs-review or assignees; its original body was not rewritten. No assignment, implementation, source change, commit, push or functional-test/CI run occurred. S8 remains deferred. The local publication artifact is retained unchanged for reconciliation.
- L10 (user): Parent: "¿Arranco con #3 siguiendo ese ODD?" User: "si". Start/assignment and implementation of #3 are now authorized. Revalidate actor, scope, dependencies and competing work before taking it; preserve unrelated local #2 notes. No source edits yet. Delivery strategy defaults to ask-on-risk; choose the required oversized-delivery shape before any commit if the technical forecast exceeds the review budget. S8 remains explicitly deferred.
- L11: GitHub take verified (job-13, exit 0): actor egdev6, issue #3 OPEN, assignees [egdev6], labels enhancement/odd/status:in-progress. The approved comment body/hash still matches; #11 links it, PR #12/#14 are merged, no competing PR/take comment. Verified default branch: main. Local c90f3fd and origin/main b4dd85b have identical trees, allowing a non-destructive branch switch while preserving unrelated #2 notes.
- L12: Read-only technical map mwf7nbtc-6-pdia found Tauri 2.12.5, Tokio 1.54.1 and windows-sys 0.61.2 in the lock; plugin is a no-op init with Tauri/nexo-protocol dependencies and no in-repo callers. Reuse the protocol, one supervised async session, lazy host tray with execution-time generation fencing, Windows user-SID discovery and private test-only pipe endpoints. No source/protocol/hub changes or tests were made. Forecast: T2 800–1,250, T3 300–500, T4 fixture/evidence support 200–350 authored lines, total approximately 1,300–2,100 excluding generated locks. These are advisory estimates, not quotas or hard per-task caps; do not omit tests, minify or add abstractions to meet them. The default ask-on-risk delivery choice was needed before the first commit and is resolved in L13. No push/PR/merge permission is created by that shape choice.
- L13 (user choice): "Una sola PR grande (menos recomendada)" (`single-pr`). Cache delivery_strategy=single-pr; chain strategy is not applicable, not exception-ok. No tracker, child PRs, dependency diagrams or further chaining prompts. The maintainer accepted the stated oversized-review tradeoff; retain coherent behavior/tests/docs work-unit commits without arbitrary line-count rework. Publishing/merge remain separate permissions.
- L14: Created feat/3-plugin-tray from freshly fetched origin/main b4dd85b (job-14, exit 0), verifying equal source trees first and an unchanged hash for the unrelated #2 task notes after switching. No stash/reset/clean or unrelated staging. No plugin code yet.
- L15: Runner preflight verified (job-15, exit 0): Linux Rust/Cargo 1.99.0 with x86_64-unknown-linux-gnu; native cargo.exe 1.99.0 and x86_64-pc-windows-msvc via WSL interop. Windows Cargo located the exact workspace at the wslpath-converted Cargo.toml. This proves runner/path availability only, not a successful Windows compile or functional test. Use a separate ignored target/windows directory for native Windows checks; do not mix Linux artifacts. Real tray/window checks still need actual evidence.
