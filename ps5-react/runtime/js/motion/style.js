// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Merges engine-bound values into an element's style; animated keys replace their static ones.

const TRANSFORM = {x: 'translateX', y: 'translateY', scale: 'scale', scaleX: 'scaleX', scaleY: 'scaleY', rotate: 'rotate'};

// Static entries that an animated key overrides; `scale` sets both axes.
const CONFLICTS = {
  translateX: ['x'], translateY: ['y'], rotate: ['rotate'],
  scale: ['scale', 'scaleX', 'scaleY'], scaleX: ['scale', 'scaleX'], scaleY: ['scale', 'scaleY'],
};

// Props that place a Text/Image in its parent, so they move to the fading wrapper View.
const OUTER = ['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'position', 'top', 'left',
  'right', 'bottom', 'zIndex', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd'];

/** @returns {{[key: string]: unknown}} */
export function flatten(style, out = {}) {
  if (Array.isArray(style)) for (const part of style) flatten(part, out);
  else if (style) Object.assign(out, style);
  return out;
}

function degrees(value) {
  if (typeof value === 'number') return value;
  const match = /^(-?[\d.]+)(deg|rad)$/.exec(String(value));
  if (!match) return undefined;
  return match[2] === 'rad' ? Number(match[1]) * 180 / Math.PI : Number(match[1]);
}

/**
 * Resting values the style already sets, in motion units (logical px, degrees).
 * @param {{[key: string]: unknown}} flat
 * @param {number} scale physical px per logical px
 */
export function baseFromStyle(flat, scale) {
  const base = {};
  if (typeof flat.opacity === 'number') base.opacity = flat.opacity;
  for (const entry of Array.isArray(flat.transform) ? flat.transform : []) {
    const [name, value] = Object.entries(entry)[0] ?? [];
    if (name === 'translateX' && typeof value === 'number') base.x = value / scale;
    else if (name === 'translateY' && typeof value === 'number') base.y = value / scale;
    else if (name === 'rotate' && degrees(value) !== undefined) base.rotate = degrees(value);
    else if (['scale', 'scaleX', 'scaleY'].includes(name) && typeof value === 'number') base[name] = value;
  }
  return base;
}

/**
 * Splits into the element's style and, when `wrapOpacity`, a wrapper style carrying opacity and
 * the outer layout props (Text and Image cannot fade themselves).
 * @param {{[key: string]: unknown}} flat
 * @param {Map<string, object>} values animated value per motion key
 * @param {boolean} wrapOpacity
 */
export function bindStyle(flat, values, wrapOpacity) {
  const style = {...flat};
  const transform = (Array.isArray(flat.transform) ? flat.transform : []).filter(entry => {
    const name = Object.keys(entry)[0];
    return !(CONFLICTS[name] ?? []).some(key => values.has(key));
  });
  for (const [key, value] of values) if (key !== 'opacity') transform.push({[TRANSFORM[key]]: value});
  if (transform.length) style.transform = transform;
  else delete style.transform;
  if (!values.has('opacity')) return {style};
  if (!wrapOpacity) return {style: {...style, opacity: values.get('opacity')}};
  delete style.opacity;
  const outer = {opacity: values.get('opacity')};
  for (const key of OUTER) {
    if (key in style) {
      outer[key] = style[key];
      delete style[key];
    }
  }
  return {style, outer};
}
