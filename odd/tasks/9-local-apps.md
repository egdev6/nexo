# User-added local apps (#9) - DRAFT v1
> Proposal: `nexo-i9-odd-v1`. Draft only: publication, assignment, implementation and delivery require separate approval.
> Roadmap: https://github.com/egdev6/nexo/issues/11. Milestone: Catálogo y gestión.

## Specs

S1 - Original issue body, https://github.com/egdev6/nexo/issues/9, verbatim:

> <!-- odd-roadmap: proposal=nexo-roadmap-v1 operation=i9 -->
>
> ## Objetivo y motivo
> Permitir que el usuario añada apps propias (nombre, ejecutable, icono) o un catálogo local, al nivel de integración «lanzar». Estas apps solo existen en su máquina: así también se gestionan las apps privadas.
>
> ## Dependencias
> #5 (mismo formato) y #6.
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

- A1 - From Mis apps, add, edit and remove a user-owned entry with a nonempty name, an executable selected in a
  native file dialog, and an optional locally selected icon. Cancellation changes nothing. Save only after validation;
  show actionable errors and retain the prior record on failure. Confirm removal; never remove the actual files or
  terminate a process. Local entries survive hub restart and can be edited or removed even when their files disappear.
- A2 - Extend the Rust-owned #16 config store from version 2 to a proposed version 3 with stable local-entry IDs,
  selected paths and source bindings. Reuse its lock, patch/write queue and atomic-save/recovery boundaries; avoid
  lost updates with other settings. Migrate v0/v1/v2 without losing valid settings, ordered descriptors, unknown
  source metadata or v2 `newsVisit`. Preserve the existing rule that pre-v2 `newsVisit` is not trusted. Missing,
  corrupt, unreadable and future versions retain their existing distinct behavior; failed saves preserve the original.
- A3 - Enable adding an optional local catalog file in Settings / Fuentes del catálogo via a native picker. Persist
  its unique local source descriptor and selected location in the same store; permit removing or replacing the
  source without deleting the file, executables, unrelated apps or official source. Validate before committing;
  cancellation, invalid data or failed persistence leaves previous sources and bindings unchanged.
- A4 - Parse the complete local file using #5's existing v1/v2 catalog format and domain rules. Reject the whole file
  on malformed, unsupported, invalid or duplicate-ID data, or if any entry is not `integrationLevel: "launch"`.
  A local source remains local regardless of its contents: do not use the official loader/cache or official projection.
  Ignore `news`, `featured` and `releasedAt` for News and its counters; no local source supplies a news feed.
- A5 - The existing format has no absolute executable field and requires HTTPS installer/updater and artwork URLs.
  Do not reinterpret `detection`, installer, updater or any URL as a local executable, and do not fetch local-entry
  URLs. After importing, show each entry as unconfigured until the user selects its own `.exe` through a native
  dialog; persist that association by source ID and catalog app ID. Missing required metadata still fails #5
  validation, even though network fields are unused. No automatic registry match or format change is proposed.
- A6 - Reread and validate local sources at startup and explicit refresh, fencing overlapping results. A missing,
  unreadable, changed-to-invalid or mixed-level file displays a source error and disables its entries' launch,
  without erasing persisted associations or affecting manual apps and the official catalog. A valid refresh restores
  matching bindings; disappeared IDs are not launchable. Removal clears only that source's associations.
- A7 - Show manual and catalog-derived local entries in Mis apps with a localized `Local` badge and the source
  identified; do not label them sample, official or installed merely from metadata. Distinguish unconfigured,
  missing/inaccessible executable and unknown running state; disable Open with a reason, offer repair/reselection,
  and refresh state. A successful spawn means requested, not proof the app opened or is running.
- A8 - Keep identity source-scoped: stable manual IDs and `(source ID, catalog app ID)` keys cannot impersonate an
  official or connected IPC ID. Identical names, IDs or executables across sources remain separately labelled;
  warn on a known duplicate, never silently merge or replace either entry. Refresh must not create duplicate rows.
  Preserve the existing official/connected merge and tray behavior; local entries do not inherit IPC capabilities.
- A9 - For local Open, the native command accepts an opaque stored entry key, not a webview-supplied path. Only an
  explicitly user-selected absolute local Windows `.exe` may be associated; reject UNC/device/relative paths,
  non-files and unsafe reparse paths. Revalidate the source/binding and executable immediately before spawning.
  Adapt #6's secure launch path to share its checked direct-spawn mechanism while retaining its official
  installation confinement; local authorization is the selected exact file, not an installation-directory hint.
- A10 - Launch directly and detached, with no arguments, shell, PATH search or elevation; surface failures. Same-user
  replacement between validation and spawn remains a risk, not executable authentication. Local launch-only rows
  have no Close action; instruct users to close the app itself. Never kill processes. Connected plugins remain in
  their separately identified IPC rows and retain the existing capability-gated controls, without ID-based promotion.
- A11 - A selected icon is optional and local: use bounded safe decoding with a fallback if absent or invalid, never
  unrestricted frontend filesystem access or a remote URL. Keep paths and data local; Nexo must not transmit local
  app names, paths, icons, catalogs or contents, and must not request their URL fields or include them in telemetry.
  This does not control a launched app's own networking or user/OS backup and sync configuration.
- A12 - Localize all added controls, state and error messages in Spanish and English; provide accessible labels and
  keyboard operation. Put native dialog, filesystem/source reads and launcher behind injectable interfaces; exercise
  observable store, UI and launch behavior, including failures and preservation of existing official behavior.

### OPEN DECISIONS and recommendations

- D1 - Arguments: recommend none for v1, including catalog metadata; allowing them later requires an explicit
  per-app authorization and security design, not shell parsing.
- D2 - Icons: recommend an optional user-selected local raster image with bounded decoding and fallback; do not
  extract icons from executables initially. Extraction adds platform parsing and needs a separate safety review.
- D3 - Local catalog usability: recommend unchanged #5 v1/v2 shape plus explicit per-entry executable binding.
  Its required HTTPS fields remain cumbersome but inert; a leaner local schema would require a separately reviewed
  format/version change. Confirm this trade-off before approval.
- D4 - Duplicate policy: recommend distinct labelled source-scoped rows with a warning, not automatic matching,
  overwrite or rejection solely by name/path. Confirm whether the user wants a stricter manual deduplication rule.
- D5 - Paths: recommend local disk only and refusing reparse points, consistent with #6's conservative checks.
  Network shares or link support would need explicit trust, availability and race rules before approval.

## Tasks

All units are proposed and **not authorized**. Approval to publish the ODD, explicit start/assignment and delivery are separate gates.

- T1 (S1, A1-A12) Decisions and planning gate - route: maintainer/parent; status: proposed, not authorized.
  - Outcome: decide D1-D5, particularly catalog binding and duplicate policy; approve the full plan and separately
    authorize its #9 comment and #11 link/status operations. Dependencies: #5 and #6; #16 supplies the store.
  - Exit: recheck roadmap, integration, issue, assignees, take comments and related PRs; verify each authorized
    planning operation. The draft alone neither reserves #9 nor makes it ready.
- T2 (S1, A1-A3) Store and selection - route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: versioned local records, source descriptors, migration and native selection interfaces with safe errors.
  - Checks/exit: fake dialogs and isolated storage test add/edit/remove, cancel, invalid input, concurrent settings,
    v0/v1/v2 migration including `newsVisit`, source metadata, reload, save/recovery failures and future versions.
- T3 (S1, A3-A6, A8) Local catalog ingestion - route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: validated launch-only v1/v2 local source, source-scoped bindings, refresh/error states and no News or
    network projection. Dependencies: T2 and #5's existing parsers; no new interchange schema.
  - Checks/exit: fake filesystem covers valid/empty, malformed, unsupported, duplicate/mixed-level, missing/changed
    and racing files, reappearing IDs, cancellation, source removal, unchanged saved data on rejection, no requests,
    News isolation, ID collisions and preservation of official cache/projection.
- T4 (S1, A7-A12) Safe launch and Mis apps - route: focused writer, test-first; status: proposed, not authorized.
  - Outcome: source-labelled localized rows, icon fallback, repair flows and ID-only checked local launch reusing #6.
  - Checks/exit: dialog/filesystem/launcher fakes cover selected vs injected paths, missing files, reparse/UNC,
    changes before spawn, duplicate warnings, no args/shell/kill, launch errors, no non-plugin Close and preserved
    official launch confinement, connected plugin controls, refresh and tray behavior.
- T5 (S1, A12) Windows evidence and delivery preparation - route: independent verifier + maintainer/parent; status: proposed, not authorized.
  - Outcome: record Windows environment and smoke-check native picker, persisted edits, safe opening, missing-file
    repair, catalog refresh and privacy boundaries in an isolated authorized environment.
  - Exit: deterministic checks and native evidence pass or gaps are reported; PR, merge and closure remain separate.

## Log

- L1 (verbatim): Parent: "¿Preparo sus ODD en paralelo, como las tandas anteriores?" User: "si". Draft only; publication, assignment and implementation require later approval.
