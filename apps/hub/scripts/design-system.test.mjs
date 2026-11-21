import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { checkDesignSystemMcp } from './check-design-system-mcp.mjs';

const reference = new URL('../../../design/system.md', import.meta.url);
const statusCommit = 'ca11bac';
const withCommit = (markdown, commit) => markdown.replace(/^(<!-- Generated from EGDEV design system )[^;]+;/, `$1${commit};`);

function mockStatus(implementation) {
  const runStatus = vi.fn(implementation);
  vi.doMock('node:child_process', async (importOriginal) => ({
    ...(await importOriginal()),
    execFileSync: runStatus,
  }));
  return runStatus;
}

afterEach(() => {
  vi.doUnmock('node:child_process');
  vi.doUnmock('node:fs/promises');
  vi.resetModules();
});

it('serves the vendored design system and keeps its generated reference in sync', async () => {
  const result = await checkDesignSystemMcp();
  expect(result.tools).toEqual(['get_component', 'get_design_system_md', 'get_material_recipe', 'get_tokens', 'list_components']);
  expect(result.notice.name).toBe('Notice');
  expect(result.componentCount).toBeGreaterThan(0);
}, 30_000);

it('generates the reference with the commit reported by status', async () => {
  const status = mockStatus(() => JSON.stringify({ commit: statusCommit }));
  const writeFile = vi.fn();
  vi.doMock('node:fs/promises', async (importOriginal) => ({
    ...(await importOriginal()),
    writeFile,
  }));

  await import('./sync-design-system-md.mjs');

  expect(status).toHaveBeenCalledOnce();
  expect(writeFile).toHaveBeenCalledOnce();
  expect(String(writeFile.mock.calls[0][0])).toBe(reference.href);
  expect(writeFile.mock.calls[0][1]).toBe(withCommit(await readFile(reference, 'utf8'), statusCommit));
});

it('checks the MCP reference against the commit reported by status', async () => {
  const status = mockStatus(() => JSON.stringify({ commit: statusCommit }));
  const original = await readFile(reference, 'utf8');
  let markdown = withCommit(original, statusCommit);
  vi.doMock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      readFile: (path, ...args) => (String(path) === reference.href ? Promise.resolve(markdown) : actual.readFile(path, ...args)),
    };
  });
  const { checkDesignSystemMcp: check } = await import('./check-design-system-mcp.mjs');

  await expect(check()).resolves.toMatchObject({ notice: { name: 'Notice' } });
  markdown = withCommit(original, 'badc0de');
  await expect(check()).rejects.toThrow('design/system.md is not the generated MCP output with the required header');
  expect(status).toHaveBeenCalledTimes(2);
}, 30_000);

it('does not write the reference if status fails', async () => {
  mockStatus(() => {
    throw new Error('status command failed');
  });
  const writeFile = vi.fn();
  vi.doMock('node:fs/promises', async (importOriginal) => ({
    ...(await importOriginal()),
    writeFile,
  }));

  await expect(import('./sync-design-system-md.mjs')).rejects.toThrow(/status/i);
  expect(writeFile).not.toHaveBeenCalled();
});

it('fails the MCP check clearly if status fails', async () => {
  mockStatus(() => {
    throw new Error('status command failed');
  });
  const { checkDesignSystemMcp: check } = await import('./check-design-system-mcp.mjs');

  await expect(check()).rejects.toThrow(/status/i);
}, 30_000);

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scriptPath = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));
const preload = (code) => `data:text/javascript,${encodeURIComponent(code)}`;

it('runs the MCP check as a command and rejects an out-of-sync commit', () => {
  const script = scriptPath('check-design-system-mcp.mjs');
  const valid = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  expect(valid.status).toBe(0);
  expect(valid.stdout).toBe('');
  expect(valid.stderr).toBe('');

  const fakeStatus = preload(`
    import child from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    child.execFileSync = () => JSON.stringify({ commit: 'badc0de' });
    syncBuiltinESMExports();
  `);
  const stale = spawnSync(process.execPath, ['--import', fakeStatus, script], { cwd: root, encoding: 'utf8' });
  expect(stale.status).toBe(1);
  expect(stale.stdout).toBe('');
  expect(stale.stderr).toContain('design/system.md is not the generated MCP output with the required header');
}, 30_000);

it('exits clearly without changing the reference when status fails', async () => {
  const before = await readFile(reference, 'utf8');
  const failedStatus = preload(`
    import child from 'node:child_process';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    child.execFileSync = () => { const error = new Error('injected failure'); error.stderr = 'injected failure'; throw error; };
    fs.writeFile = () => { throw new Error('unexpected write'); };
    syncBuiltinESMExports();
  `);
  for (const name of ['sync-design-system-md.mjs', 'check-design-system-mcp.mjs']) {
    const result = spawnSync(process.execPath, ['--import', failedStatus, scriptPath(name)], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unable to read design-system status: injected failure');
    expect(await readFile(reference, 'utf8')).toBe(before);
  }
}, 30_000);
