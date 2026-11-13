# Conditional app tray plugin (#3) — APPROVED v1
> Proposal: `nexo-i3-odd-v1`. Approved and published: https://github.com/egdev6/nexo/issues/3#issuecomment-6858784423. Implementation/start authorized (L10); assigned to egdev6 and status:in-progress verified (L11). Roadmap: https://github.com/egdev6/nexo/issues/11
> Milestone: Bandeja unificada. Branch: feat/3-plugin-tray (base b4dd85b); delivery_strategy: single-pr; chain_strategy: not-applicable; revised forecast: approximately 2,500–3,200 authored lines (generated locks excluded), with about 1,935 in T2 source/tests/docs. Runner: Linux and native Windows Rust, plus real manual checks. #2 S8 remains deferred.

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
  For `invalid_message`, stay standalone, log the error and retry with the approved 1 s, 2 s, 4 s ... backoff capped at 10 s.
  Unknown rejection codes also stay standalone and use that backoff. These retry rules are the explicitly approved #3 client policy (L20), not new wire fields or a general protocol guarantee; only the original two rejection codes are permanent.

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
- T2 (S1, S2) Conditional tray and connection lifecycle — route: parent + bounded writer; Risk: items 4/5; commit: TBD; status: verified after one correction batch (L25-L27); final Windows rerun and commit pending.
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

### APPROVED verification plan — execution evidence in Log

- **Deterministic public-behavior/state tests (S1–S3):** observable tray creation/visibility counts, host effects
  and outgoing messages with controlled transport/time. Cover unified startup with zero icon creation, absent hub,
  non-unified startup, menu registration/replacement, `unified` transitions and repeated loss/return without duplicates;
  preserve normal standalone and minimize-to-tray behavior. Cover EOF, three missed acknowledgements, reject cases,
  version/frame errors, backoff (including invalid_message/unknown-reject retries and the two permanent rejects), known/unknown actions, show, accepted/refused quit and cleanup.
- **Windows named-pipe/mock-hub tests (S1–S3):** use a small in-repo scripted server, not #4, with isolated test
  endpoints and the actual v1 framing/messages. Exercise handshake/registration/menu, heartbeat, malformed/oversized/
  wrong-version frames, permanent rejects, disconnect and reconnection, action/show/quit responses and resource cleanup.
  Test isolation must not change production discovery or the wire contract.
- **Real Windows tray/show/quit checks (S1–S3):** use an appropriate in-repo test host and simulated hub; inspect
  standalone and unified startup, non-unified mode, loss/return cycles, icon count, menu actions, window focus and
  accepted/refused quit. Record the environment and evidence; visual inspection supplements rather than proves zero icon creation.
- Focused command: `cargo test -p tauri-plugin-nexo --locked`; T2 worker reports 28 Linux unit tests and 32 native Windows unit tests passed (0 doc tests). Native Windows uses the process-only runner contract in L19; parent/independent verification is pending.
- `cargo fmt --all -- --check` passed in T2 self-verification. Full-workspace closure commands are still NOT RUN since T2 changes: `cargo clippy --workspace --all-targets --locked -- -D warnings`; `cargo test --workspace --locked`; `cargo build --workspace --locked`.
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
- L16: Planning checkpoint commit a4ef50e42ef780fd27eeeec107cc864ca3e224d5 (`docs(odd): record approved plugin implementation plan`), 251 authored additions in two #3 planning files only. Structural/whitespace checks passed; no meaningful functional RED applies to passive planning. Unrelated #2 notes remain modified and unstaged. RDD is off, so no native assessment/review was started. Next bounded unit: T2 lifecycle/runtime and its tests/docs; T3 show/quit remains subsequent. Implementation Risk: item 4 (concurrency/cancellation/tray ownership) and item 5 (direct dependency/features changes); independent verification follows source implementation.
- L17: Worker mwf8ur21-7-lmsh returned interaction_required before source edits or RED tests: approved text leaves retry timing for invalid_message and unknown future reject codes unspecified, while only unsupported_protocol/duplicate_app are explicitly permanent. Await the closed A-E policy choice. The worker made no file changes. Baseline-only Linux cargo test exited 0 (0 unit/0 doc tests), fmt and package clippy exited 0; these do not verify S1/S2. Native Windows test and clippy both exited 101 before tests because incremental compilation could not create its session lock: "Función incorrecta. (os error -2147024895)" on the WSL path. No Windows-specific tests ran; no independent verifier was launched.
- L18: Parent corrected the runner separately (job-16): unchanged-baseline Windows cargo test via PowerShell, CARGO_INCREMENTAL=0 in that process only, with the same manifest, locked dependencies and target/windows directory. This changes compilation caching, not functional checks, source or persistent toolchain settings. The source worker remains finished/blocked, not active, until the policy answer.
- L19: Runner correction verified: job-16 exited 0 after 1m04s, compiling the unchanged Windows skeleton and passing 0 unit/0 doc tests. The UNC-path incremental session-lock failure disappeared with process-only CARGO_INCREMENTAL=0. Use that tested PowerShell environment form for resumed native Windows test/clippy commands; do not change the global toolchain or test requirements. Windows clippy with the corrected environment is still unrun, as are all new S1/S2 tests/RED/GREEN. This is baseline tooling recovery, not functional plugin proof.
- L20 (user): "a" — valid case-insensitive answer mapped once to closed choice A: retry both invalid_message and unknown rejection codes with the approved 1, 2, 4 ... capped-10-second backoff, retaining standalone fallback and invalid_message logging. Only unsupported_protocol and duplicate_app remain permanent until restart; no wire-format change. The blocked worker mwf8ur21-7-lmsh was confirmed completed/inactive before continuation; resume that same actor once with A and the corrected process-only Windows command contract, preserving ordinary correction limits and earlier baseline failures.
- L21: Continued worker mwfa8e62-8-5bsh implemented T2 and returned partial: final Linux tests passed 28/28 and native Windows 32/32 (4 scripted-pipe tests), 0 doc tests; Linux fmt/package clippy, corrected native Windows package clippy and diff checks exited 0. One initial collapsible_if lint was corrected. An offline setup check exited 101 because tokio-macros was uncached; the authorized Cargo test then downloaded it. Changes are confined to plugin lib/client/windows/tests, package manifests/lock and usage docs; one new locked package tokio-macros. Approximately 1,935 authored T2 lines exclude the 15-line generated lock delta; tests.rs is 1,043 lines. The original 1,300–2,100 forecast was low; revise approximately 2,500–3,200 for the full feature without reopening the selected single-pr strategy.
- L22: TDD evidence limitation: the worker observed RED groups for startup/registration, recovery/lifecycle, rejection retries, stale UI/actions, heartbeat and native pipe connection, but did not capture isolated pre-implementation RED for every requested boundary (including welcome interval/version edges, reentrant factory and partial-write cancellation). Subsequent tests are GREEN, not retroactive RED. Do not fabricate history, reset budgets, discard working code to manufacture evidence, or mark T2 fully complete from that report. Planned high-risk independent verification and one parent functional spot check are still required; T3 and real Windows UI proof remain later work.
- L23: Parent spot check job-17 (original tree, process-only CARGO_INCREMENTAL=0) exited 0: native Windows 32 passed, 0 doc tests. Independent verifier mwfbqgwh-9-lrd7 (isolated snapshot matching the candidate hashes) reproduced Linux 28 and Windows 32 passing, fmt and both clippy commands at exit 0, but returned T2 UNMET with two blockers: (B1, S1/A2) client.rs:183-185,546 drops `set_visible(false)` issued while the initial handshake is pending; stalled handshake then timeout produced ["create"] and the explicit preference was never applied. (B2, S2/A4) client.rs:116-119,138-147 records desired visibility before the host operation succeeds; after a one-shot creation or visibility error, a later explicit request for the same state is silently suppressed; probe produced ["create","visible:false","show-error"] without the requested visible:true, leaving the icon inaccessible after host recovery. Its focused probes failed with exit 101 (2 failed, then 1 failed); the last-handle-drop probe passed. A1/A3/A5/A7 met under functioning callbacks; protocol boundaries met in exercised paths; SID/RAII inspected structurally only; no protocol/hub changes; only tokio-macros added to the lock. Advisory: both scratch Windows commands warned about a locked Cargo last-use database.
- L24: The verifier's probe source in its runtime scratch was already removed by the runtime before the parent could copy it (/tmp then at 70%). The correction worker rewrites equivalent regression tests from the reported reproducers. These failing probes are genuine RED for B1/B2; the earlier historical RED gap from L22 stays recorded and is not repaired by them. One correction batch fixes both blockers, then one re-verify limited to B1/B2. A second correction runs only if the same blocker still fails; otherwise remaining blockers become one Needs-your-decision result.
- L25: Correction batch 1 (writer mwfcmtnp-a-dm3n, continuation of the same writer) changed only plugin client.rs:111-228 (desired/applied/scheduled visibility state; initial preference survives handshake fallback; visibility reasserted on established-session loss), tests.rs:276-416 and crate README:52-79. Real RED for B1/B2: `cargo test -p tauri-plugin-nexo --locked correction_` exit 101, 4 failed/1 passed (B1 ["create"] vs []; B2 factory ["create-error"] vs ["create-error","create"]; show lacked final visible:true; dispatch lacked final create). Then GREEN 7/7 focused; final Linux 35, native Windows 39 unit tests (0 doc), fmt, Linux and Windows package clippy, diff check all exit 0. No manifest/lock change; no automatic retry loop. Parent spot check job-18: Linux cargo test exit 0, 35 passed.
- L26: Limited re-verify of B1/B2 continued as verifier task mwfcx15z-b-wc5b; it reported both authorized suites and all six focused B1/B2 probes passing before its final report, and asked the parent to remove its scratch. Parent removed /tmp/gpeAGMfz/gajb8Aka/tmp.DJqW4ys0lo (path absence confirmed; /tmp 43%). Final verifier verdict: B1 met (stalled-handshake hidden request -> [] at fallback; queued creation fenced by a later unified session -> []); B2 met for the reported failures (["create-error","create"], ["dispatch-error","create"], ["create","visible:false","show-error","visible:true"]), no immediate retry loop, stale show retry fenced on unified return, last-handle drop left one attempt and no host events. Its checks: Linux 35 and Windows 39 (exit 0), focused verifier_recheck_ 6 passed; repository hashes/status unchanged during verification.
- L27: Parent appended the verifier's two fencing probes as regression tests (verifier_recheck_initial_hidden_and_stale_zero_icon, verifier_recheck_stale_show_retry_fenced_by_unified_return) as top-level tests in tests.rs; a first misplaced insertion inside the last cfg(windows) test body was detected (0 tests matched) and moved. Linux: focused 2 passed, full 37 passed; fmt, package clippy and diff check exit 0. Native Windows test+clippy rerun pending (job-19). Then commit T2 (Risk items 4/5, independently verified; historical RED gap from L22 stays recorded).
