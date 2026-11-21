// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Motion targets and variant labels: validation and resolution into plain {key: number} layers.

/**
 * @typedef {{opacity?: number, x?: number, y?: number, scale?: number, scaleX?: number,
 *   scaleY?: number, rotate?: number, transition?: import('./transitions.js').Transition}} Target
 *   x/y are logical px; rotate is degrees.
 * @typedef {Target | string | string[]} Definition
 */

export const KEYS = ['opacity', 'x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];

export const IDENTITY = {opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0};

function validate(target, where) {
  for (const [key, value] of Object.entries(target)) {
    if (key === 'transition') {
      if (value && typeof value === 'object') continue;
      throw new Error(`motion: ${where}.transition must be an object`);
    }
    if (!KEYS.includes(key)) {
      const color = /color/i.test(key) ? ' Colors cannot be animated by the engine; crossfade two layers instead.' : '';
      throw new Error(`motion: "${key}" in ${where} is not animatable. Animatable keys: ${KEYS.join(', ')}.${color}`);
    }
    if (!Number.isFinite(value)) {
      throw new Error(`motion: ${where}.${key} must be a finite number, got ${JSON.stringify(value)}`);
    }
  }
  return target;
}

/** @param {Definition | false | undefined} definition @returns {string[]} */
export function labelsOf(definition) {
  if (typeof definition === 'string') return [definition];
  return Array.isArray(definition) ? definition : [];
}

/**
 * Resolves a definition to its targets. Inherited labels a child does not define are skipped, as
 * in Motion; an element's own label must exist in its variants.
 * @param {Definition | false | undefined} definition
 * @param {{[label: string]: Target} | undefined} variants
 * @param {string} where prop name for error messages
 * @param {boolean} [inherited]
 * @returns {Target[]}
 */
export function resolve(definition, variants, where, inherited = false) {
  if (definition == null || definition === false) return [];
  if (typeof definition === 'object' && !Array.isArray(definition)) return [validate(definition, where)];
  const targets = [];
  for (const label of labelsOf(definition)) {
    if (typeof label !== 'string') throw new Error(`motion: ${where} labels must be strings`);
    const target = variants?.[label];
    if (target) targets.push(validate(target, `variants.${label}`));
    else if (!inherited) {
      throw new Error(`motion: ${where}="${label}" is not in variants`
        + ` (${variants ? Object.keys(variants).join(', ') || 'empty' : 'no variants prop'})`);
    }
  }
  return targets;
}

/**
 * Every key the element can animate, so each gets its value once and the style shape stays stable.
 * @param {Array<Definition | false | undefined>} definitions
 * @param {{[label: string]: Target} | undefined} variants
 */
export function collectKeys(definitions, variants) {
  const keys = new Set();
  const add = target => {
    for (const key of Object.keys(target)) if (key !== 'transition') keys.add(key);
  };
  for (const definition of definitions) {
    if (definition && typeof definition === 'object' && !Array.isArray(definition)) add(definition);
  }
  for (const target of Object.values(variants ?? {})) add(target);
  if (keys.has('scale') && (keys.has('scaleX') || keys.has('scaleY'))) {
    throw new Error('motion: animate either scale or scaleX/scaleY on one element, not both');
  }
  return keys;
}

/**
 * Layers from lowest to highest priority; for each key the highest layer naming it wins.
 * @param {Array<{targets: Target[], inherited: boolean}>} layers
 * @param {Iterable<string>} keys
 * @param {{[key: string]: number}} base
 * @returns {{[key: string]: {value: number, transition?: object, inherited: boolean}}}
 */
export function pick(layers, keys, base) {
  const out = {};
  for (const key of keys) {
    out[key] = {value: base[key] ?? IDENTITY[key], inherited: false};
    for (const {targets, inherited} of layers) {
      for (const target of targets) {
        if (key in target) out[key] = {value: target[key], transition: target.transition, inherited};
      }
    }
  }
  return out;
}
