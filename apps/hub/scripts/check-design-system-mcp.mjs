import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const hub = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@egdev/cli/bin/egdev-ds.mjs', import.meta.url));
const expectedTools = ['get_component', 'get_design_system_md', 'get_material_recipe', 'get_tokens', 'list_components'];

export function getDesignSystemCommit() {
  try {
    const output = execFileSync(process.execPath, [cli, 'status', '.', '--json'], {
      cwd: hub,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const { commit } = JSON.parse(output);
    if (typeof commit !== 'string' || !/^[a-f0-9]{7}$/.test(commit)) {
      throw new Error('status did not return a valid seven-character commit');
    }
    return commit;
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || (error instanceof Error ? error.message : String(error));
    throw new Error(`Unable to read design-system status: ${detail}`, { cause: error });
  }
}

// Exercise the actual repository MCP configuration, not a separately configured server.
export async function checkDesignSystemMcp() {
  const header = `<!-- Generated from EGDEV design system ${getDesignSystemCommit()}; regenerate: \`node apps/hub/scripts/sync-design-system-md.mjs\` (from repository root). -->\n\n`;
  const config = JSON.parse(await readFile(new URL('../../../.mcp.json', import.meta.url), 'utf8'));
  const server = config.mcpServers['egdev-design-system'];
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['apps/hub/node_modules/@egdev/mcp/dist/index.js']);

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const transport = new StdioClientTransport({ ...server, cwd: root, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: 'nexo-design-system-check', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map(tool => tool.name).sort();
    assert.deepEqual(tools, expectedTools);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0].type, 'text');
      return JSON.parse(result.content[0].text);
    };
    const list = await call('list_components', {});
    assert.ok(list.total > 0);
    assert.ok(list.components.some(component => component.name === 'Notice'));
    const notice = await call('get_component', { name: 'Notice' });
    assert.equal(notice.component.name, 'Notice');
    const { systemMd } = await call('get_design_system_md', {});
    const current = await readFile(new URL('../../../design/system.md', import.meta.url), 'utf8');
    // The upstream renderer leaves one space after an empty anatomy arrow.
    const normalized = systemMd.replace(/ → $/gm, ' →');
    assert.equal(current === header + normalized, true, 'design/system.md is not the generated MCP output with the required header');
    assert.equal(stderr, '');
    return { tools, componentCount: list.total, notice: notice.component };
  } finally {
    await client.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await checkDesignSystemMcp();
}
