// Release preflight: run by .github/workflows/release.yml before building, and testable as a pure function.
// Usage: node apps/hub/scripts/release-check.mjs <version>   (from the repository root)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function cargoPackageVersion(cargoToml) {
  const section = cargoToml.split(/^\[/m).find((part) => part.startsWith('package]'));
  return section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
}

/** Returns the list of problems; an empty list means the release can be built. */
export function checkRelease({ version, packageJson, cargoToml, tauriConf, notesExist }) {
  if (!SEMVER.test(version)) return [`Version "${version}" must be SemVer without a leading "v" (for example 0.1.0).`];
  const problems = [];
  const packageVersion = JSON.parse(packageJson).version;
  if (packageVersion !== version) problems.push(`apps/hub/package.json has version ${packageVersion}, expected ${version}.`);
  const cargoVersion = cargoPackageVersion(cargoToml);
  if (cargoVersion !== version) problems.push(`apps/hub/src-tauri/Cargo.toml has version ${cargoVersion}, expected ${version}.`);
  if (!notesExist) problems.push(`Missing release notes docs/releases/v${version}.md.`);
  const bundle = JSON.parse(tauriConf).bundle ?? {};
  if (!Array.isArray(bundle.targets) || bundle.targets.length !== 1 || bundle.targets[0] !== 'nsis')
    problems.push('tauri.conf.json bundle.targets must be ["nsis"].');
  if (bundle.windows?.nsis?.installMode !== 'currentUser') problems.push('tauri.conf.json bundle.windows.nsis.installMode must be "currentUser".');
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const version = process.argv[2] ?? '';
  const problems = checkRelease({
    version,
    packageJson: readFileSync(resolve(root, 'apps/hub/package.json'), 'utf8'),
    cargoToml: readFileSync(resolve(root, 'apps/hub/src-tauri/Cargo.toml'), 'utf8'),
    tauriConf: readFileSync(resolve(root, 'apps/hub/src-tauri/tauri.conf.json'), 'utf8'),
    notesExist: existsSync(resolve(root, `docs/releases/v${version}.md`)),
  });
  for (const problem of problems) console.error(`::error::${problem}`);
  if (problems.length) process.exit(1);
  console.log(`Release ${version} preflight passed.`);
}
