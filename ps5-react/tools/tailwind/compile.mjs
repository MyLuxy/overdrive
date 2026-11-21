// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Class string → engine style objects, at build time. Utilities are logical pixels scaled by
// render.width / baseWidth, so every value lands in the bundle as a literal.
import {basename, resolve} from 'node:path';
import {addMotion, resolveMotion} from './motion.mjs';
import {resolveTheme} from './theme.mjs';
import {UtilityError, resolveUtility} from './utilities.mjs';
import {parseLength, withAlpha} from './values.mjs';

export const VARIANTS = ['focused', 'selected', 'disabled', 'active', 'checked', 'pressed'];

// Controller focus is the console's hover: these web variants read the same `focused` prop.
const ALIASES = {hover: 'focused', focus: 'focused', 'focus-visible': 'focused'};

const REJECTED_VARIANTS = {
  'focus-within': 'use focused: on the focusable element itself, or with a focused={...} prop',
  dark: 'there is no color-scheme query; choose colors from app state',
  first: 'structural variants need selectors; compute the class from the index in JavaScript',
  last: 'structural variants need selectors; compute the class from the index in JavaScript',
  odd: 'structural variants need selectors; compute the class from the index in JavaScript',
  even: 'structural variants need selectors; compute the class from the index in JavaScript',
};
const RESPONSIVE = ['sm', 'md', 'lg', 'xl', '2xl', 'portrait', 'landscape', 'print', 'motion-safe',
  'motion-reduce', 'max-sm', 'max-md', 'max-lg', 'max-xl', 'max-2xl'];

export class ClassError extends Error {
  constructor(token, message) {
    super(`${token}: ${message}`);
    this.token = token;
  }
}

/** Splits `a:b:[c:d]` on colons that are outside brackets. */
function splitVariants(token) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === '[') depth++;
    else if (token[i] === ']') depth--;
    else if (token[i] === ':' && depth === 0) {
      parts.push(token.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, token.slice(start)];
}

function merge(target, fragment) {
  for (const [key, value] of Object.entries(fragment)) {
    target[key] = key === '$transform' || key === '$gradient' ? {...target[key], ...value} : value;
  }
  return target;
}

export function createCompiler({config = {}, renderWidth, renderHeight, appDir}) {
  const theme = resolveTheme(config);
  const scale = renderWidth / (config.baseWidth ?? 1280);
  let imports;
  const logical = value => {
    const parsed = parseLength(value);
    if (parsed?.px === undefined) throw new UtilityError(`theme value "${value}" is not a px/rem length`);
    return parsed.px;
  };
  const ctx = {
    theme, scale, renderWidth, renderHeight, logical,
    px: value => Math.round(logical(value) * scale),
    font(family) {
      if (!/\.(ttf|otf)$/i.test(family)) return {fontFamily: family};
      const path = resolve(appDir, family);
      imports.add(path);
      return {fontFamily: basename(path).replace(/\.[^.]+$/, '')};
    },
  };

  /**
   * Parses a class string into a base fragment and variant fragments, still unresolved, so
   * conditional parts can be finalized against the static ones. Animation classes collect into
   * `motion` (see motion.mjs) instead of the style.
   */
  function parse(classes) {
    imports = new Set();
    const base = {};
    const variants = new Map();
    let motion = null;
    for (const token of classes.split(/\s+/).filter(Boolean)) {
      const parts = splitVariants(token).map(part => ALIASES[part] ?? part);
      const utility = parts.pop();
      for (const variant of parts) {
        if (variant in REJECTED_VARIANTS) throw new ClassError(token, REJECTED_VARIANTS[variant]);
        if (RESPONSIVE.includes(variant)) throw new ClassError(token,
          'the render size is fixed per app; responsive and media variants are not supported');
        if (!VARIANTS.includes(variant)) throw new ClassError(token,
          `unknown variant "${variant}:"; supported: ${VARIANTS.map(v => v + ':').join(' ')}`);
      }
      if (utility.startsWith('!')) throw new ClassError(token, 'the ! modifier is not supported; ' +
        'later classes and the style prop already take precedence');
      let fragment;
      try {
        const animation = resolveMotion(utility, ctx);
        if (animation && parts.length) throw new ClassError(token, 'animation classes take no ' +
          'variants; a variant\'s opacity and transforms animate when the element has transition');
        if (animation) {
          motion = addMotion(motion ?? {tokens: {}}, animation, token);
          continue;
        }
        fragment = resolveUtility(utility, ctx);
      } catch (error) {
        if (error instanceof UtilityError) throw new ClassError(token, error.message);
        throw error;
      }
      if (!parts.length) {
        merge(base, fragment);
        continue;
      }
      const key = [...new Set(parts)].sort().join(':');
      if (!variants.has(key)) variants.set(key, {props: key.split(':'), fragment: {}});
      merge(variants.get(key).fragment, fragment);
    }
    return {base, variants: [...variants.values()], imports: [...imports], motion};
  }

  /**
   * Tailwind v3.3 stops: `from` (0%), optional `via` (50%), `to` (100%); without `to-*` the
   * gradient fades to a transparent `from`.
   */
  function gradient({direction, from, via, to, fromPosition = 0, viaPosition = 0.5, toPosition = 1}) {
    if (!direction) throw new ClassError('from', 'from-*, via-*, and to-* need a bg-gradient-to-* direction');
    if (from === undefined) throw new ClassError('bg-gradient-to', 'a gradient needs a from-* color');
    const stops = [{color: from, offset: fromPosition}];
    if (via !== undefined) stops.push({color: via, offset: viaPosition});
    stops.push({color: to ?? withAlpha(from, 0), offset: toPosition});
    return {type: 'linear', to: direction, stops};
  }

  /**
   * Turns a fragment into an engine style. `context` (the static base) supplies the font size for
   * relative leading/tracking and the transform parts a variant composes with. As in Tailwind's
   * CSS order, leading-* beats the line height bundled with text-*, so a fragment that changes
   * the font size re-resolves the context's leading/tracking against it.
   */
  function finalize(fragment, context = {}) {
    const {$transform, $gradient, $leading, $textLeading, $tracking, ...style} = fragment;
    const fontSize = style.fontSize ?? context.fontSize;
    const inherited = style.fontSize === undefined ? {} : context;
    for (const [key, value, name] of [['lineHeight', $leading ?? inherited.$leading ?? $textLeading, 'leading'],
      ['letterSpacing', $tracking ?? inherited.$tracking, 'tracking']]) {
      if (value === undefined) continue;
      if (value.em === undefined) {
        style[key] = value.px;
        continue;
      }
      if (fontSize === undefined) throw new ClassError(name, 'a relative value needs a text-* size ' +
        'on the same element; use a fixed one such as leading-6 or tracking-[2px]');
      style[key] = key === 'lineHeight' ? Math.round(value.em * fontSize)
        : Number((value.em * fontSize).toFixed(2));
    }
    if ($transform) {
      const t = {...(fragment === context ? {} : context.$transform), ...$transform};
      style.transform = [
        ...['translateX', 'translateY', 'rotate'].filter(k => k in t).map(k => ({[k]: t[k]})),
        ...(t.scaleX !== undefined && t.scaleX === t.scaleY ? [{scale: t.scaleX}]
          : ['scaleX', 'scaleY'].filter(k => k in t).map(k => ({[k]: t[k]}))),
      ];
    }
    if ($gradient) style.backgroundGradient = gradient({...(fragment === context ? {} : context.$gradient), ...$gradient});
    return style;
  }

  return {parse, finalize, scale};
}
