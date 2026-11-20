# CI hardening for the public repository
> Objective: make CI fast and safe for external contributions before egdev6/nexo goes public (Monday 2026-11-23). Branch: ci/public-hardening (from origin/main). Separate PR from feat/self-update (#80). Runner: GitHub Actions; local YAML/lint checks.

## Specs

- S1: "habría que mejorar la CI del proyecto, ya que lo hacemos publico"
- S2: "Velocidad: jobs paralelos + caché" — "Frontend y fmt/lint en Ubuntu (rápido), tests nativos en Windows; caché de Cargo y npm. Pasa de ~20 min en serie a bastante menos."
- S3: "Seguridad de workflows" — "actionlint + zizmor en cada PR que toque .github/, permisos mínimos por job y PRs de forks sin secretos."
- S4: "Reglas de PR" — "Título en Conventional Commits y protección de main exigiendo que la CI pase antes de mergear."
- Excluded by the maintainer: Dependabot and dependency audits ("Dependencias" not selected).

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S2, S3, S4 (workflows) | worker | done locally (actionlint, zizmor 1.32.0 offline, YAML parse, 27 PR-title cases); GitHub run pending | (this commit) |
| T2 | S4 (branch protection on main requiring the CI checks) | parent, after T1 merges (GitHub setting; may need the repo public) | pending | |

## Log

- L1 (2026-11-20, user): "habría que mejorar la CI del proyecto, ya que lo hacemos publico" → selected: "Velocidad: jobs paralelos + caché", "Seguridad de workflows", "Reglas de PR".
- L2 (context): ci.yml today: one `windows-latest` job, serial (fmt, npm ci, ds:doctor, vitest, build, clippy, cargo test, cargo build), `package-manager-cache: false`, no Rust cache. Workflow was disabled_manually until 2026-11-20; previous runs 43759232821 (push 7d1c6cb) and 43756583759 (PR 95d69f3) failed. Other workflows: release.yml (manual, signed in PROD-release since feat/self-update), issue-lifecycle.yml (disabled_manually).
- L3 (T1 worker): earlier CI failures 43759232821/43756583759 never started: GitHub billing (failed payment / spending limit), not code. Jobs: `Frontend (Ubuntu)`, `Rust lint (Ubuntu)`, `Rust tests and lint (Windows)`, `PR title`; `Workflow lint (actionlint + zizmor)` is path-filtered (not a required check). Baseline single-job CI on PR #80: 14m32s.
