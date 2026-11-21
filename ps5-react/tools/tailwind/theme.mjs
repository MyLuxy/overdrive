// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Scale values follow the Tailwind CSS v3.4 default theme (MIT, Tailwind Labs, Inc.;
// see licenses/tailwindcss-LICENSE), expressed in logical pixels with 1rem = 16px.
import colors from './colors.mjs';

const spacing = {
  0: 0, px: 1, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12, 3.5: 14, 4: 16, 5: 20, 6: 24,
  7: 28, 8: 32, 9: 36, 10: 40, 11: 44, 12: 48, 14: 56, 16: 64, 20: 80, 24: 96, 28: 112,
  32: 128, 36: 144, 40: 160, 44: 176, 48: 192, 52: 208, 56: 224, 60: 240, 64: 256,
  72: 288, 80: 320, 96: 384,
};

const timings = {0: 0, 75: 75, 100: 100, 150: 150, 200: 200, 300: 300, 500: 500, 700: 700, 1000: 1000};

export const defaultTheme = {
  colors,
  spacing,
  // [fontSize, lineHeight]; a lineHeight below 4 is a multiple of the font size.
  fontSize: {
    xs: [12, 16], sm: [14, 20], base: [16, 24], lg: [18, 28], xl: [20, 28], '2xl': [24, 32],
    '3xl': [30, 36], '4xl': [36, 40], '5xl': [48, 1], '6xl': [60, 1], '7xl': [72, 1],
    '8xl': [96, 1], '9xl': [128, 1],
  },
  fontFamily: {},
  fontWeight: {
    thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600,
    bold: 700, extrabold: 800, black: 900,
  },
  lineHeight: {
    3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 9: 36, 10: 40,
    none: 1, tight: 1.25, snug: 1.375, normal: 1.5, relaxed: 1.625, loose: 2,
  },
  // Multiples of the font size (em).
  letterSpacing: {tighter: -0.05, tight: -0.025, normal: 0, wide: 0.025, wider: 0.05, widest: 0.1},
  borderRadius: {none: 0, sm: 2, DEFAULT: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, full: 9999},
  borderWidth: {DEFAULT: 1, 0: 0, 2: 2, 4: 4, 8: 8},
  opacity: Object.fromEntries(Array.from({length: 21}, (_, i) => [i * 5, i / 20])),
  gradientColorStopPositions: Object.fromEntries(Array.from({length: 21}, (_, i) => [`${i * 5}%`, `${i * 5}%`])),
  zIndex: {0: 0, 10: 10, 20: 20, 30: 30, 40: 40, 50: 50},
  scale: {0: 0, 50: 0.5, 75: 0.75, 90: 0.9, 95: 0.95, 100: 1, 105: 1.05, 110: 1.1, 125: 1.25, 150: 1.5},
  rotate: {0: 0, 1: 1, 2: 2, 3: 3, 6: 6, 12: 12, 45: 45, 90: 90, 180: 180},
  aspectRatio: {square: 1, video: 16 / 9},
  maxWidth: {
    none: undefined, xs: 320, sm: 384, md: 448, lg: 512, xl: 576, '2xl': 672, '3xl': 768,
    '4xl': 896, '5xl': 1024, '6xl': 1152, '7xl': 1280,
  },
  lineClamp: {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6},
  // Milliseconds.
  transitionDuration: timings,
  transitionDelay: timings,
};

const SCALES = Object.keys(defaultTheme);

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function deepMerge(base, extension = {}) {
  const result = {...base};
  for (const [key, value] of Object.entries(extension))
    result[key] = isObject(result[key]) && isObject(value) ? deepMerge(result[key], value) : value;
  return result;
}

/** Merges `theme` (replaces a scale) and `theme.extend` (deep-merged into it), as Tailwind does. */
export function resolveTheme(config = {}) {
  const {extend = {}, ...overrides} = config.theme ?? {};
  for (const key of [...Object.keys(overrides), ...Object.keys(extend)]) {
    if (!SCALES.includes(key))
      throw new Error(`tailwind.config: unsupported theme key "${key}". Supported: ${SCALES.join(', ')}`);
  }
  return Object.fromEntries(SCALES.map(key => [key, deepMerge(overrides[key] ?? defaultTheme[key], extend[key])]));
}
