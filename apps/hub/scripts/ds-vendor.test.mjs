import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, test } from 'vitest';
import { runVendor } from './ds-vendor.mjs';

const app = '/workspace/demo';
const ds = '/egdev-design-system';
const oldCommit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const newCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const oldUi = 'file:vendor/egdev-ui-0.1.0-aaaaaaa.tgz';
const oldTokens = 'file:vendor/egdev-tokens-0.3.0-aaaaaaa.tgz';
const sri = value => `sha512-${createHash('sha512').update(value).digest('base64')}`;
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function fixture({ merged = true, offlineFails = false, failBuild = false, failNpm = false, failAdd = false, failOldRemoval = false, uiVersion = '0.1.0' } = {}) {
  const manifest = {
    name: 'demo', version: '1.0.0',
    dependencies: { '@egdev/ui': oldUi, react: '^19.0.0' },
    devDependencies: { '@egdev/tokens': oldTokens },
    overrides: { '@egdev/tokens': '$@egdev/tokens', other: { '@egdev/ui': oldUi } },
  };
  const lock = {
    name: 'demo', lockfileVersion: 3,
    packages: {
      '': { name: 'demo', version: '1.0.0', dependencies: { ...manifest.dependencies }, devDependencies: { ...manifest.devDependencies } },
      'node_modules/@egdev/ui': { version: '0.1.0', resolved: oldUi, integrity: sri('old-ui'), dependencies: { old: '1' } },
      'node_modules/other/node_modules/@egdev/ui': { version: '0.1.0', resolved: oldUi, integrity: sri('old-ui') },
      'node_modules/@egdev/tokens': { version: '0.3.0', resolved: oldTokens, integrity: sri('old-tokens'), dev: true },
      'node_modules/react': { version: '19.0.0', resolved: 'https://example.invalid/react.tgz', integrity: 'untouched' },
    },
  };
  const files = new Map([
    [path.join(app, 'package.json'), Buffer.from(json(manifest))],
    [path.join(app, 'package-lock.json'), Buffer.from(json(lock))],
    [path.join(app, oldUi.slice(5)), Buffer.from('old-ui')],
    [path.join(app, oldTokens.slice(5)), Buffer.from('old-tokens')],
    [path.join(app, 'node_modules/@egdev/ui/old.txt'), Buffer.from('old')],
  ]);
  const initial = () => Object.fromEntries([...files].filter(([name]) => name.startsWith(`${app}/`)).map(([name, value]) => [name, value.toString()]));
  const actions = [];
  const installSnapshots = [];
  const runner = (command, args, options) => {
    actions.push([command, [...args], options.cwd]);
    const result = (status = 0, stdout = '', stderr = '') => ({ status, stdout, stderr });
    if (command === 'git' && args[0] === 'rev-parse') return result(0, `${args[2].startsWith('a') ? oldCommit : newCommit}\n`);
    if (command === 'git' && args[0] === 'merge-base') return result(merged ? 0 : 1);
    if (command === 'git' && args[0] === 'worktree' && args[1] === 'add' && failAdd) return result(1, '', 'add failed');
    if (command === 'pnpm' && args[0] === 'install' && args.includes('--offline') && offlineFails) return result(1, '', 'not cached');
    if (command === 'pnpm' && args[0] === 'build' && failBuild) return result(1, '', 'build failed');
    if (command === 'node' && args[0] === 'scripts/release-pack.mjs') {
      files.set(path.join(options.cwd, `release/egdev-ui-${uiVersion}.tgz`), Buffer.from('new-ui'));
      files.set(path.join(options.cwd, 'release/egdev-tokens-0.3.0.tgz'), Buffer.from('new-tokens'));
    }
    if (command === 'tar' && args[0] === '-xOf') {
      const isUi = path.basename(args[1]).startsWith('egdev-ui-');
      return result(0, json(isUi
        ? { name: '@egdev/ui', version: uiVersion, dependencies: { new: '2' }, peerDependencies: { react: '^19' } }
        : { name: '@egdev/tokens', version: '0.3.0' }));
    }
    if (command === 'npm') {
      installSnapshots.push({ manifest: JSON.parse(files.get(path.join(app, 'package.json'))), lock: JSON.parse(files.get(path.join(app, 'package-lock.json'))) });
      if (failNpm) return result(1, '', 'simulated npm failure');
    }
    return result();
  };
  const io = {
    readFileSync(name, encoding) {
      const value = files.get(name);
      if (!value) throw Object.assign(new Error(`ENOENT: ${name}`), { code: 'ENOENT' });
      return encoding ? value.toString(encoding) : Buffer.from(value);
    },
    existsSync: name => files.has(name),
    writeFileSync(name, value) { actions.push(['write', name]); files.set(name, Buffer.from(value)); },
    copyFileSync(from, to) { actions.push(['copy', from, to]); files.set(to, Buffer.from(files.get(from))); },
    readdirSync(directory) {
      return [...new Set([...files.keys()].filter(name => name.startsWith(`${directory}/`)).map(name => name.slice(directory.length + 1).split('/')[0]))];
    },
    mkdirSync(name) { actions.push(['mkdir', name]); },
    rmSync(name) {
      actions.push(['remove', name]);
      if (failOldRemoval && name === path.join(app, oldTokens.slice(5))) throw new Error('simulated removal failure');
      for (const key of files.keys()) if (key === name || key.startsWith(`${name}/`)) files.delete(key);
    },
    mkdtempSync() { actions.push(['mkdtemp']); return '/tmp/ds-vendor-fixture'; },
  };
  const invoke = (...args) => {
    let stdout = '', stderr = '';
    const status = runVendor(args, { cwd: '/workspace', io, runner, stdout: text => { stdout += text; }, stderr: text => { stderr += text; }, tempRoot: '/tmp' });
    return { status, stdout, stderr };
  };
  const object = name => JSON.parse(files.get(path.join(app, name)).toString());
  return { files, initial, actions, installSnapshots, invoke, object };
}

const reminders = 'Restart the dev server with --force.\nRegenerate design/system.md (Nexo: node apps/hub/scripts/sync-design-system-md.mjs).\n';

test('help and invalid options have deterministic output and do not touch app state', () => {
  const f = fixture();
  const before = f.initial();
  expect(f.invoke('--help')).toEqual({ status: 0, stdout: 'Usage: node ds-vendor.mjs --app <path> --commit <sha> [--ds <path>] [--packages ui,tokens,system,mcp] [--dry-run] [--allow-unmerged] [--help]\n', stderr: '' });
  expect(f.invoke('--app', 'demo', '--commit', 'not-a-sha')).toEqual({ status: 2, stdout: '', stderr: 'Invalid commit: expected 7-40 hexadecimal characters.\n' });
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb', '--packages', 'ui,unknown')).toEqual({ status: 2, stdout: '', stderr: 'Invalid packages: choose from ui,tokens,system,mcp.\n' });
  expect(f.invoke('--wat')).toEqual({ status: 2, stdout: '', stderr: 'Unknown argument: --wat\n' });
  expect(f.initial()).toEqual(before);
  expect(f.actions).toEqual([]);
});

test('same commit only checks every vendored integrity, including in dry-run', () => {
  const f = fixture();
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'aaaaaaa', '--dry-run')).toEqual({ status: 0, stdout: 'Dry run: already at aaaaaaa; 3 vendored integrities verified; no changes.\n', stderr: '' });
  expect(f.invoke('--app', 'demo', '--commit', 'aaaaaaa')).toEqual({ status: 0, stdout: 'Already at aaaaaaa; 3 vendored integrities verified; no changes.\n', stderr: '' });
  expect(f.initial()).toEqual(before);
  expect(f.actions.every(([name]) => name === 'git')).toBe(true);
  f.files.set(path.join(app, oldUi.slice(5)), Buffer.from('corrupt'));
  const corrupt = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'aaaaaaa')).toEqual({ status: 1, stdout: '', stderr: 'Integrity mismatch: node_modules/@egdev/ui (file:vendor/egdev-ui-0.1.0-aaaaaaa.tgz).\n' });
  expect(f.initial()).toEqual(corrupt);
});

test('dry-run detects direct packages and prints a plan without fetch, writes or installation', () => {
  const f = fixture();
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb', '--dry-run')).toEqual({
    status: 0,
    stdout: 'Dry run for bbbbbbb (app: /workspace/demo; DS: /egdev-design-system):\n  Packages: @egdev/ui, @egdev/tokens\n  Fetch and verify origin/main; pack in a temporary worktree.\n  Vendor tarballs, update package.json and package-lock.json, reinstall offline, verify integrities.\n' + reminders,
    stderr: '',
  });
  expect(f.initial()).toEqual(before);
  expect(f.actions.every(([name, args]) => name === 'git' && args[0] !== 'fetch')).toBe(true);
});

test('refuses an unmerged commit without changing any app state', () => {
  const f = fixture({ merged: false });
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb', '--dry-run')).toEqual({ status: 2, stdout: '', stderr: 'Commit bbbbbbb is not on origin/main; use --allow-unmerged for a temporary test.\n' });
  expect(f.initial()).toEqual(before);
  expect(f.actions.every(([name]) => name === 'git')).toBe(true);
});

test('rewrites selected specifiers, overrides and nested lock entries with fresh sha512 before offline install', () => {
  const f = fixture({ offlineFails: true });
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb')).toEqual({ status: 0, stdout: 'Offline pnpm install failed; retrying online.\nVendored bbbbbbb; 3 vendored integrities verified.\n' + reminders, stderr: '' });
  const ui = 'file:vendor/egdev-ui-0.1.0-bbbbbbb.tgz';
  const tokens = 'file:vendor/egdev-tokens-0.3.0-bbbbbbb.tgz';
  const manifest = f.object('package.json');
  const lock = f.object('package-lock.json');
  expect(manifest.dependencies).toEqual({ '@egdev/ui': ui, react: '^19.0.0' });
  expect(manifest.devDependencies['@egdev/tokens']).toBe(tokens);
  expect(manifest.overrides).toEqual({ '@egdev/tokens': '$@egdev/tokens', other: { '@egdev/ui': ui } });
  expect(lock.packages[''].dependencies['@egdev/ui']).toBe(ui);
  expect(lock.packages[''].devDependencies['@egdev/tokens']).toBe(tokens);
  expect(lock.packages['node_modules/@egdev/ui']).toEqual({ version: '0.1.0', resolved: ui, integrity: sri('new-ui'), dependencies: { new: '2' }, peerDependencies: { react: '^19' } });
  expect(lock.packages['node_modules/other/node_modules/@egdev/ui']).toEqual({ version: '0.1.0', resolved: ui, integrity: sri('new-ui'), dependencies: { new: '2' }, peerDependencies: { react: '^19' } });
  expect(lock.packages['node_modules/@egdev/tokens']).toEqual({ version: '0.3.0', resolved: tokens, integrity: sri('new-tokens'), dev: true });
  expect(lock.packages['node_modules/react'].integrity).toBe('untouched');
  expect(f.files.has(path.join(app, oldUi.slice(5)))).toBe(false);
  expect(f.files.has(path.join(app, oldTokens.slice(5)))).toBe(false);
  expect(f.files.get(path.join(app, ui.slice(5))).toString()).toBe('new-ui');
  expect(f.actions).toContainEqual(['pnpm', ['install', '--frozen-lockfile', '--offline'], '/tmp/ds-vendor-fixture/worktree']);
  expect(f.actions).toContainEqual(['pnpm', ['install', '--frozen-lockfile'], '/tmp/ds-vendor-fixture/worktree']);
  expect(f.actions).toContainEqual(['npm', ['install', '--offline'], app]);
  expect(f.actions).toContainEqual(['git', ['worktree', 'remove', '--force', '/tmp/ds-vendor-fixture/worktree'], ds]);
  expect(f.actions.findIndex(([name, args]) => name === 'write' && args.endsWith('package-lock.json'))).toBeLessThan(f.actions.findIndex(([name]) => name === 'npm'));
  expect(f.installSnapshots[0].lock.packages['node_modules/@egdev/ui']).toEqual(lock.packages['node_modules/@egdev/ui']);
  expect(f.installSnapshots[0].lock.packages['node_modules/@egdev/tokens'].integrity).toBe(sri('new-tokens'));
});

test('explicit package selection changes only that package and keeps other tarballs intact', () => {
  const f = fixture();
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb', '--packages', 'ui').status).toBe(0);
  expect(f.object('package.json').devDependencies['@egdev/tokens']).toBe(oldTokens);
  expect(f.object('package-lock.json').packages['node_modules/@egdev/tokens'].integrity).toBe(sri('old-tokens'));
  expect(f.files.has(path.join(app, oldTokens.slice(5)))).toBe(true);
});

test('detects and upgrades a package declared only in a nested file override', () => {
  const f = fixture();
  const manifest = f.object('package.json');
  delete manifest.devDependencies['@egdev/tokens'];
  manifest.overrides = { other: { '@egdev/tokens': oldTokens } };
  const lock = f.object('package-lock.json');
  delete lock.packages[''].devDependencies['@egdev/tokens'];
  lock.packages['node_modules/other/node_modules/@egdev/tokens'] = lock.packages['node_modules/@egdev/tokens'];
  delete lock.packages['node_modules/@egdev/tokens'];
  f.files.set(path.join(app, 'package.json'), Buffer.from(json(manifest)));
  f.files.set(path.join(app, 'package-lock.json'), Buffer.from(json(lock)));
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'aaaaaaa', '--dry-run')).toEqual({ status: 0, stdout: 'Dry run: already at aaaaaaa; 3 vendored integrities verified; no changes.\n', stderr: '' });
  expect(f.initial()).toEqual(before);
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb')).toEqual({ status: 0, stdout: 'Vendored bbbbbbb; 3 vendored integrities verified.\n' + reminders, stderr: '' });
  const spec = 'file:vendor/egdev-tokens-0.3.0-bbbbbbb.tgz';
  expect(f.object('package.json').overrides.other['@egdev/tokens']).toBe(spec);
  expect(f.object('package-lock.json').packages['node_modules/other/node_modules/@egdev/tokens']).toEqual({ version: '0.3.0', resolved: spec, integrity: sri('new-tokens'), dev: true });
  expect(f.files.has(path.join(app, oldTokens.slice(5)))).toBe(false);
});

test('allow-unmerged uses only selected node_modules directories and explains how to revert', () => {
  const f = fixture({ merged: false });
  const before = Object.fromEntries(Object.entries(f.initial()).filter(([name]) => !name.includes('/node_modules/')));
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb', '--packages', 'ui', '--allow-unmerged')).toEqual({ status: 0, stdout: 'Temporary test installed for bbbbbbb; package.json, package-lock.json and vendor were not changed.\nRevert in /workspace/demo: rm -rf node_modules/@egdev && npm install --offline\n' + reminders, stderr: '' });
  expect(Object.fromEntries(Object.entries(f.initial()).filter(([name]) => !name.includes('/node_modules/')))).toEqual(before);
  expect(f.actions).toContainEqual(['tar', ['-xzf', '/tmp/ds-vendor-fixture/worktree/release/egdev-ui-0.1.0.tgz', '-C', '/workspace/demo/node_modules/@egdev/ui', '--strip-components=1'], app]);
  expect(f.actions.some(([name]) => name === 'npm' || name === 'write' || name === 'copy')).toBe(false);
});

test('cleans the worktree when the build fails and leaves app files unchanged', () => {
  const f = fixture({ failBuild: true });
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb')).toEqual({ status: 1, stdout: '', stderr: 'pnpm build failed: build failed\n' });
  expect(f.initial()).toEqual(before);
  expect(f.actions).toContainEqual(['git', ['worktree', 'remove', '--force', '/tmp/ds-vendor-fixture/worktree'], ds]);
  expect(f.actions).toContainEqual(['remove', '/tmp/ds-vendor-fixture']);
});

test('updates versions and packed dependency metadata before npm runs', () => {
  const f = fixture({ uiVersion: '0.2.0' });
  const result = f.invoke('--app', 'demo', '--commit', 'bbbbbbb', '--packages', 'ui');
  expect(result).toEqual({ status: 0, stdout: 'Vendored bbbbbbb; 3 vendored integrities verified.\n' + reminders, stderr: '' });
  const entry = f.installSnapshots[0].lock.packages['node_modules/@egdev/ui'];
  expect(entry).toEqual({ version: '0.2.0', resolved: 'file:vendor/egdev-ui-0.2.0-bbbbbbb.tgz', integrity: sri('new-ui'), dependencies: { new: '2' }, peerDependencies: { react: '^19' } });
  expect(f.installSnapshots[0].manifest.dependencies['@egdev/ui']).toBe(entry.resolved);
  expect(f.files.has(path.join(app, oldUi.slice(5)))).toBe(false);
});

test('refuses unmerged commits in a non-dry run after fetch and before creating a worktree', () => {
  const f = fixture({ merged: false });
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb')).toEqual({ status: 2, stdout: '', stderr: 'Commit bbbbbbb is not on origin/main; use --allow-unmerged for a temporary test.\n' });
  expect(f.initial()).toEqual(before);
  expect(f.actions).toContainEqual(['git', ['fetch'], ds]);
  expect(f.actions.every(([name]) => name === 'git')).toBe(true);
});

test('temporary dry-run uses an explicit DS path and prints the revert without extracting', () => {
  const f = fixture({ merged: false });
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb', '--ds', '/custom/ds', '--packages', 'ui', '--allow-unmerged', '--dry-run')).toEqual({
    status: 0, stderr: '',
    stdout: 'Dry run for bbbbbbb (app: /workspace/demo; DS: /custom/ds):\n  Packages: @egdev/ui\n  Fetch and verify origin/main; pack in a temporary worktree.\n  Temporarily extract tarballs into node_modules/@egdev; do not change package.json, package-lock.json or vendor.\nRevert in /workspace/demo: rm -rf node_modules/@egdev && npm install --offline\n' + reminders,
  });
  expect(f.initial()).toEqual(before);
  expect(f.actions.every(([name, , cwd]) => name === 'git' && cwd === '/custom/ds')).toBe(true);
});

test('restores package files and old tarballs if offline npm installation fails', () => {
  const f = fixture({ failNpm: true });
  const before = Object.fromEntries(Object.entries(f.initial()).filter(([name]) => !name.includes('/node_modules/')));
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb')).toEqual({ status: 1, stdout: '', stderr: 'npm install --offline failed: simulated npm failure\n' });
  expect(Object.fromEntries(Object.entries(f.initial()).filter(([name]) => !name.includes('/node_modules/')))).toEqual(before);
  expect(f.actions).toContainEqual(['git', ['worktree', 'remove', '--force', '/tmp/ds-vendor-fixture/worktree'], ds]);
});

test('an old archive cleanup error leaves the new installation consistent', () => {
  const f = fixture({ failOldRemoval: true });
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb')).toEqual({ status: 1, stdout: '', stderr: 'Cannot remove old tarball /workspace/demo/vendor/egdev-tokens-0.3.0-aaaaaaa.tgz: simulated removal failure; new installation is intact.\n' });
  const manifest = f.object('package.json');
  const lock = f.object('package-lock.json');
  for (const pkg of ['ui', 'tokens']) {
    const entry = lock.packages[`node_modules/@egdev/${pkg}`];
    expect(sri(f.files.get(path.join(app, entry.resolved.slice(5))))).toBe(entry.integrity);
    expect(Object.values({ ...manifest.dependencies, ...manifest.devDependencies })).toContain(entry.resolved);
  }
  expect(f.actions).toContainEqual(['git', ['worktree', 'remove', '--force', '/tmp/ds-vendor-fixture/worktree'], ds]);
});

test('attempts worktree removal even if worktree add fails', () => {
  const f = fixture({ failAdd: true });
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb')).toEqual({ status: 1, stdout: '', stderr: `git worktree add --detach /tmp/ds-vendor-fixture/worktree ${newCommit} failed: add failed\n` });
  expect(f.initial()).toEqual(before);
  expect(f.actions).toContainEqual(['git', ['worktree', 'remove', '--force', '/tmp/ds-vendor-fixture/worktree'], ds]);
});

test('checks unselected vendored integrities before changing node_modules', () => {
  const f = fixture();
  f.files.set(path.join(app, oldTokens.slice(5)), Buffer.from('corrupt'));
  const before = f.initial();
  expect(f.invoke('--app', 'demo', '--commit', 'bbbbbbb', '--packages', 'ui')).toEqual({ status: 1, stdout: '', stderr: 'Integrity mismatch: node_modules/@egdev/tokens (file:vendor/egdev-tokens-0.3.0-aaaaaaa.tgz).\n' });
  expect(f.initial()).toEqual(before);
  expect(f.actions.some(([name]) => name === 'npm')).toBe(false);
});
