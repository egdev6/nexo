import type { GuardAllowlistEntry } from '@egdev/cli';

// Exact opening tags and selectors: remove each entry when its workaround goes away.
export const designSystemAllowlist: readonly GuardAllowlistEntry[] = [
  {
    file: 'src/settings/settings.css',
    pattern: '.settings__back-icon',
    issue: 'egdev6/egdev-design-system#537',
    reason: 'Rotate arrow-right into a back arrow until the icon set offers one (DS046).',
  },
];
