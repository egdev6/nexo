# Biome lint/format + Lefthook pre-push + CI gate (apps/hub)
Branch: `chore/biome-lefthook` from `main` (a8f0579). Mirrors egdev6/quorb#307. Format and lint-fix slices wait for nexo PR #84 to merge, then the branch is rebased on `main`.
Risk: item 5 (dev dependencies, git hooks and CI gates); item 6 for lint fixes that touch runtime code (each fix covered by existing tests or justified).

## Specs

- S1: "añadamos también biome y lefthook como hicimos en quorb" — Quorb reference: `biome.json` (Biome 2.6.8, recommended rules, single quotes, JSX double quotes, lineWidth 160, CSS formatter off, assist off), `lefthook.yml` pre-push (`npx biome ci` + `cargo fmt --check`, no npm `prepare` script; `npm run hooks:install` once per clone), npm scripts `lint`, `format`, `check`, `check:fix`, `hooks:install`, CI step `npx biome ci`, `.gitattributes` LF for Biome-checked files, a format-only commit listed in `.git-blame-ignore-revs`, every Biome lint error fixed, CONTRIBUTING EN/ES section.
- S2: Timing chosen by the user: "Después de mergear #84 (Recomendado)" — tooling can be prepared now; the format commit and lint fixes happen on a branch rebased on `main` after #84 merges.
- S3: Scope chosen by the user: "Igual que Quorb, sin aviso en Discord".
- S4: Baseline measured on `main` (Biome 2.6.8, Quorb config, includes `src/**`, `scripts/**`, `vite.config.ts`, `vitest.canvas.config.ts`; `vcs.root` `../..` because `apps/hub` is nested): lint 79 errors, 223 warnings, 3 infos over 105 files; formatter rewrites 86 of 96 files.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1, S3 | parent inline: Biome + Lefthook dev deps (exact), `apps/hub/biome.json`, root `lefthook.yml`, npm scripts, CI step, `scripts/check.sh` step, `.gitattributes`, CONTRIBUTING EN/ES, README scripts | done: lockfile only adds biome/lefthook packages; `lefthook validate` ok; forced pre-push runs biome (fails until T2/T3, expected) and cargo-fmt (pass), exit 1 | see git log |
| T2 | S1, S2 | parent: rebase on `main` after #84; format-only commit + `.git-blame-ignore-revs` | blocked (waits for #84 merge) | |
| T3 | S1, S4 | fix every Biome lint error (tests/scripts, then app source) | blocked (after T2) | |
| T4 | all | verify: `npx biome ci`, `npm test`, `npm run build`, `ds:doctor`, cargo fmt, lefthook pre-push probe (fails on a lint error, passes clean) | blocked (after T3) | |

## Log

- L1 (2026-11-21, user): "añadamos también biome y lefthook como hicimos en quorb"
- L2 (2026-11-21, user): timing "Después de mergear #84 (Recomendado)"; scope "Igual que Quorb, sin aviso en Discord".
- L3 (2026-11-21, quorb lessons): PR must not be squash-merged or the blame-ignored SHA is lost; CSS formatter off because tests assert literal CSS; no npm lifecycle `prepare` script.
- L4 (2026-11-21, evidence): `lefthook run` auto-installs hooks (pre-push, prepare-commit-msg) into .git/hooks; parent uninstalled them so pushes of other branches are not blocked before T2/T3. Use `--no-auto-install` for probes. Lefthook skips pre-push jobs without push files unless `--force`.
