# Contributing / Contribuir

**English** · [Español](#español)

---

## English

Thanks for helping improve Nexo. Issues and focused pull requests are welcome.

### Before you start

Search existing issues and pull requests first. Open an issue using the appropriate template, describe the problem or proposal, and wait for maintainer review before implementation. The `status:needs-review`, `status:approved` and `status:in-progress` labels indicate the issue's state. Coordinate ownership and scope before starting; do not assume an open issue is available.

The repository is private, so contributors need access. The hub runs on Windows with WebView2. Install Rust stable and Node.js 22.12+ within 22.x, or 24+; Vitest does not support Node.js 23. The design-system agent tools require Node.js 24.x. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the Windows build tools.

From the repository root, install the frontend dependencies and build it before Rust checks, since the hub embeds the frontend:

```sh
cd apps/hub
npm ci
npm test
npm run build
npm run app:dev
```

See the [README](./README.md#scripts) for the individual frontend and Rust commands.

### Branches and pull requests

1. Create a branch for the agreed issue and keep the change focused.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, for example `docs: clarify setup`.
3. Before **every** pull request, run this command from the repository root:

   ```sh
   scripts/check.sh --windows
   ```

   Run it from WSL with the Linux Rust/Node toolchains and dependencies available, plus Windows Rust and PowerShell accessible through WSL. It runs Linux and native Windows Rust checks, frontend checks and a diff check, and records logs under `target/check-logs/`. Do not treat Linux-only results as native Windows verification.
4. Open a pull request linked to the issue. Complete the PR template, including exact commands and observed results, risks and follow-ups. If AI was used, describe its contribution and have a human verify the result.

The Windows CI workflow (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `main`. Run the local checks before opening a pull request anyway: CI confirms them, it does not replace them.

### Release signing setup (maintainers)

One time, generate a Tauri updater key pair from `apps/hub` with `npx tauri signer generate -w <path>`, choosing a private path outside the repository and a non-empty password. Keep the private key out of the repository. Create the GitHub Actions environment `PROD-release` and set its secrets `TAURI_SIGNING_PRIVATE_KEY` (the private key contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (its password). Put the generated public key in `apps/hub/src-tauri/tauri.conf.json` as `plugins.updater.pubkey`. Updates reach users only after the draft release is published and the repository is public.

### Design system

Follow [ADR 0001](./docs/decisions/0001-adopt-egdev-design-system.md). Use `@egdev/ui` for shared UI and `@egdev/tokens` for visual values; check `@egdev/mcp` for components before writing JSX. Do not add local duplicates of design-system tokens or components. Request missing capabilities upstream; any temporary workaround needs an issue-linked code comment and guard allowlist entry with a removal condition. Do not add `.eg-*` overrides outside `apps/hub/src/theme/`. Existing exceptions are migration debt, not permission for new overrides. Verify browser-dependent behavior in the actual Tauri WebView2.

The guard runs with `npm run ds:doctor` (`egdev-ds doctor`) from `apps/hub`, in CI and in `scripts/check.sh`. It rejects raw `<button>`, `<input>`, `<a>` and `<label>` and DS-internal selectors outside `src/theme/` unless they have an entry in [`apps/hub/src/design-system-allowlist.ts`](./apps/hub/src/design-system-allowlist.ts). Do not bypass it to introduce new untracked exceptions.

Design-system upgrades are separate reviewed changes, made with the `egdev-ds` CLI from a packed release. To preview one from the repository root:

```sh
node ../egdev-design-system/packages/cli/bin/egdev-ds.mjs upgrade apps/hub --dry-run
```

The CLI verifies the tarballs against the release, updates the manifest and lockfile and rolls everything back on failure. After an upgrade, run `npm run ds:doctor`, restart the dev server with `--force` and regenerate `design/system.md`. Follow the ADR for pinned versions, regeneration and the complete upgrade procedure.

---

## Español

Gracias por ayudar a mejorar Nexo. Se agradecen las issues y las pull requests centradas en un cambio concreto.

### Antes de empezar

Buscad primero en las issues y pull requests existentes. Abrid una issue con la plantilla adecuada, describid el problema o la propuesta y esperad la revisión del mantenedor antes de implementar. Las etiquetas `status:needs-review`, `status:approved` y `status:in-progress` indican el estado de la issue. Coordinad la responsabilidad y el alcance antes de empezar; no deis por libre una issue abierta.

El repositorio es privado, por lo que necesitáis acceso. El hub funciona en Windows con WebView2. Instalad Rust estable y Node.js 22.12+ dentro de 22.x, o 24+; Vitest no es compatible con Node.js 23. Las herramientas del design system para agentes requieren Node.js 24.x. Consultad los [requisitos de Tauri](https://v2.tauri.app/start/prerequisites/) para las herramientas de compilación de Windows.

Desde la raíz del repositorio, instalad las dependencias del frontend y compiladlo antes de las comprobaciones de Rust, ya que el hub lo incorpora:

```sh
cd apps/hub
npm ci
npm test
npm run build
npm run app:dev
```

Consultad el [README](./README.es.md#scripts) para los comandos individuales del frontend y Rust.

### Ramas y pull requests

1. Cread una rama para la issue acordada y mantened el cambio centrado.
2. Usad [Conventional Commits](https://www.conventionalcommits.org/) en los mensajes de commit, por ejemplo `docs: clarify setup`.
3. Antes de **cada** pull request, ejecutad este comando desde la raíz del repositorio:

   ```sh
   scripts/check.sh --windows
   ```

   Ejecutadlo desde WSL con las herramientas y dependencias de Rust y Node para Linux, además de Rust y PowerShell de Windows accesibles desde WSL. Comprueba Rust en Linux y Windows nativo, el frontend y el diff, y guarda los registros en `target/check-logs/`. Los resultados solo de Linux no equivalen a una verificación en Windows nativo.
4. Abrid una pull request enlazada a la issue. Completad la plantilla de PR, incluidos los comandos exactos, sus resultados observados, riesgos y tareas pendientes. Si habéis usado IA, describid su aportación y pedid a una persona que verifique el resultado.

El workflow de CI de Windows (`.github/workflows/ci.yml`) se ejecuta en cada pull request y en cada push a `main`. Aun así, ejecutad las comprobaciones locales antes de abrir una pull request: CI las confirma, no las sustituye.

### Configuración de firma de releases (mantenedores)

Una sola vez, generad un par de claves del updater de Tauri desde `apps/hub` con `npx tauri signer generate -w <path>`, eligiendo una ruta privada fuera del repositorio y una contraseña no vacía. Mantened la clave privada fuera del repositorio. Cread el entorno de GitHub Actions `PROD-release` y configurad sus secretos `TAURI_SIGNING_PRIVATE_KEY` (el contenido de la clave privada) y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (su contraseña). Poned la clave pública generada en `apps/hub/src-tauri/tauri.conf.json` como `plugins.updater.pubkey`. Las actualizaciones solo llegan a los usuarios cuando se publica el borrador de la release y el repositorio es público.

### Design system

Seguid el [ADR 0001](./docs/decisions/0001-adopt-egdev-design-system.md). Usad `@egdev/ui` para la UI compartida y `@egdev/tokens` para los valores visuales; consultad los componentes con `@egdev/mcp` antes de escribir JSX. No añadáis duplicados locales de tokens o componentes del design system. Solicitad las capacidades que falten en el proyecto original; toda solución temporal necesita un comentario enlazado a una issue y una entrada en la lista de excepciones del guard con condición de retirada. No añadáis sobrescrituras `.eg-*` fuera de `apps/hub/src/theme/`. Las excepciones existentes son deuda de migración, no permiso para crear otras. Verificad el comportamiento que depende del navegador en el WebView2 real de Tauri.

La protección se ejecuta con `npm run ds:doctor` (`egdev-ds doctor`) desde `apps/hub`, en CI y en `scripts/check.sh`. Rechaza `<button>`, `<input>`, `<a>` y `<label>` sin componente y los selectores internos del design system fuera de `src/theme/`, salvo que tengan una entrada en [`apps/hub/src/design-system-allowlist.ts`](./apps/hub/src/design-system-allowlist.ts). No la eludáis para introducir excepciones sin seguimiento.

Las actualizaciones del design system son cambios separados y revisados, hechos con la CLI `egdev-ds` a partir de una release empaquetada. Para previsualizar una desde la raíz del repositorio:

```sh
node ../egdev-design-system/packages/cli/bin/egdev-ds.mjs upgrade apps/hub --dry-run
```

La CLI verifica los tarballs contra la release, actualiza el manifiesto y el lockfile y lo revierte todo si algo falla. Tras una actualización, ejecutad `npm run ds:doctor`, reiniciad el servidor de desarrollo con `--force` y regenerad `design/system.md`. Seguid el ADR para las versiones fijadas, la regeneración y el procedimiento completo.
