import type { GuardAllowlistEntry } from './design-system-guard';

// Exact opening tags and selectors: remove each entry when its workaround goes away.
export const designSystemAllowlist: GuardAllowlistEntry[] = [
  {
    file: 'src/first-run/index.tsx', pattern: '<p className="first-run__eyebrow">', kind: 'component-gap',
    comment: '// TODO(egdev-design-system#417): Preserve bilingual language tags.',
    issue: 'egdev6/egdev-design-system#417', reason: 'Replace the intro when SectionHeader supports mixed-language content and decorative separators.',
  },
  {
    file: 'src/settings/index.tsx', pattern: '<h2 id={`${id}-general`}>', kind: 'component-gap',
    comment: '// TODO(egdev-design-system#404): Preserve the General heading until the DS offers this size.',
    issue: 'egdev6/egdev-design-system#404', reason: 'Replace the compact heading style when the DS provides it.',
  },
  {
    file: 'src/settings/index.tsx', pattern: '<h2 id={`${id}-appearance`}>', kind: 'component-gap',
    comment: '// TODO(egdev-design-system#404): Preserve the Appearance heading until the DS offers this size.',
    issue: 'egdev6/egdev-design-system#404', reason: 'Replace the compact heading style when the DS provides it.',
  },
  {
    file: 'src/settings/index.tsx', pattern: '<h2 id={`${id}-about`}>', kind: 'component-gap',
    comment: '// TODO(egdev-design-system#404): Preserve the About heading until the DS offers this size.',
    issue: 'egdev6/egdev-design-system#404', reason: 'Replace the compact heading style when the DS provides it.',
  },
  {
    file: 'src/settings/index.tsx', pattern: '<h2 id={`${id}-author`}>', kind: 'component-gap',
    comment: '// TODO(egdev-design-system#404): Preserve the Author heading until the DS offers this size.',
    issue: 'egdev6/egdev-design-system#404', reason: 'Replace the compact heading style when the DS provides it.',
  },
  {
    file: 'src/settings/local-management.tsx', pattern: '<h2 id={`${id}-apps`}>', kind: 'component-gap',
    comment: '// TODO(egdev-design-system#404): Preserve compact uppercase headings until the DS offers this size.',
    issue: 'egdev6/egdev-design-system#404', reason: 'Replace the compact heading style when the DS provides it.',
  },
  {
    file: 'src/settings/index.tsx', pattern: '<section className="settings__group settings__appearance" aria-labelledby={`${id}-appearance`}>', kind: 'component-gap',
    comment: '// TODO(egdev-design-system#418): Preserve the appearance accent until Panel supports an accent border.',
    issue: 'egdev6/egdev-design-system#418', reason: 'Remove the accent wrapper when Panel supports an accent border.',
  },
  {
    file: 'src/news/news.css', pattern: '.news-carousel .eg-carousel > .overflow-x-auto',
    issue: 'egdev6/egdev-design-system#420', reason: 'Remove the track override when Carousel supports this scrolling layout.',
  },
  {
    file: 'src/news/news.css', pattern: '.news-carousel .eg-carousel > .overflow-x-auto::-webkit-scrollbar',
    issue: 'egdev6/egdev-design-system#420', reason: 'Remove the scrollbar override when Carousel supports this scrolling layout.',
  },
  {
    file: 'src/news/news.css', pattern: ".news-carousel .eg-carousel > .overflow-x-auto > [role='group']",
    issue: 'egdev6/egdev-design-system#420', reason: 'Remove the slide sizing override when Carousel supports full-width slides.',
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
    file: 'src/settings/settings.css', pattern: ".settings__tabs > [role='tablist'] > [role='tab']",
    issue: 'egdev6/egdev-design-system#414', reason: 'Remove tab text layout overrides when Tabs supports the settings layout.',
  },
  {
    file: 'src/settings/settings.css', pattern: '.settings__row .eg-radio-group span',
    issue: 'egdev6/egdev-design-system#419', reason: 'Remove the radio span override when the row and RadioGroup compose without it.',
  },
  {
    file: 'src/settings/settings.css', pattern: '.settings__inline .eg-input',
    issue: 'egdev6/egdev-design-system#419', reason: 'Remove the input flex override when the inline field layout is supported.',
  },
  {
    file: 'src/settings/settings.css', pattern: '.local-app-dialog .eg-dialog__body',
    issue: 'egdev6/egdev-design-system#421', reason: 'Remove the dialog body override when its layout can be composed without DS internals.',
  },
  {
    file: 'src/settings/settings.css', pattern: '.local-app-dialog .eg-btn',
    issue: 'egdev6/egdev-design-system#421', reason: 'Remove dialog button sizing overrides when supported by DS composition.',
  },
  {
    file: 'src/style.css', pattern: ".main-tabs > [role='tablist'] > [role='tab']",
    issue: 'egdev6/egdev-design-system#414', reason: 'Remove tab sizing overrides when Tabs supports fullWidth.',
  },
  {
    file: 'src/style.css', pattern: ".main-tabs > [role='tablist'] > [role='tab'][aria-selected='true']",
    issue: 'egdev6/egdev-design-system#404', reason: 'Remove selected-tab shadow override when family contrast is provided by the DS.',
  },
  {
    file: 'src/style.css', pattern: '.detail-inner .eg-social',
    issue: 'egdev6/egdev-design-system#419', reason: 'Remove social link spacing override when DS composition supports this layout.',
  },
  {
    file: 'src/style.css', pattern: '.eg-social__list',
    issue: 'egdev6/egdev-design-system#419', reason: 'Remove the internal list layout override when SocialLinks supports wrapping.',
  },
  {
    file: 'src/style.css', pattern: '.eg-social__list > li',
    issue: 'egdev6/egdev-design-system#419', reason: 'Remove internal item layout override when SocialLinks supports wrapping.',
  },
];
