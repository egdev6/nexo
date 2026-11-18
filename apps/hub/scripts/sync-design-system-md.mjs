import { readFile, writeFile } from 'node:fs/promises';
import { renderSystemMd } from '@egdev/system';

const artifact = JSON.parse(await readFile(new URL(import.meta.resolve('@egdev/system/design-system.json')), 'utf8'));
const header = '<!-- Generated from EGDEV design system e712915; regenerate: `node apps/hub/scripts/sync-design-system-md.mjs` (from repository root). -->\n\n';
// The upstream renderer leaves one space after an empty anatomy arrow.
const markdown = renderSystemMd(artifact).replace(/ → $/gm, ' →');
await writeFile(new URL('../../../design/system.md', import.meta.url), header + markdown);
