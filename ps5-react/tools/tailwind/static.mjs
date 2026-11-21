// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Fixed-value utilities and the Tailwind families the engine cannot honor, with the reason.

const map = (prefix, key, values) => Object.fromEntries(
  Object.entries(values).map(([name, value]) => [`${prefix}-${name}`, {[key]: value}]));

const align = {start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch'};

export const STATIC = {
  flex: {display: 'flex'},
  hidden: {display: 'none'},
  relative: {position: 'relative'},
  absolute: {position: 'absolute'},
  ...map('overflow', 'overflow', {hidden: 'hidden', visible: 'visible', scroll: 'scroll'}),
  ...map('flex', 'flexDirection', {row: 'row', 'row-reverse': 'row-reverse', col: 'column',
    'col-reverse': 'column-reverse'}),
  ...map('flex', 'flexWrap', {wrap: 'wrap', 'wrap-reverse': 'wrap-reverse', nowrap: 'nowrap'}),
  'flex-auto': {flexGrow: 1, flexShrink: 1},
  'flex-initial': {flexGrow: 0, flexShrink: 1},
  'flex-none': {flexGrow: 0, flexShrink: 0},
  ...map('justify', 'justifyContent', {start: 'flex-start', end: 'flex-end', center: 'center',
    between: 'space-between', around: 'space-around', evenly: 'space-evenly'}),
  ...map('items', 'alignItems', align),
  ...map('self', 'alignSelf', {auto: 'auto', ...align}),
  ...map('content', 'alignContent', {...align, between: 'space-between', around: 'space-around'}),
  ...map('pointer-events', 'pointerEvents', {none: 'none', auto: 'auto', 'box-none': 'box-none',
    'box-only': 'box-only'}),
  ...map('text', 'textAlign', {left: 'left', center: 'center', right: 'right', start: 'start', end: 'end'}),
  italic: {fontStyle: 'italic'},
  'not-italic': {fontStyle: 'normal'},
  underline: {textDecorationLine: 'underline'},
  'line-through': {textDecorationLine: 'line-through'},
  'no-underline': {textDecorationLine: 'none'},
  truncate: {numberOfLines: 1, ellipsizeMode: 'tail'},
  'text-ellipsis': {ellipsizeMode: 'tail'},
  'text-clip': {ellipsizeMode: 'clip'},
  'line-clamp-none': {numberOfLines: 0},
  ...map('border', 'borderStyle', {solid: 'solid', dashed: 'dashed', dotted: 'dotted'}),
  ...map('object', 'resizeMode', {contain: 'contain', cover: 'cover', fill: 'stretch', none: 'center'}),
  ...map('origin', 'transformOrigin', {
    center: [0.5, 0.5], top: [0.5, 0], 'top-right': [1, 0], right: [1, 0.5],
    'bottom-right': [1, 1], bottom: [0.5, 1], 'bottom-left': [0, 1], left: [0, 0.5], 'top-left': [0, 0],
  }),
  'transform-none': {transform: []},
};

const reject = (prefixes, reason) => prefixes.map(prefix => [prefix, reason]);

export const REJECTED = [
  ...reject(['shadow', 'drop-shadow'], 'shadows are disabled in this engine profile (ERUI_SHADOWS=OFF)'),
  ...reject(['space-x', 'space-y'], 'child selectors are not available; use gap-x-*/gap-y-* on the parent'),
  ...reject(['divide'], 'child selectors are not available; put borders on the children'),
  ...reject(['grid', 'grid-cols', 'grid-rows', 'col', 'row', 'col-span', 'row-span', 'place'],
    'the layout engine is flexbox only; use flex-row flex-wrap with gap-*'),
  ...reject(['block', 'inline', 'inline-block', 'inline-flex', 'table', 'contents', 'flow-root'],
    'only flex (default) and hidden are supported'),
  ...reject(['fixed', 'sticky', 'static'], 'only relative and absolute positioning are supported'),
  ...reject(['uppercase', 'lowercase', 'capitalize', 'normal-case'],
    'text-transform is not supported; transform the string in JavaScript'),
  ...reject(['ring', 'outline'], 'use border-* utilities instead'),
  ...reject(['transition', 'duration', 'ease', 'delay', 'animate'],
    'unsupported animation class; see docs/ANIMATION.md for the supported set'),
  ...reject(['bg-gradient'], 'only linear bg-gradient-to-{t,tr,r,br,b,bl,l,tl} gradients are supported'),
  ...reject(['bg-none'], 'remove the bg-gradient-to-* class instead'),
  ...reject(['blur', 'brightness', 'contrast', 'grayscale', 'hue-rotate', 'invert', 'saturate',
    'sepia', 'backdrop', 'filter', 'bg-blend'], 'filters and blending are not supported'),
  ...reject(['mix-blend'], "use style={{mixBlendMode: 'plus-lighter'}}; no other blend mode is supported"),
  ...reject(['bg-opacity', 'text-opacity', 'border-opacity'], 'use a color opacity modifier such as bg-black/50'),
  ...reject(['skew'], 'the engine has no skew transform'),
  ...reject(['invisible', 'visible', 'collapse'], 'use opacity-0 or hidden'),
  ...reject(['overflow-auto', 'overflow-clip', 'overflow-x', 'overflow-y'],
    'only overflow-hidden, overflow-visible, and overflow-scroll are supported'),
  ...reject(['items-baseline', 'self-baseline', 'content-evenly', 'justify-normal', 'justify-stretch'],
    'this alignment value is not supported by the layout engine'),
  ...reject(['order', 'float', 'clear', 'isolate', 'container', 'sr-only', 'not-sr-only', 'columns', 'box'],
    'not supported by the layout engine'),
  ...reject(['cursor', 'select', 'resize', 'appearance', 'scroll', 'snap', 'touch', 'will-change',
    'accent', 'list', 'whitespace', 'break', 'hyphens', 'indent', 'align', 'decoration',
    'underline-offset', 'text-wrap', 'antialiased', 'subpixel-antialiased', 'tabular-nums', 'ordinal',
    'object-scale-down', 'object-left', 'object-right', 'object-top', 'object-bottom', 'bg-fixed',
    'bg-cover', 'bg-contain', 'bg-center', 'bg-no-repeat', 'bg-repeat', 'bg-clip', 'bg-origin'],
  'browser-only CSS; not supported by the PS5 renderer'),
  ...reject(['w-auto', 'h-auto', 'size-auto', 'basis-auto', 'z-auto', 'max-w-none', 'aspect-auto',
    'inset-auto', 'top-auto', 'right-auto', 'bottom-auto', 'left-auto'],
  'auto is already the default; remove the class'),
  ...reject(['w-min', 'w-max', 'w-fit', 'h-min', 'h-max', 'h-fit', 'w-dvw', 'w-svw', 'w-lvw', 'h-dvh',
    'h-svh', 'h-lvh', 'min-w-full', 'min-h-full', 'max-w-full', 'max-h-full', 'max-w-prose',
    'max-w-min', 'max-w-max', 'max-w-fit', 'max-w-screen'],
  'intrinsic, viewport-unit, and percentage min/max sizes are not supported; use a fixed size'),
];
