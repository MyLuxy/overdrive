// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nextPresence} from './presence-list.js';
import {bindStyle, baseFromStyle} from './style.js';
import {collectKeys, pick, resolve} from './targets.js';
import {childDelay, engineConfig, repeatOf, transitionFor, transitions} from './transitions.js';
import {MotionValues} from './values.js';

/** Engine stand-in: animations run until settle() completes them. */
function fakeEngine() {
  const running = new Set();
  const engine = {
    created: 0,
    destroyed: 0,
    running,
    create(initial) {
      engine.created++;
      return {current: initial};
    },
    animate(value, to, config, done) {
      const animation = {value, to, config, done};
      running.add(animation);
      return () => {
        if (running.delete(animation)) done(false);
      };
    },
    set(value, to) { value.current = to; },
    get: value => value.current,
    destroy() { engine.destroyed++; },
    settle() {
      for (const animation of [...running]) {
        running.delete(animation);
        animation.value.current = animation.to;
        animation.done(true);
      }
    },
  };
  return engine;
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('transition presets follow the motion tokens', () => {
  assert.deepEqual(transitions.focus, {type: 'spring', stiffness: 400, damping: 34, mass: 1});
  assert.equal(transitions.panel.stiffness, 169);
  assert.ok(transitions.panel.damping / (2 * Math.sqrt(169)) >= 0.8);
  assert.ok(transitions.pop.damping / (2 * Math.sqrt(transitions.pop.stiffness)) === 0.5);
  assert.deepEqual(engineConfig(transitions.screen, 'y').easing, {x1: 0.22, y1: 1, x2: 0.36, y2: 1});
  assert.ok(transitions.exit.duration < transitions.screen.duration);
});

test('engine configs default by key and convert seconds', () => {
  assert.deepEqual(engineConfig({}, 'opacity'), {type: 'timing', duration: 300, easing: 'easeOut', delay: 0});
  assert.deepEqual(engineConfig({}, 'x'),
    {type: 'spring', stiffness: 300, damping: 30, mass: 1, velocity: 0, delay: 0});
  assert.equal(engineConfig({duration: 0.5}, 'x').type, 'timing');
  assert.deepEqual(engineConfig({ease: 'circOut', delay: 0.1}, 'scale'),
    {type: 'timing', duration: 300, easing: {x1: 0, y1: 0.55, x2: 0.45, y2: 1}, delay: 100});
  assert.equal(engineConfig({type: 'spring', velocity: 10}, 'y', 0.05, 2).velocity, 20);
  assert.equal(engineConfig({}, 'x', 0.25).delay, 250);
  assert.throws(() => engineConfig({ease: 'bogus'}), /unknown ease "bogus"/);
  assert.throws(() => engineConfig({ease: t => t}), /cannot run in the engine/);
  assert.throws(() => engineConfig({type: 'inertia'}), /'spring' or 'tween'/);
  assert.deepEqual(transitionFor({duration: 1, x: {delay: 2}}, 'x').delay, 2);
  assert.equal(transitionFor({duration: 1, x: {delay: 2}}, 'x').duration, 1);
});

test('repeat and stagger plans', () => {
  assert.deepEqual(repeatOf({}), {count: 1, reverse: false});
  assert.deepEqual(repeatOf({repeat: Infinity, repeatType: 'reverse'}), {count: Infinity, reverse: true});
  assert.throws(() => repeatOf({repeat: -1}), /non-negative integer or Infinity/);
  assert.equal(childDelay({staggerChildren: 0.1, delayChildren: 0.2}, 2, 4), 0.2 + 0.1 * 2);
  assert.equal(childDelay({staggerChildren: 0.1, staggerDirection: -1}, 0, 4), 0.1 * 3);
});

test('targets reject non-animatable keys with actionable errors', () => {
  assert.throws(() => resolve({backgroundColor: '#fff'}, undefined, 'animate'),
    /"backgroundColor" in animate is not animatable.*crossfade/);
  assert.throws(() => resolve({width: 10}, undefined, 'animate'), /Animatable keys: opacity, x, y/);
  assert.throws(() => resolve({x: '10px'}, undefined, 'animate'), /animate.x must be a finite number/);
  assert.throws(() => resolve('open', {closed: {x: 0}}, 'animate'), /animate="open" is not in variants \(closed\)/);
  assert.deepEqual(resolve('open', {closed: {x: 0}}, 'animate', true), []);
  assert.throws(() => collectKeys([{scale: 1}, {scaleX: 2}]), /either scale or scaleX/);
});

test('higher layers win per key and lower ones fill the rest', () => {
  const keys = collectKeys([{opacity: 0, x: 0}], {focus: {scale: 1.1}});
  assert.deepEqual([...keys].sort(), ['opacity', 'scale', 'x']);
  const picked = pick([
    {targets: [{opacity: 1, x: 10}], inherited: true},
    {targets: [{x: 20, scale: 1.1, transition: {type: 'tween'}}], inherited: false},
  ], keys, {});
  assert.deepEqual(picked.opacity, {value: 1, transition: undefined, inherited: true});
  assert.deepEqual(picked.x, {value: 20, transition: {type: 'tween'}, inherited: false});
  assert.equal(pick([], keys, {scale: 0.5}).scale.value, 0.5);
});

test('style binding replaces static transforms and wraps opacity for text', () => {
  const flat = {margin: 4, opacity: 0.5, transform: [{translateX: 8}, {rotate: '90deg'}, {scale: 2}]};
  assert.deepEqual(baseFromStyle(flat, 2), {opacity: 0.5, x: 4, rotate: 90, scale: 2});
  const x = {}, opacity = {};
  const {style} = bindStyle(flat, new Map([['x', x], ['opacity', opacity]]), false);
  assert.deepEqual(style, {margin: 4, opacity, transform: [{rotate: '90deg'}, {scale: 2}, {translateX: x}]});
  const wrapped = bindStyle(flat, new Map([['opacity', opacity], ['scaleX', x]]), true);
  assert.deepEqual(wrapped.outer, {opacity, margin: 4});
  assert.deepEqual(wrapped.style, {transform: [{translateX: 8}, {rotate: '90deg'}, {scaleX: x}]});
});

test('values animate changed keys, retarget, and report settling', () => {
  const engine = fakeEngine();
  const values = new MotionValues(engine, 2);
  values.ensure('x', 0);
  values.ensure('opacity', 0);
  const results = [];
  values.apply({x: {value: 10}, opacity: {value: 1}}, finished => results.push(finished));
  assert.equal(engine.running.size, 2);
  assert.deepEqual([...engine.running].map(a => a.to).sort(), [1, 20]);
  values.apply({x: {value: 10}, opacity: {value: 0.5}}, finished => results.push(finished));
  assert.equal(engine.running.size, 2, 'x keeps running, opacity is retargeted');
  engine.settle();
  assert.deepEqual(results, [true], 'the superseded batch never reports');
  values.apply({x: {value: 10}}, finished => results.push(finished));
  assert.deepEqual(results, [true, true], 'nothing moving settles at once');
  values.dispose();
  assert.equal(engine.destroyed, 2);
});

test('repeat reverse alternates in JavaScript and stops cleanly', async () => {
  const engine = fakeEngine();
  const values = new MotionValues(engine, 1);
  values.ensure('opacity', 1);
  const results = [];
  values.apply({opacity: {value: 0.5, transition: {repeat: 2, repeatType: 'reverse', delay: 0.1}}},
    finished => results.push(finished));
  const targets = [];
  for (let i = 0; i < 3; i++) {
    const [animation] = engine.running;
    targets.push([animation.to, animation.config.delay]);
    engine.settle();
    await tick();
  }
  assert.deepEqual(targets, [[0.5, 100], [1, 0], [0.5, 0]]);
  assert.deepEqual(results, [true]);

  values.apply({opacity: {value: 0, transition: {repeat: Infinity}}}, finished => results.push(finished));
  engine.settle();
  await tick();
  const [again] = engine.running;
  assert.deepEqual([again.value.current, again.to], [0.5, 0], 'loop restarts from the start value');
  values.dispose();
  assert.equal(engine.running.size, 0);
});

test('presence keeps exiting children in place and holds entries in wait mode', () => {
  const entry = (key, present = true, entering = true) => ({key, element: key, present, entering});
  const first = nextPresence([], [{key: 'a', element: 'a'}, {key: 'b', element: 'b'}], 'sync', false);
  assert.deepEqual(first, [entry('a', true, false), entry('b', true, false)]);
  const sync = nextPresence(first, [{key: 'b', element: 'b'}, {key: 'c', element: 'c'}], 'sync', true);
  assert.deepEqual(sync.map(e => [e.key, e.present, e.entering]),
    [['a', false, false], ['b', true, false], ['c', true, true]]);
  const wait = nextPresence([entry('a')], [{key: 'c', element: 'c'}], 'wait', true);
  assert.deepEqual(wait.map(e => [e.key, e.present]), [['a', false]]);
  assert.deepEqual(nextPresence([], [{key: 'c', element: 'c'}], 'wait', true).map(e => e.key), ['c']);
});
