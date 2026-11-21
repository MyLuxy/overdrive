// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ClassError, createCompiler} from './compile.mjs';
import {motionProps, splitTarget} from './motion.mjs';

// 1920 wide: render scale 1.5, which motion targets must not apply.
const compiler = createCompiler({renderWidth: 1920, renderHeight: 1080, appDir: '/app'});

function props(classes, dynamic = []) {
  const {base, motion} = compiler.parse(classes);
  const [target] = splitTarget(base);
  return motionProps(motion, {target, dynamic: new Set(dynamic), height: base.height / 1.5});
}

const tween = {type: 'tween', duration: 0.15, ease: [0.4, 0, 0.2, 1]};

test('enter classes become initial and an identity animate', () => {
  assert.deepEqual(props('animate-in fade-in zoom-in-95 spin-in slide-in-from-bottom-4'), {
    initial: {opacity: 0, scale: 0.95, rotate: 30, y: 16},
    animate: {opacity: 1, scale: 1, rotate: 0, y: 0}, exit: undefined, transition: tween,
  });
  assert.deepEqual(props('animate-in fade-in-50 slide-in-from-left-[40px] slide-in-from-top-[1rem]').initial,
    {opacity: 0.5, x: -40, y: -16});
  assert.deepEqual(props('animate-in spin-in-[1rad] zoom-in-[.5]').initial, {rotate: 57.2958, scale: 0.5});
});

test('exit classes and timing', () => {
  const {initial, exit, transition} = props('animate-out fade-out zoom-out-90 slide-out-to-right-2 ' +
    'duration-300 delay-[250ms] ease-in');
  assert.equal(initial, false);
  assert.deepEqual(exit, {opacity: 0, scale: 0.9, x: 8});
  assert.deepEqual(transition, {type: 'tween', duration: 0.3, ease: [0.4, 0, 1, 1], delay: 0.25});
  assert.deepEqual(props('animate-in fade-in ease-linear duration-[2s]').transition,
    {type: 'tween', duration: 2, ease: 'linear'});
  assert.deepEqual(props('animate-in fade-in ease-[cubic-bezier(0.1,0.2,0.3,1)]').transition.ease, [0.1, 0.2, 0.3, 1]);
});

test('static opacity and transforms join the target in logical px', () => {
  assert.deepEqual(props('animate-in fade-in opacity-90 translate-x-2 -rotate-45 scale-x-50'), {
    initial: {opacity: 0, x: 8, rotate: -45, scaleX: 0.5},
    animate: {opacity: 0.9, x: 8, rotate: -45, scaleX: 0.5}, exit: undefined, transition: tween,
  });
});

test('loops mirror the Tailwind keyframes', () => {
  const loop = classes => {
    const {initial, animate, transition: {type, duration, ease, ...keys}} = props(classes);
    return {initial, animate, keys};
  };
  assert.deepEqual(loop('animate-spin'), {initial: {rotate: 0}, animate: {rotate: 360},
    keys: {rotate: {type: 'tween', duration: 1, ease: 'linear', repeat: Infinity}}});
  assert.deepEqual(loop('animate-pulse').keys.opacity,
    {type: 'tween', duration: 1, ease: [0.4, 0, 0.6, 1], repeatType: 'reverse', repeat: Infinity});
  assert.deepEqual(loop('animate-bounce h-6').initial, {y: -6});
  assert.deepEqual(loop('animate-bounce').initial, {y: -8});
  assert.deepEqual(loop('animate-ping').animate, {scale: 2, opacity: 0});
});

test('transition properties decide which changing keys animate', () => {
  assert.equal(props('transition bg-black'), null);
  assert.equal(props('transition-opacity', ['scale']), null);
  assert.deepEqual(props('transition-all duration-200', ['scale']),
    {initial: false, animate: {scale: 1}, exit: undefined, transition: {...tween, duration: 0.2}});
  assert.deepEqual(props('transition-transform', ['scale', 'opacity']).transition,
    {...tween, opacity: {type: 'tween', duration: 0}});
  assert.deepEqual(props('animate-in zoom-in', ['scale', 'x']).transition,
    {...tween, x: {type: 'tween', duration: 0}});
});

test('invalid animation classes fail with guidance', () => {
  for (const [classes, message] of [
    ['fade-in', /add animate-in/], ['zoom-out', /add animate-out/], ['animate-in', /needs fade-in/],
    ['animate-out', /needs fade-out/], ['animate-spin spin-in animate-in', /already animates rotate/],
  ]) assert.throws(() => props(classes), message, classes);
  assert.throws(() => props('animate-pulse', ['opacity']), /already animates opacity/);
  for (const [classes, message] of [
    ['animate-in slide-in-from-top', /slide-in-from-top-4/], ['slide-out-to-left-1/2', /pixels only/],
    ['slide-in-from-top-full', /100%/], ['transition-colors', /crossfade/], ['animate-wiggle', /ANIMATION\.md/],
    ['focused:animate-spin', /take no variants/], ['duration-[fast]', /ANIMATION\.md/],
  ]) assert.throws(() => compiler.parse(classes), error => error instanceof ClassError &&
    message.test(error.message), classes);
});
