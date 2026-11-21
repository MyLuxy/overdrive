// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Motion transitions → engine animation configs. The engine only runs fixed easing tokens and
// cubic beziers, so Motion's named curves map onto those.

/**
 * @typedef {'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'circIn' | 'circOut' | 'circInOut'
 *   | 'backIn' | 'backOut' | 'backInOut' | 'anticipate' | [number, number, number, number]} Ease
 * @typedef {{type?: 'spring' | 'tween', duration?: number, delay?: number, ease?: Ease,
 *   stiffness?: number, damping?: number, mass?: number, velocity?: number,
 *   repeat?: number, repeatType?: 'loop' | 'reverse' | 'mirror',
 *   staggerChildren?: number, delayChildren?: number, staggerDirection?: 1 | -1}} Transition
 *   Times are seconds.
 */

const bezier = (x1, y1, x2, y2) => ({x1, y1, x2, y2});

const EASES = {
  linear: 'linear',
  easeIn: 'easeIn',
  easeOut: 'easeOut',
  easeInOut: 'easeInOut',
  circIn: bezier(0.55, 0, 1, 0.45),
  circOut: bezier(0, 0.55, 0.45, 1),
  circInOut: bezier(0.85, 0, 0.15, 1),
  backIn: bezier(0.36, 0, 0.66, -0.56),
  backOut: bezier(0.34, 1.56, 0.64, 1),
  backInOut: bezier(0.68, -0.6, 0.32, 1.6),
  // Motion's anticipate pulls back then settles without overshoot; one bezier approximates it.
  anticipate: bezier(0.68, -0.4, 0.32, 1),
};

const SPRING_KEYS = ['stiffness', 'damping', 'mass', 'velocity'];

// Spring stiffness from natural frequency ω (rad/s) and damping from ratio ζ, for mass 1.
const spring = (omega, zeta) => Object.freeze({type: 'spring', stiffness: omega * omega,
  damping: Math.round(2 * zeta * omega * 10) / 10, mass: 1});

/** Presets from the console motion tokens: exits are shorter than entrances. */
export const transitions = Object.freeze({
  focus: spring(20, 0.85),
  panel: spring(13, 0.85),
  screen: Object.freeze({type: 'tween', duration: 0.45, ease: Object.freeze([0.22, 1, 0.36, 1])}),
  exit: Object.freeze({type: 'tween', duration: 0.2, ease: 'easeIn'}),
  pop: spring(20, 0.5),
});

function easing(ease) {
  if (Array.isArray(ease) && ease.length === 4 && ease.every(Number.isFinite)) return bezier(...ease);
  if (typeof ease === 'string' && Object.prototype.hasOwnProperty.call(EASES, ease)) return EASES[ease];
  throw new Error(`motion: unknown ease ${JSON.stringify(ease)}; use one of ${Object.keys(EASES).join(', ')} `
    + 'or a [x1, y1, x2, y2] cubic bezier (JavaScript easing functions cannot run in the engine)');
}

function seconds(transition, key, fallback) {
  const value = transition[key] ?? fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`motion: transition.${key} must be a non-negative number of seconds, got ${value}`);
  }
  return value;
}

/** Transition type: explicit, else tween for opacity or when a duration/ease is given. */
function typeOf(transition, key) {
  const {type} = transition;
  if (type === 'spring' || type === 'tween') return type;
  if (type !== undefined) throw new Error(`motion: transition.type must be 'spring' or 'tween', got '${type}'`);
  if (key === 'opacity' || transition.duration !== undefined || transition.ease !== undefined) return 'tween';
  return 'spring';
}

/**
 * The transition for one key: the base transition with its per-key override merged on top.
 * @param {Transition & {[key: string]: unknown} | undefined} transition
 * @param {string} key
 * @returns {Transition}
 */
export function transitionFor(transition, key) {
  if (!transition) return {};
  const own = transition[key];
  return own && typeof own === 'object' ? {...transition, ...own} : transition;
}

/**
 * Engine config for animating one value; `scale` converts logical velocity to physical units.
 * @param {Transition} transition
 * @param {string} key
 * @param {number} extraDelay seconds added by parent orchestration
 * @param {number} scale
 */
export function engineConfig(transition, key, extraDelay = 0, scale = 1) {
  const delay = Math.round((seconds(transition, 'delay', 0) + extraDelay) * 1000);
  if (typeOf(transition, key) === 'tween') {
    return {type: 'timing', duration: Math.round(seconds(transition, 'duration', 0.3) * 1000),
      easing: easing(transition.ease ?? 'easeOut'), delay};
  }
  const config = {type: 'spring', stiffness: 300, damping: 30, mass: 1, velocity: 0, delay};
  for (const name of SPRING_KEYS) {
    if (transition[name] === undefined) continue;
    if (!Number.isFinite(transition[name])) {
      throw new Error(`motion: transition.${name} must be a finite number, got ${transition[name]}`);
    }
    config[name] = transition[name];
  }
  if (key === 'x' || key === 'y') config.velocity *= scale;
  return config;
}

/**
 * Iteration plan for repeat: `count` runs, alternating direction when reversing.
 * @param {Transition} transition
 * @returns {{count: number, reverse: boolean}}
 */
export function repeatOf(transition) {
  const repeat = transition.repeat ?? 0;
  if (!(repeat === Infinity || (Number.isInteger(repeat) && repeat >= 0))) {
    throw new Error(`motion: transition.repeat must be a non-negative integer or Infinity, got ${repeat}`);
  }
  const type = transition.repeatType ?? 'loop';
  if (!['loop', 'reverse', 'mirror'].includes(type)) {
    throw new Error(`motion: transition.repeatType must be 'loop', 'reverse' or 'mirror', got '${type}'`);
  }
  return {count: repeat + 1, reverse: type !== 'loop'};
}

/**
 * Delay for a child animating to an inherited variant label.
 * @param {Transition | undefined} transition the parent's transition
 * @param {number} index
 * @param {number} count
 */
export function childDelay(transition, index, count) {
  if (!transition) return 0;
  const stagger = transition.staggerChildren ?? 0;
  const order = transition.staggerDirection === -1 ? count - 1 - index : index;
  return (transition.delayChildren ?? 0) + stagger * order;
}
