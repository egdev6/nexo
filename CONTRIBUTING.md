# Contributing / Contribuir

**English** · [Español](#español)

---

## English

Thanks for helping improve Nexo. Issues and focused pull requests are welcome.

### Before you start

Search existing issues and pull requests first. Open an issue using the appropriate template, describe the problem or proposal, and wait for maintainer review before implementation. The `status:needs-review`, `status:approved` and `status:in-progress` labels indicate the issue's state. Coordinate ownership and scope before starting; do not assume an open issue is available.

Fork the repository and open pull requests from your fork. The hub runs on Windows with WebView2. Install Rust stable and Node.js 22.12+ within 22.x, or 24+; Vitest does not support Node.js 23. The design-system agent tools require Node.js 24.x. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the Windows build tools.

From the repository root, install the frontend dependencies and build it before Rust checks, since the hub embeds the frontend:

```sh
cd apps/hub
npm ci
npm test
npm run build
npm run app:dev
```

See the [README](./README.md#scripts) for the individual frontend and Rust commands.

### Lint and formatting (Biome + Lefthook)

TypeScript and JavaScript in `apps/hub` (`src/`, `scripts/`, `vite.config.ts` and `vitest.canvas.config.ts`) are linted and formatted by [Biome](https://biomejs.dev) (`apps/hub/biome.json`). CSS is linted but not formatted, because tests assert literal CSS text. CI runs `npx biome ci` in `ci.yml`: any lint error or unformatted file fails the check; warnings do not.

After `npm ci`, run `npm run hooks:install` from `apps/hub` once per clone to install the [Lefthook](https://lefthook.dev) `pre-push` hook (`lefthook.yml` at the repository root). It is not automatic because npm lifecycle scripts stay off. The hook runs `npx biome ci` and `cargo fmt --all -- --check` before every push. If it fails, run `npm run check:fix` (and `cargo fmt --all` for Rust), commit, and push again. Skipping it with `--no-verify` only moves the failure to CI.

The repository-wide Biome formatting landed as a formatting-only commit listed in `.git-blame-ignore-revs`; run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once so `git blame` skips it. If you had a branch open before that commit, rebase it on `main` and run `npm run check:fix` to resolve formatting conflicts.

### Branches and pull requests

1. Create a branch for the agreed issue and keep the change focused.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, for example `docs: clarify setup`.
3. Before **every** pull request, run this command from the repository root:

   ```sh
   scripts/check.sh --windows
   ```

   Run it from WSL with the Linux Rust/Node toolchains and dependencies available, plus Windows Rust and PowerShell accessible through WSL. It runs Linux and native Windows Rust checks, frontend checks and a diff check, and records logs under `target/check-logs/`. Do not treat Linux-only results as native Windows verification.
4. Open a pull request linked to the issue. Complete the PR template, including exact commands and observed results, risks and follow-ups. If AI was used, describe its contribution and have a human verify the result.

PR titles must also follow Conventional Commits, for example `feat(hub): add search` or `fix!: change the API`. Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`; the scope and `!` are optional.

CI runs frontend checks and Rust formatting/lint on Ubuntu, plus native Rust tests, lint and build on Windows. Changes under `.github/` also run workflow security checks. `main` requires CI to pass before merging; the maintainer configures branch protection separately. Continue to run the local checks above.

### Release signing setup (maintainers)

One time, generate a Tauri updater key pair from `apps/hub` with `npx tauri signer generate -w <path>`, choosing a private path outside the repository and a non-empty password. Keep the private key out of the repository. Create the GitHub Actions environment `PROD-release` and set its secrets `TAURI_SIGNING_PRIVATE_KEY` (the private key contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (its password). Put the generated public key in `apps/hub/src-tauri/tauri.conf.json` as `plugins.updater.pubkey`. Updates reach users only after the draft release is published.

### Design system

Follow [ADR 0001](./docs/decisions/0001-adopt-egdev-design-system.md). Use `@egdev/ui` for shared UI and `@egdev/tokens` for visual values; check `@egdev/mcp` for components before writing JSX. Do not add local duplicates of design-system tokens or components. Request missing capabilities upstream; any temporary workaround needs an issue-linked code comment and guard allowlist entry with a removal condition. Do not add `.eg-*` overrides outside `apps/hub/src/theme/`. Existing exceptions are migration debt, not permission for new overrides. Verify browser-dependent behavior in the actual Tauri WebView2.

The guard runs with `npm run ds:doctor` (`egdev-ds doctor`) from `apps/hub`, in CI and in `scripts/check.sh`. It rejects raw `<button>`, `<input>`, `<a>` and `<label>` and DS-internal selectors outside `src/theme/` unless they have an entry in [`apps/hub/src/design-system-allowlist.ts`](./apps/hub/src/design-system-allowlist.ts). Do not bypass it to introduce new untracked exceptions.

**Who updates the design system.** Contributors do not upgrade the design system and do not change `apps/hub/vendor/`, `apps/hub/egdev-ds.json` or the `@egdev/*` entries of `apps/hub/package-lock.json` in their pull requests. If you need a component, variant or fix from the design system, open an issue in [egdev6/egdev-design-system](https://github.com/egdev6/egdev-design-system/issues) using the [Consumer request](https://github.com/egdev6/egdev-design-system/issues/new?template=consumer_request.yml) form, describing the need (without proposing the solution), and reference its number in your pull request or code comment. CI fails on pending `nexo#TBD-*` placeholders; replace them with the real issue number before merging. The maintainer upgrades the design system in a dedicated pull request with `egdev-ds upgrade`, never mixed with features, so pull requests do not conflict over the lockfile or the vendored tarballs.

Maintainers, with the design-system repository checked out next to this one, can preview an upgrade from the repository root:

```sh
node ../egdev-design-system/packages/cli/bin/egdev-ds.mjs upgrade apps/hub --dry-run
```

The CLI verifies the tarballs against the release, updates the manifest and lockfile and rolls everything back on failure. After an upgrade, run `npm run ds:doctor`, restart the dev server with `--force` and regenerate `design/system.md`. Follow the ADR for pinned versions, regeneration and the complete upgrade procedure.

<!-- egdev-ds:consumer-requests -->
#### Design system changes

Do not edit vendored tarballs, `egdev-ds.json` or `@egdev/*` lockfile entries.
Request design system changes with a "Consumer request" issue in `egdev6/egdev-design-system`.
Optional local mitigations use the guard allowlist tied to the DS issue; the maintainer upgrades the DS in a separate PR.
See https://github.com/egdev6/egdev-design-system/blob/main/docs/distribution/consumer-requests.md.
<!-- /egdev-ds:consumer-requests -->

---

## Español

Gracias por ayudar a mejorar Nexo. Se agradecen las issues y las pull requests centradas en un cambio concreto.

### Antes de empezar

Buscad primero en las issues y pull requests existentes. Abrid una issue con la plantilla adecuada, describid el problema o la propuesta y esperad la revisión del mantenedor antes de implementar. Las etiquetas `status:needs-review`, `status:approved` y `status:in-progress` indican el estado de la issue. Coordinad la responsabilidad y el alcance antes de empezar; no deis por libre una issue abierta.

Haced un fork del repositorio y abrid las pull requests desde vuestro fork. El hub funciona en Windows con WebView2. Instalad Rust estable y Node.js 22.12+ dentro de 22.x, o 24+; Vitest no es compatible con Node.js 23. Las herramientas del design system para agentes requieren Node.js 24.x. Consultad los [requisitos de Tauri](https://v2.tauri.app/start/prerequisites/) para las herramientas de compilación de Windows.

Desde la raíz del repositorio, instalad las dependencias del frontend y compiladlo antes de las comprobaciones de Rust, ya que el hub lo incorpora:

```sh
cd apps/hub
npm ci
npm test
npm run build
npm run app:dev
```

Consultad el [README](./README.es.md#scripts) para los comandos individuales del frontend y Rust.

### Lint y formato (Biome + Lefthook)

El TypeScript y JavaScript de `apps/hub` (`src/`, `scripts/`, `vite.config.ts` y `vitest.canvas.config.ts`) se analizan y formatean con [Biome](https://biomejs.dev) (`apps/hub/biome.json`). El CSS se analiza pero no se formatea, porque hay tests que comprueban su texto literal. CI ejecuta `npx biome ci` en `ci.yml`: cualquier error de lint o archivo sin formatear hace fallar el check; los warnings no.

Después de `npm ci`, ejecutad una vez por clon `npm run hooks:install` desde `apps/hub` para instalar el hook `pre-push` de [Lefthook](https://lefthook.dev) (`lefthook.yml` en la raíz del repositorio). No es automático porque los scripts de ciclo de vida de npm están desactivados. El hook ejecuta `npx biome ci` y `cargo fmt --all -- --check` antes de cada push. Si falla, ejecutad `npm run check:fix` (y `cargo fmt --all` para Rust), haced commit y volved a hacer push. Saltarlo con `--no-verify` solo traslada el fallo a CI.

El formato de Biome de todo el repositorio entró como un commit solo de formato listado en `.git-blame-ignore-revs`; ejecutad una vez `git config blame.ignoreRevsFile .git-blame-ignore-revs` para que `git blame` lo omita. Si teníais una rama abierta antes de ese commit, rebasadla sobre `main` y ejecutad `npm run check:fix` para resolver los conflictos de formato.

### Ramas y pull requests

1. Cread una rama para la issue acordada y mantened el cambio centrado.
2. Usad [Conventional Commits](https://www.conventionalcommits.org/) en los mensajes de commit, por ejemplo `docs: clarify setup`.
3. Antes de **cada** pull request, ejecutad este comando desde la raíz del repositorio:

   ```sh
   scripts/check.sh --windows
   ```

   Ejecutadlo desde WSL con las herramientas y dependencias de Rust y Node para Linux, además de Rust y PowerShell de Windows accesibles desde WSL. Comprueba Rust en Linux y Windows nativo, el frontend y el diff, y guarda los registros en `target/check-logs/`. Los resultados solo de Linux no equivalen a una verificación en Windows nativo.
4. Abrid una pull request enlazada a la issue. Completad la plantilla de PR, incluidos los comandos exactos, sus resultados observados, riesgos y tareas pendientes. Si habéis usado IA, describid su aportación y pedid a una persona que verifique el resultado.

Los títulos de PR también deben seguir Conventional Commits, por ejemplo `feat(hub): add search` o `fix!: change the API`. Los tipos permitidos son `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` y `test`; el alcance y `!` son opcionales.

CI ejecuta las comprobaciones del frontend y el formato/lint de Rust en Ubuntu, además de tests, lint y compilación de Rust nativos en Windows. Los cambios en `.github/` también ejecutan comprobaciones de seguridad de workflows. `main` requiere que CI pase antes de fusionar; el mantenedor configura la protección de la rama por separado. Seguid ejecutando las comprobaciones locales anteriores.

### Configuración de firma de releases (mantenedores)

Una sola vez, generad un par de claves del updater de Tauri desde `apps/hub` con `npx tauri signer generate -w <path>`, eligiendo una ruta privada fuera del repositorio y una contraseña no vacía. Mantened la clave privada fuera del repositorio. Cread el entorno de GitHub Actions `PROD-release` y configurad sus secretos `TAURI_SIGNING_PRIVATE_KEY` (el contenido de la clave privada) y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (su contraseña). Poned la clave pública generada en `apps/hub/src-tauri/tauri.conf.json` como `plugins.updater.pubkey`. Las actualizaciones solo llegan a los usuarios cuando se publica el borrador de la release.

### Design system

Seguid el [ADR 0001](./docs/decisions/0001-adopt-egdev-design-system.md). Usad `@egdev/ui` para la UI compartida y `@egdev/tokens` para los valores visuales; consultad los componentes con `@egdev/mcp` antes de escribir JSX. No añadáis duplicados locales de tokens o componentes del design system. Solicitad las capacidades que falten en el proyecto original; toda solución temporal necesita un comentario enlazado a una issue y una entrada en la lista de excepciones del guard con condición de retirada. No añadáis sobrescrituras `.eg-*` fuera de `apps/hub/src/theme/`. Las excepciones existentes son deuda de migración, no permiso para crear otras. Verificad el comportamiento que depende del navegador en el WebView2 real de Tauri.

La protección se ejecuta con `npm run ds:doctor` (`egdev-ds doctor`) desde `apps/hub`, en CI y en `scripts/check.sh`. Rechaza `<button>`, `<input>`, `<a>` y `<label>` sin componente y los selectores internos del design system fuera de `src/theme/`, salvo que tengan una entrada en [`apps/hub/src/design-system-allowlist.ts`](./apps/hub/src/design-system-allowlist.ts). No la eludáis para introducir excepciones sin seguimiento.

**Quién actualiza el design system.** Los colaboradores no actualizan el design system ni modifican `apps/hub/vendor/`, `apps/hub/egdev-ds.json` ni las entradas `@egdev/*` de `apps/hub/package-lock.json` en sus pull requests. Si necesitáis un componente, una variante o un arreglo del design system, abrid una issue en [egdev6/egdev-design-system](https://github.com/egdev6/egdev-design-system/issues) con el formulario [Consumer request](https://github.com/egdev6/egdev-design-system/issues/new?template=consumer_request.yml), describid la necesidad (sin proponer la solución) y referenciad su número en vuestra pull request o en el comentario de código. CI falla si quedan marcadores pendientes `nexo#TBD-*`; sustituidlos por el número real de la issue antes de fusionar. El mantenedor actualiza el design system en una pull request propia con `egdev-ds upgrade`, nunca mezclada con funcionalidades, para que las pull requests no entren en conflicto por el lockfile o los tarballs vendorizados.

Los mantenedores, con el repositorio del design system clonado junto a este, pueden previsualizar una actualización desde la raíz del repositorio:

```sh
node ../egdev-design-system/packages/cli/bin/egdev-ds.mjs upgrade apps/hub --dry-run
```

La CLI verifica los tarballs contra la release, actualiza el manifiesto y el lockfile y lo revierte todo si algo falla. Tras una actualización, ejecutad `npm run ds:doctor`, reiniciad el servidor de desarrollo con `--force` y regenerad `design/system.md`. Seguid el ADR para las versiones fijadas, la regeneración y el procedimiento completo.
