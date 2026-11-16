import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const packages = ['ui', 'tokens', 'system', 'mcp'];
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const metadataFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'bin', 'engines', 'os', 'cpu'];
const usage = 'Usage: node ds-vendor.mjs --app <path> --commit <sha> [--ds <path>] [--packages ui,tokens,system,mcp] [--dry-run] [--allow-unmerged] [--help]\n';
const reminders = 'Restart the dev server with --force.\nRegenerate design/system.md (Nexo: node apps/hub/scripts/sync-design-system-md.mjs).\n';
const sri = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const json = value => `${JSON.stringify(value, null, 2)}\n`;

class VendorError extends Error {
  constructor(message, status = 1) { super(message); this.status = status; }
}

function parseArgs(args) {
  const options = {};
  const values = new Set(['--app', '--commit', '--ds', '--packages']);
  const flags = new Set(['--dry-run', '--allow-unmerged', '--help']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!values.has(arg) && !flags.has(arg)) throw new VendorError(`Unknown argument: ${arg}`, 2);
    if (Object.hasOwn(options, arg)) throw new VendorError(`Duplicate argument: ${arg}`, 2);
    if (values.has(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new VendorError(`Missing value: ${arg}`, 2);
      options[arg] = args[++i];
    } else options[arg] = true;
  }
  if (options['--help']) return options;
  if (!options['--app'] || !options['--commit']) throw new VendorError('Both --app and --commit are required.', 2);
  if (!/^[a-f\d]{7,40}$/i.test(options['--commit'])) throw new VendorError('Invalid commit: expected 7-40 hexadecimal characters.', 2);
  if (options['--packages']) {
    const names = options['--packages'].split(',');
    if (names.some(name => !packages.includes(name)) || new Set(names).size !== names.length) {
      throw new VendorError('Invalid packages: choose from ui,tokens,system,mcp.', 2);
    }
    options.selected = names;
  }
  return options;
}

function readJson(io, name) {
  try { return JSON.parse(io.readFileSync(name, 'utf8')); }
  catch (error) { throw new VendorError(`Cannot read ${name}: ${error.message}`); }
}

function safeVendorFile(spec) {
  const match = typeof spec === 'string' && spec.match(/^file:vendor\/(egdev-[a-z0-9][a-z0-9.+-]*\.tgz)$/);
  return match ? match[1] : null;
}

// Collect actual override values, not parent selectors such as { "other": { ... } }.
function overrideEntries(value) {
  const entries = [];
  function visit(object) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return;
    for (const [key, current] of Object.entries(object)) {
      const pkg = packages.find(name => key === `@egdev/${name}` || key.startsWith(`@egdev/${name}@`));
      if (pkg && typeof current === 'string') entries.push({ pkg, owner: object, key });
      if (pkg && current && typeof current === 'object' && typeof current['.'] === 'string') entries.push({ pkg, owner: current, key: '.' });
      if (current && typeof current === 'object') visit(current);
    }
  }
  visit(value);
  return entries;
}

function declaredPackages(manifest) {
  const overrides = overrideEntries(manifest.overrides);
  return packages.filter(pkg => dependencyFields.some(field => Object.hasOwn(manifest[field] ?? {}, `@egdev/${pkg}`))
    || overrides.some(entry => entry.pkg === pkg && safeVendorFile(entry.owner[entry.key])));
}

function verifyIntegrities(io, app, lock) {
  if (!lock.packages || typeof lock.packages !== 'object') throw new VendorError('package-lock.json must contain a packages map.');
  let count = 0;
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith('file:vendor/egdev-')) continue;
    const file = safeVendorFile(entry.resolved);
    if (!file) throw new VendorError(`Unsafe vendored path: ${entry.resolved}.`);
    let digest;
    try { digest = sri(io.readFileSync(path.join(app, 'vendor', file))); }
    catch (error) { throw new VendorError(`Cannot read vendored tarball ${entry.resolved}: ${error.message}`); }
    if (digest !== entry.integrity) throw new VendorError(`Integrity mismatch: ${key} (${entry.resolved}).`);
    count++;
  }
  return count;
}

function isCurrent(manifest, lock, selected, commit) {
  const overrides = overrideEntries(manifest.overrides);
  return selected.every(pkg => {
    const name = `@egdev/${pkg}`;
    const specs = dependencyFields.filter(field => Object.hasOwn(manifest[field] ?? {}, name))
      .map(field => ({ field, spec: manifest[field][name] }));
    for (const entry of overrides.filter(item => item.pkg === pkg && !item.owner[item.key].startsWith('$'))) {
      specs.push({ spec: entry.owner[entry.key] });
    }
    return specs.length > 0 && specs.every(({ field, spec }) => {
      const file = safeVendorFile(spec);
      const match = file?.match(new RegExp(`^egdev-${pkg}-.+-([a-f\\d]{7,40})\\.tgz$`, 'i'));
      if (!match || !commit.startsWith(match[1].toLowerCase())) return false;
      if (field) return lock.packages?.['']?.[field]?.[name] === spec && lock.packages?.[`node_modules/${name}`]?.resolved === spec;
      return Object.entries(lock.packages ?? {}).some(([key, entry]) =>
        (key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)) && entry.resolved === spec);
    });
  });
}

function rewriteOverrides(value, updates) {
  for (const { pkg, owner, key } of overrideEntries(value)) {
    if (updates[pkg] && !owner[key].startsWith('$')) owner[key] = updates[pkg].spec;
  }
}

function rewriteFiles(manifest, lock, updates) {
  if (!lock.packages?.['']) throw new VendorError('package-lock.json must contain the root package.');
  const previous = new Set();
  for (const [pkg, update] of Object.entries(updates)) {
    const name = `@egdev/${pkg}`;
    for (const field of dependencyFields) {
      if (!Object.hasOwn(manifest[field] ?? {}, name)) continue;
      const old = safeVendorFile(manifest[field][name]);
      if (old) previous.add(old);
      manifest[field][name] = update.spec;
      lock.packages[''][field] ??= {};
      lock.packages[''][field][name] = update.spec;
    }
    let found = false;
    for (const [key, entry] of Object.entries(lock.packages)) {
      const root = key === `node_modules/${name}`;
      const nested = key.endsWith(`/node_modules/${name}`) && safeVendorFile(entry.resolved);
      if (!root && !nested) continue;
      found = true;
      const old = safeVendorFile(entry.resolved);
      if (old) previous.add(old);
      entry.version = update.manifest.version;
      entry.resolved = update.spec;
      entry.integrity = update.integrity;
      for (const field of metadataFields) {
        delete entry[field];
        if (Object.hasOwn(update.manifest, field)) entry[field] = update.manifest[field];
      }
    }
    if (!found) throw new VendorError(`No lockfile entry for ${name}.`);
  }
  rewriteOverrides(manifest.overrides, updates);
  return previous;
}

function command(runner, executable, args, cwd, { allowFailure = false } = {}) {
  const result = runner(executable, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    if (allowFailure) return result;
    const detail = (result.stderr || result.error?.message || result.stdout || `exit ${result.status}`).trim();
    throw new VendorError(`${executable} ${args.join(' ')} failed: ${detail}`);
  }
  return result;
}

function resolveCommit(runner, ds, revision, allowFailure = false) {
  const result = command(runner, 'git', ['rev-parse', '--verify', `${revision}^{commit}`], ds, { allowFailure });
  if (result.status !== 0 || result.error) return null;
  const commit = result.stdout.trim().toLowerCase();
  if (!/^[a-f\d]{40,64}$/.test(commit)) throw new VendorError(`Git returned an invalid commit for ${revision}.`);
  return commit;
}

function checkMerged(runner, ds, commit, short, allowUnmerged) {
  const result = command(runner, 'git', ['merge-base', '--is-ancestor', commit, 'origin/main'], ds, { allowFailure: true });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new VendorError(`Cannot verify origin/main: ${(result.stderr || result.error?.message || `exit ${result.status}`).trim()}`);
  }
  if (result.status === 1 && !allowUnmerged) throw new VendorError(`Commit ${short} is not on origin/main; use --allow-unmerged for a temporary test.`, 2);
}

function packedUpdates(io, runner, worktree, selected, short) {
  const release = path.join(worktree, 'release');
  const files = io.readdirSync(release);
  return Object.fromEntries(selected.map(pkg => {
    const prefix = `egdev-${pkg}-`;
    const candidates = files.filter(file => file.startsWith(prefix) && /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?\.tgz$/i.test(file.slice(prefix.length)));
    if (candidates.length !== 1) throw new VendorError(`Expected one packed tarball for @egdev/${pkg}; found ${candidates.length}.`);
    const source = path.join(release, candidates[0]);
    let manifest;
    try { manifest = JSON.parse(command(runner, 'tar', ['-xOf', source, 'package/package.json'], worktree).stdout); }
    catch (error) { throw new VendorError(`Cannot read packed manifest for @egdev/${pkg}: ${error.message}`); }
    if (manifest.name !== `@egdev/${pkg}` || `${prefix}${manifest.version}.tgz` !== candidates[0]) {
      throw new VendorError(`Packed manifest does not match ${candidates[0]}.`);
    }
    const filename = `${prefix}${manifest.version}-${short}.tgz`;
    return [pkg, { source, filename, manifest, spec: `file:vendor/${filename}`, integrity: sri(io.readFileSync(source)) }];
  }));
}

function withWorktree(io, runner, ds, commit, tempRoot, perform) {
  const temp = io.mkdtempSync(path.join(tempRoot, 'egdev-ds-vendor-'));
  const worktree = path.join(temp, 'worktree');
  let failure;
  let result;
  try {
    command(runner, 'git', ['worktree', 'add', '--detach', worktree, commit], ds);
    result = perform(worktree);
  } catch (error) { failure = error; }
  try { command(runner, 'git', ['worktree', 'remove', '--force', worktree], ds); }
  catch (error) {
    throw new VendorError(`${failure ? `${failure.message}\n` : ''}${error.message}\nTemporary worktree retained at ${temp}; remove it from the DS repository manually.`);
  }
  io.rmSync(temp, { recursive: true, force: true });
  if (failure) throw failure;
  return result;
}

function installVendor(io, runner, app, manifest, lock, updates) {
  const packageFile = path.join(app, 'package.json');
  const lockFile = path.join(app, 'package-lock.json');
  const originalPackage = io.readFileSync(packageFile);
  const originalLock = io.readFileSync(lockFile);
  const previous = rewriteFiles(manifest, lock, updates);
  const copied = [];
  for (const update of Object.values(updates)) {
    const destination = path.join(app, 'vendor', update.filename);
    if (io.existsSync(destination) && sri(io.readFileSync(destination)) !== update.integrity) {
      throw new VendorError(`Refusing to overwrite a different tarball: ${destination}.`);
    }
  }
  let installedLock;
  let count;
  try {
    io.mkdirSync(path.join(app, 'vendor'), { recursive: true });
    for (const update of Object.values(updates)) {
      const destination = path.join(app, 'vendor', update.filename);
      if (!io.existsSync(destination)) { io.copyFileSync(update.source, destination); copied.push(destination); }
    }
    io.writeFileSync(packageFile, json(manifest));
    io.writeFileSync(lockFile, json(lock));
    verifyIntegrities(io, app, lock);
    io.rmSync(path.join(app, 'node_modules', '@egdev'), { recursive: true, force: true });
    command(runner, 'npm', ['install', '--offline'], app);
    installedLock = readJson(io, lockFile);
    count = verifyIntegrities(io, app, installedLock);
    if (!isCurrent(readJson(io, packageFile), installedLock, Object.keys(updates), updates[Object.keys(updates)[0]].commit)) {
      throw new VendorError('Installed package specifiers do not match the selected commit.');
    }
  } catch (error) {
    io.writeFileSync(packageFile, originalPackage);
    io.writeFileSync(lockFile, originalLock);
    for (const file of copied) io.rmSync(file, { force: true });
    throw error;
  }
  // Once installation succeeds, never roll back to references whose archives may already be gone.
  const remaining = JSON.stringify([readJson(io, packageFile), installedLock]);
  for (const old of previous) {
    if (remaining.includes(`file:vendor/${old}`)) continue;
    const file = path.join(app, 'vendor', old);
    try { io.rmSync(file, { force: true }); }
    catch (error) { throw new VendorError(`Cannot remove old tarball ${file}: ${error.message}; new installation is intact.`); }
  }
  return count;
}

/** Run the CLI with injectable filesystem and process runner for deterministic tests. */
export function runVendor(args, {
  cwd = process.cwd(), io = fs, runner = spawnSync,
  stdout = text => process.stdout.write(text), stderr = text => process.stderr.write(text), tempRoot = os.tmpdir(),
} = {}) {
  try {
    const options = parseArgs(args);
    if (options['--help']) { stdout(usage); return 0; }
    const app = path.resolve(cwd, options['--app']);
    const ds = path.resolve(cwd, options['--ds'] ?? '../egdev-design-system');
    const requested = options['--commit'].toLowerCase();
    const manifest = readJson(io, path.join(app, 'package.json'));
    const lock = readJson(io, path.join(app, 'package-lock.json'));
    const detected = declaredPackages(manifest);
    const selected = options.selected ?? detected;
    if (!selected.length) throw new VendorError('No supported @egdev packages found in package.json.', 2);
    const missing = selected.filter(pkg => !detected.includes(pkg));
    if (missing.length) throw new VendorError(`Packages not declared or vendored by an override in package.json: ${missing.map(pkg => `@egdev/${pkg}`).join(', ')}.`, 2);

    let commit = resolveCommit(runner, ds, requested, true);
    if (commit && !options['--allow-unmerged'] && isCurrent(manifest, lock, selected, commit)) {
      checkMerged(runner, ds, commit, commit.slice(0, 7), false);
      const count = verifyIntegrities(io, app, lock);
      stdout(`${options['--dry-run'] ? 'Dry run: already' : 'Already'} at ${commit.slice(0, 7)}; ${count} vendored integrities verified; no changes.\n`);
      return 0;
    }
    if (!options['--dry-run']) {
      command(runner, 'git', ['fetch'], ds);
      commit = resolveCommit(runner, ds, requested);
    }
    if (!commit) throw new VendorError(`Commit ${requested} is not available locally; fetch the DS repository first.`);
    const short = commit.slice(0, 7);
    checkMerged(runner, ds, commit, short, options['--allow-unmerged']);
    if (options['--dry-run']) {
      stdout(`Dry run for ${short} (app: ${app}; DS: ${ds}):\n  Packages: ${selected.map(pkg => `@egdev/${pkg}`).join(', ')}\n  Fetch and verify origin/main; pack in a temporary worktree.\n`);
      stdout(options['--allow-unmerged']
        ? '  Temporarily extract tarballs into node_modules/@egdev; do not change package.json, package-lock.json or vendor.\n'
        : '  Vendor tarballs, update package.json and package-lock.json, reinstall offline, verify integrities.\n');
      if (options['--allow-unmerged']) stdout(`Revert in ${app}: rm -rf node_modules/@egdev && npm install --offline\n`);
      stdout(reminders);
      return 0;
    }
    const count = withWorktree(io, runner, ds, commit, tempRoot, worktree => {
      const offline = command(runner, 'pnpm', ['install', '--frozen-lockfile', '--offline'], worktree, { allowFailure: true });
      if (offline.error || offline.status !== 0) {
        stdout('Offline pnpm install failed; retrying online.\n');
        command(runner, 'pnpm', ['install', '--frozen-lockfile'], worktree);
      }
      command(runner, 'pnpm', ['build'], worktree);
      command(runner, 'node', ['scripts/release-pack.mjs'], worktree);
      const updates = packedUpdates(io, runner, worktree, selected, short);
      if (options['--allow-unmerged']) {
        for (const [pkg, update] of Object.entries(updates)) {
          const destination = path.join(app, 'node_modules', '@egdev', pkg);
          io.rmSync(destination, { recursive: true, force: true });
          io.mkdirSync(destination, { recursive: true });
          command(runner, 'tar', ['-xzf', update.source, '-C', destination, '--strip-components=1'], app);
        }
        return 0;
      }
      for (const update of Object.values(updates)) update.commit = commit;
      return installVendor(io, runner, app, manifest, lock, updates);
    });
    if (options['--allow-unmerged']) {
      stdout(`Temporary test installed for ${short}; package.json, package-lock.json and vendor were not changed.\nRevert in ${app}: rm -rf node_modules/@egdev && npm install --offline\n`);
    } else stdout(`Vendored ${short}; ${count} vendored integrities verified.\n`);
    stdout(reminders);
    return 0;
  } catch (error) {
    stderr(`${error.message}\n`);
    return error.status ?? 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runVendor(process.argv.slice(2));
}
