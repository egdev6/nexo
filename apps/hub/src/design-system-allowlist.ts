import type { GuardAllowlistEntry } from './design-system-guard';

// Exact opening tags and selectors: remove each entry when its workaround goes away.
export const designSystemAllowlist: GuardAllowlistEntry[] = [
  {
    file: 'src/settings/index.tsx', pattern: '<section className="settings__group settings__appearance" aria-labelledby={`${id}-appearance`}>', kind: 'component-gap',
    comment: '// TODO(egdev-design-system#418): Preserve the appearance accent until Panel supports an accent border.',
    issue: 'egdev6/egdev-design-system#418', reason: 'Remove the accent wrapper when Panel supports an accent border.',
  },
  {
    file: 'src/settings/index.tsx',
    pattern: `<button className="settings__swatch" type="button" key={color} style={{ backgroundColor: color }} aria-label={tr('settings.useColor', { name: tr(colorNames[index]), color })} aria-pressed={selected === color} onClick={() => update('accent', color)} />`,
    issue: 'egdev6/egdev-design-system#416', reason: 'Replace the raw preset button with ColorSwatchGroup.',
  },
  {
    file: 'src/settings/index.tsx', pattern: `<label className="settings__swatch settings__custom" title={tr('settings.chooseColor')}>`,
    issue: 'egdev6/egdev-design-system#416', reason: 'Replace the custom color label with ColorSwatchGroup.',
  },
  {
    file: 'src/settings/index.tsx',
    pattern: `<input type="color" aria-label={tr('settings.chooseAccent')} value={selected} onChange={event => update('accent', event.currentTarget.value)} />`,
    issue: 'egdev6/egdev-design-system#416', reason: 'Replace the native color input with ColorSwatchGroup.',
  },
  {
    file: 'src/style.css', pattern: ".main-tabs > [role='tablist'] > [role='tab'][aria-selected='true']",
    issue: 'egdev6/egdev-design-system#404', reason: 'Remove selected-tab shadow override when family contrast is provided by the DS.',
  },
];
