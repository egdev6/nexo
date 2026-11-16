import { expect, it } from 'vitest';
import { checkDesignSystemMcp } from './check-design-system-mcp.mjs';

it('serves the vendored design system and keeps its generated reference in sync', async () => {
  const result = await checkDesignSystemMcp();
  expect(result.tools).toEqual(['get_component', 'get_design_system_md', 'get_material_recipe', 'get_tokens', 'list_components']);
  expect(result.notice.name).toBe('Notice');
  expect(result.componentCount).toBeGreaterThan(0);
}, 30_000);
