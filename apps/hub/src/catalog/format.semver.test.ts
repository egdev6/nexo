import { expect, it } from 'vitest';
import { compareSemver } from './format';

// Same table as semver_precedence_matches_the_ui_table in update_service_tests.rs.
const rows: [string, string, number | undefined][] = [
  ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
  ['1.0.0-beta.2', '1.0.0-beta.11', -1],
  ['1.0.0-1', '1.0.0-a', -1],
  ['1.0.0-A', '1.0.0-a', -1],
  ['1.0.0-a-b', '1.0.0-a', 1],
  ['1.0.0-99999999999999999999', '1.0.0-100000000000000000000', -1],
  ['1.0.0-rc.1+x', '1.0.0-rc.1', 0],
  ['1.0.0+001', '1.0.0', 0],
  ['18446744073709551615.0.0', '1.0.0', 1],
  ['1.0.0-0', '1.0.0-00a', -1],
  ['1.0.0-01', '1.0.0', undefined],
  ['18446744073709551616.0.0', '1.0.0', undefined],
  ['1.0.0+', '1.0.0', undefined],
  ['1.0.0-a..b', '1.0.0', undefined],
  [' 1.0.0', '1.0.0', undefined],
  ['1.0.0-ä', '1.0.0', undefined],
];

it.each(rows)('compareSemver(%s, %s) = %s, matching native precedence', (a, b, want) => expect(compareSemver(a, b)).toBe(want));
