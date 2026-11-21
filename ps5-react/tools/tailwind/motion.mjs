// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Animation classes → motion props (docs/ANIMATION.md). Targets stay in logical pixels: the motion
// runtime applies the render scale to x/y itself.
import {UtilityError, translate} from './utilities.mjs';
import {arbitrary, parseNumber} from './values.mjs';

const fail = (message, token) => { throw new UtilityError(message, token); };

// Tailwind's timing functions; the default is ease-in-out over 150 ms.
const EASE = {linear: 'linear', in: [0.4, 0, 1, 1], out: [0, 0, 0.2, 1], 'in-out': [0.4, 0, 0.2, 1]};
const SIDES = {top: ['y', -1], bottom: ['y', 1], left: ['x', -1], right: ['x', 1]};
const IDENTITY = {opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0};
const TRANSFORMS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];
const COVERS = {
  all: key => key in IDENTITY,
  opacity: key => key === 'opacity',
  transform: key => TRANSFORMS.includes(key),
  none: () => false,
};
// Later entries win in `animate`, as in the runtime: whilePress > whileSelect > whileFocus.
const PRIORITY = ['focused', 'selected', 'checked', 'active', 'pressed', 'disabled'];
const INSTANT = {type: 'tween', duration: 0};

const round = value => Number(value.toFixed(4));
const themed = (scale, value, ctx) =>
  value in ctx.theme[scale] ? Number(ctx.theme[scale][value]) : parseNumber(arbitrary(value) ?? '');

function degrees(angle) {
  const match = /^(-?[\d.]+)(deg|rad)?$/.exec(String(angle));
  return match && round(match[2] === 'rad' ? match[1] * 180 / Math.PI : Number(match[1]));
}

function seconds(value, ctx, scale) {
  if (value in ctx.theme[scale]) return ctx.theme[scale][value] / 1000;
  const match = /^([\d.]+)(ms|s)$/.exec(arbitrary(value) ?? '');
  return match && round(match[2] === 'ms' ? match[1] / 1000 : Number(match[1]));
}

function ease(value) {
  if (value in EASE) return EASE[value];
  const match = /^cubic-bezier\(([^)]+)\)$/.exec(arbitrary(value) ?? '');
  const points = match?.[1].split(',').map(parseNumber);
  return points?.length === 4 && !points.includes(null) ? points : null;
}

const FROM = {
  fade: (value, ctx) => ({opacity: value === undefined ? 0 : themed('opacity', value, ctx)}),
  zoom: (value, ctx) => ({scale: value === undefined ? 0 : themed('scale', value, ctx)}),
  spin: (value, ctx) => ({rotate: value === undefined ? 30
    : degrees(ctx.theme.rotate[value] ?? arbitrary(value) ?? '')}),
};

function slide(name, side, value, ctx) {
  if (value === undefined || value === 'full') fail('the engine translates by pixels only, so the ' +
    `Tailwind default of 100% is not available; give a distance such as ${name}-4 or ${name}-[40px]`);
  const [axis, sign] = SIDES[side];
  const px = translate(value, {...ctx, px: ctx.logical});
  return px === null ? null : {[axis]: sign * px};
}

/** One animation utility → a motion fragment, or null when the utility is not an animation class. */
export function resolveMotion(utility, ctx) {
  if (utility === 'animate-in' || utility === 'animate-out') return {[utility.slice(8)]: true};
  let match = /^animate-(spin|pulse|bounce|ping)$/.exec(utility);
  if (match) return {loop: match[1]};
  match = /^(fade|zoom|spin)-(in|out)(?:-(.+))?$/.exec(utility);
  if (match) return state(match[2], FROM[match[1]](match[3], ctx));
  match = /^(slide-(in-from|out-to)-(top|bottom|left|right))(?:-(.+))?$/.exec(utility);
  if (match) return state(match[2] === 'in-from' ? 'in' : 'out', slide(match[1], match[3], match[4], ctx));
  match = /^(duration|delay)-(.+)$/.exec(utility);
  if (match) {
    const value = seconds(match[2], ctx, match[1] === 'delay' ? 'transitionDelay' : 'transitionDuration');
    return value === null ? null : {timing: {[match[1]]: value}};
  }
  match = /^ease-(.+)$/.exec(utility);
  if (match) {
    const curve = ease(match[1]);
    return curve && {timing: {ease: curve}};
  }
  match = /^transition(?:-(.+))?$/.exec(utility);
  if (!match) return null;
  const property = match[1] ?? 'all';
  if (property === 'colors' || property === 'shadow') fail('only opacity and transforms animate; ' +
    'colors and shadows switch instantly (crossfade two layers to blend colors)');
  return property in COVERS ? {property} : null;
}

function state(direction, target) {
  if (target === null || Object.values(target).some(v => v === null || Number.isNaN(v))) return null;
  return {[direction === 'in' ? 'enter' : 'exit']: target};
}

/** Merges a motion fragment into the element's settings, remembering the token for errors. */
export function addMotion(settings, fragment, token) {
  for (const [key, value] of Object.entries(fragment)) {
    settings[key] = typeof value === 'object' ? {...settings[key], ...value} : value;
    settings.tokens[key] = token;
  }
  return settings;
}

/** Moves opacity and transforms out of a style fragment into a motion target. */
export function splitTarget({opacity, $transform: {x, y, rotate, scaleX, scaleY} = {}, ...rest}) {
  const target = Object.fromEntries(Object.entries({opacity, x, y}).filter(([, v]) => v !== undefined));
  if (rotate !== undefined) target.rotate = degrees(rotate);
  if (scaleX !== undefined && scaleX === scaleY) target.scale = scaleX;
  else Object.assign(target, scaleX === undefined ? {} : {scaleX}, scaleY === undefined ? {} : {scaleY});
  return [target, rest];
}

export const byPriority = (a, b) => rank(a.props) - rank(b.props) || a.props.length - b.props.length;
const rank = props => Math.max(...props.map(p => PRIORITY.indexOf(p)));

/** Tailwind's keyframes as from/to targets; reverse playback mirrors the CSS 0%→50%→100% cycle. */
const LOOPS = {
  spin: () => ({from: {rotate: 0}, to: {rotate: 360}, transition: {duration: 1, ease: 'linear'}}),
  pulse: () => ({from: {opacity: 1}, to: {opacity: 0.5},
    transition: {duration: 1, ease: [0.4, 0, 0.6, 1], repeatType: 'reverse'}}),
  // translateY(-25%) of the element: a quarter of its static height, else 8 px.
  bounce: height => ({from: {y: height ? -round(height / 4) : -8}, to: {y: 0},
    transition: {duration: 0.5, ease: [0.8, 0, 1, 1], repeatType: 'reverse'}}),
  // Without the CSS 250 ms hold between pings: the expansion spans the whole 1 s period.
  ping: () => ({from: {scale: 1, opacity: 1}, to: {scale: 2, opacity: 0},
    transition: {duration: 1, ease: [0, 0, 0.2, 1]}}),
};

/**
 * The motion props for an element, or null when nothing animates. `target` holds the static
 * opacity/transforms, `dynamic` the keys that state variants or conditional classes change, and
 * `height` the static height in logical px.
 */
export function motionProps(settings, {target, dynamic, height}) {
  const {enter = {}, exit = {}, timing = {}, tokens} = settings;
  for (const [flag, values, name] of [['in', enter, 'fade-in, zoom-in, spin-in, or slide-in-from-*'],
    ['out', exit, 'fade-out, zoom-out, spin-out, or slide-out-to-*']]) {
    const which = flag === 'in' ? 'enter' : 'exit';
    if (Object.keys(values).length && !settings[flag]) fail(`this sets the ${which} state; ` +
      `add animate-${flag} to play it`, tokens[which]);
    if (settings[flag] && !Object.keys(values).length) fail(`animate-${flag} needs ${name}`, tokens[flag]);
  }
  const loop = settings.loop && LOOPS[settings.loop](height);
  for (const key of Object.keys(loop?.to ?? {})) {
    if (key in enter || dynamic.has(key)) fail(`animate-${settings.loop} already animates ${key}; ` +
      'remove the other class that changes it', tokens.loop);
  }
  const covers = COVERS[settings.property ?? 'none'];
  if (!settings.in && !settings.out && !loop && ![...dynamic].some(covers)) return null;

  const transition = {type: 'tween', duration: timing.duration ?? 0.15, ease: timing.ease ?? EASE['in-out']};
  if (timing.delay) transition.delay = timing.delay;
  for (const key of dynamic) {
    if (!covers(key) && !(key in enter) && !(key in exit)) transition[key] = INSTANT;
  }
  for (const key of Object.keys(loop?.to ?? {}))
    transition[key] = {type: 'tween', ...loop.transition, repeat: Infinity};
  // A key left out of `animate` keeps its last value, so every changing key gets a resting value.
  const identity = Object.fromEntries([...Object.keys(enter), ...dynamic].map(key => [key, IDENTITY[key]]));
  return {
    initial: settings.in || loop ? {...target, ...enter, ...loop?.from} : false,
    animate: {...identity, ...target, ...loop?.to},
    exit: settings.out ? exit : undefined,
    transition,
  };
}
