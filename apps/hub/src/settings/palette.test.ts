import { describe, expect, it } from 'vitest';
import { derivePalette, normalizeHex } from './palette';

// Quorb src/lib/palette.ts:55-60: HSL lightness clamp, then 92% and 52% white tints.
describe('Quorb accent palette', () => {
  it.each([
    ['#ff0036', '#ff0036', '#ffebef', '#ff859f'],
    ['#ff7a00', '#ff7a00', '#fff4eb', '#ffbf85'],
    ['#ffd400', '#ffd400', '#fffceb', '#ffea85'],
    ['#22c55e', '#22c55e', '#edfaf2', '#95e3b2'],
    ['#00c2ff', '#00c2ff', '#ebfaff', '#85e2ff'],
    ['#3b82f6', '#3b82f6', '#eff5fe', '#a1c3fb'],
    ['#8b5cf6', '#8b5cf6', '#f6f2fe', '#c7b1fb'],
    ['#ff3fb4', '#ff3fb4', '#fff0f9', '#ffa3db'],
    ['#123456', '#256bb1', '#eef3f9', '#96b8da'],
    ['#ffffff', '#cccccc', '#fbfbfb', '#e7e7e7'],
  ])('derives the three Quorb tones for %s', (input, base, light, mid) => {
    expect(derivePalette(input)).toEqual([base, light, mid]);
  });

  it('normalizes shorthand and falls back on invalid input', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('invalid')).toBe('#ff0036');
    expect(derivePalette('invalid')).toEqual(['#ff0036', '#ffebef', '#ff859f']);
  });
});
