// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Value parsing shared by the utilities: lengths, fractions, arbitrary values, and colors.

const NUMBER = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const LENGTH = new RegExp(`^(${NUMBER})(px|rem|%)?$`);

/** `[12px]` → `12px`; underscores stand for spaces, as in Tailwind. */
export function arbitrary(value) {
  return /^\[.+\]$/.test(value) ? value.slice(1, -1).replaceAll('_', ' ') : null;
}

export function parseNumber(value) {
  return new RegExp(`^${NUMBER}$`).test(String(value)) ? Number(value) : null;
}

/**
 * A theme or arbitrary length: a number (px), `Npx`, `Nrem`, or `N%`. Returns `{px}` in logical
 * pixels, `{pct}` as the engine's percentage string, or null.
 */
export function parseLength(value) {
  if (typeof value === 'number') return {px: value};
  const match = LENGTH.exec(String(value).trim());
  if (!match) return null;
  const [, number, unit] = match;
  if (unit === '%') return {pct: `${formatNumber(Number(number))}%`};
  if (unit === 'rem') return {px: Number(number) * 16};
  if (unit === 'px' || Number(number) === 0) return {px: Number(number)};
  return null;
}

/** `1/2` → `50%`, `full` → `100%`. */
export function fraction(value) {
  if (value === 'full') return '100%';
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match || Number(match[2]) === 0) return null;
  return `${formatNumber(Number(match[1]) / Number(match[2]) * 100)}%`;
}

export function formatNumber(value) {
  return String(Number(value.toFixed(6)));
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i;
// The engine's named colors (parse_css_color in native_ui_bridge.c).
const NAMED = new Set(['transparent', 'black', 'white', 'red', 'green', 'blue', 'gray', 'grey',
  'yellow', 'cyan', 'magenta', 'orange']);

export function isColor(value) {
  return HEX.test(value) || RGB.test(value) || NAMED.has(value);
}

/** Looks a color up in a nested palette: `sky-500`, `white`, or a `DEFAULT` entry. */
export function paletteColor(palette, name) {
  if (typeof palette[name] === 'string') return palette[name];
  if (palette[name]?.DEFAULT) return palette[name].DEFAULT;
  const dash = name.lastIndexOf('-');
  if (dash < 0) return null;
  const group = palette[name.slice(0, dash)];
  return typeof group === 'object' ? paletteColor(group, name.slice(dash + 1)) : null;
}

/** Applies an opacity (0–1) by emitting `#rrggbbaa`, which the engine parses natively. */
export function withAlpha(color, alpha) {
  if (alpha === null || alpha === undefined) return color;
  if (color === 'transparent') return color;
  const [r, g, b, a] = rgba(color);
  const hex = n => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a * alpha * 255)}`;
}

function rgba(color) {
  const hex = HEX.exec(color)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map(c => c + c).join('') : hex;
    const channels = full.match(/../g).map(h => parseInt(h, 16));
    return [...channels.slice(0, 3), channels.length === 4 ? channels[3] / 255 : 1];
  }
  const match = RGB.exec(color);
  if (match) {
    const alpha = match[4] === undefined ? 1
      : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : Number(match[4]);
    return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
  }
  throw new Error(`cannot apply an opacity modifier to "${color}"`);
}
