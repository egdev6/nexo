import { expect, test } from 'vitest';
import { checkRelease } from './release-check.mjs';

const pkg = version => JSON.stringify({ name: 'nexo-hub', version });
const cargo = version => `[package]\nname = "nexo-hub"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1" }\n`;
const conf = (bundle = { targets: ['nsis'], windows: { nsis: { installMode: 'currentUser' } } }) => JSON.stringify({ productName: 'Nexo', version: '../package.json', bundle });

test('accepts a matching SemVer version with notes and a per-user NSIS bundle', () => {
  expect(checkRelease({ version: '0.1.0', packageJson: pkg('0.1.0'), cargoToml: cargo('0.1.0'), tauriConf: conf(), notesExist: true })).toEqual([]);
});

test('rejects malformed input, mismatched manifests, missing notes and the wrong installer', () => {
  expect(checkRelease({ version: 'v0.1.0', packageJson: pkg('0.1.0'), cargoToml: cargo('0.1.0'), tauriConf: conf(), notesExist: true }))
    .toEqual(['Version "v0.1.0" must be SemVer without a leading "v" (for example 0.1.0).']);
  expect(checkRelease({ version: '0.1.1', packageJson: pkg('0.1.0'), cargoToml: cargo('0.1.2'), tauriConf: conf(), notesExist: false })).toEqual([
    'apps/hub/package.json has version 0.1.0, expected 0.1.1.',
    'apps/hub/src-tauri/Cargo.toml has version 0.1.2, expected 0.1.1.',
    'Missing release notes docs/releases/v0.1.1.md.',
  ]);
  expect(checkRelease({ version: '0.1.0', packageJson: pkg('0.1.0'), cargoToml: cargo('0.1.0'), tauriConf: conf({ targets: 'all' }), notesExist: true })).toEqual([
    'tauri.conf.json bundle.targets must be ["nsis"].',
    'tauri.conf.json bundle.windows.nsis.installMode must be "currentUser".',
  ]);
});

test('the real repository manifests are consistent with each other', async () => {
  // @ts-ignore Node globals in a Node-run test.
  const { readFileSync, existsSync } = await import('node:fs');
  const packageJson = readFileSync('package.json', 'utf8');
  const version = JSON.parse(packageJson).version;
  expect(checkRelease({ version, packageJson, cargoToml: readFileSync('src-tauri/Cargo.toml', 'utf8'), tauriConf: readFileSync('src-tauri/tauri.conf.json', 'utf8'), notesExist: existsSync(`../../docs/releases/v${version}.md`) })).toEqual([]);
});
