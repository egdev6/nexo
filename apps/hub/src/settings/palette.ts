import type { CSSProperties } from 'react';

// Ported from /home/egdev/proyectos/quorb/src/lib/palette.ts:4-64.
export const DEFAULT_ACCENT = '#ff0036';
export const ACCENT_PRESETS = ['#ff0036', '#ff7a00', '#ffd400', '#22c55e', '#00c2ff', '#3b82f6', '#8b5cf6', '#ff3fb4'];

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const h = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function tint(color: Rgb, t: number): Rgb {
  return color.map(v => v + (255 - v) * t) as Rgb;
}

export function derivePalette(hex: string): [string, string, string] {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_ACCENT)!;
  const [h, s, l] = rgbToHsl(rgb);
  const base = l < 0.42 ? hslToRgb(h, s, 0.42) : l > 0.8 ? hslToRgb(h, s, 0.8) : rgb;
  return [toHex(base), toHex(tint(base, 0.92)), toHex(tint(base, 0.52))];
}

export function normalizeHex(hex: string | null | undefined): string {
  const rgb = hex ? parseHex(hex) : null;
  return rgb ? toHex(rgb) : DEFAULT_ACCENT;
}

// The palette already clamps extreme colors. Choose the better black/white ink
// for its solid tone; CSS mixes towards the opposite color for gradient stops.
export function accentVariables(hex: string): CSSProperties {
  const accent = normalizeHex(hex);
  const [base, light, mid] = derivePalette(accent);
  const channels = parseHex(base)!.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const darkInk = luminance > Math.sqrt(0.0525) - 0.05;
  return {
    '--hub-accent': accent, '--hub-accent-base': base, '--hub-accent-light': light, '--hub-accent-mid': mid,
    '--hub-accent-on': darkInk ? '#000000' : '#ffffff', '--hub-accent-contrast': darkInk ? '#ffffff' : '#000000',
  } as CSSProperties;
}
