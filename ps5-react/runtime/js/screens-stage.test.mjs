// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activate, initialStage, preload, settle} from './screens-stage.js';

/** Runs the stage through `active` changes and finished animations, as <Screens> feeds it. */
function run(start, steps) {
  let state = initialStage(start);
  let active = start;
  for (const step of steps) {
    if ('active' in step) {
      active = step.active;
      state = activate(state, active);
    } else {
      state = settle(state, state.stage, step.settled, active);
    }
  }
  return state;
}

test('the next screen enters only after the current one has left', () => {
  let state = activate(initialStage('home'), 'movies');
  assert.deepEqual(state, {stage: 'home', phase: 'leaving', mounted: ['home']});
  state = settle(state, 'home', 'leaving', 'movies');
  assert.deepEqual(state, {stage: 'movies', phase: 'entering', mounted: ['home', 'movies']});
  state = settle(state, 'movies', 'entering', 'movies');
  assert.deepEqual(state, {stage: 'movies', phase: 'shown', mounted: ['home', 'movies']});
});

test('screens passed over during an exit are never mounted', () => {
  const state = run('search', [{active: 'tv'}, {active: 'movies'}, {active: 'home'}, {settled: 'leaving'}]);
  assert.deepEqual(state, {stage: 'home', phase: 'entering', mounted: ['search', 'home']});
});

test('returning to the leaving screen turns it around', () => {
  const state = run('home', [{active: 'movies'}, {active: 'home'}]);
  assert.deepEqual(state, {stage: 'home', phase: 'shown', mounted: ['home']});
});

test('a removed outgoing screen advances without waiting for its missing completion callback', () => {
  const leaving = activate(initialStage('home'), 'movies');
  assert.deepEqual(activate(leaving, 'movies', false), {
    stage: 'movies', phase: 'entering', mounted: ['home', 'movies'],
  });
});

test('switching away while a screen enters makes it leave', () => {
  const state = run('home', [{active: 'movies'}, {settled: 'leaving'}, {active: 'tv'}]);
  assert.deepEqual(state, {stage: 'movies', phase: 'leaving', mounted: ['home', 'movies']});
});

test('stale completions are ignored', () => {
  let state = activate(initialStage('home'), 'movies');
  assert.equal(settle(state, 'movies', 'leaving', 'movies'), state);
  assert.equal(settle(state, 'home', 'entering', 'movies'), state);
  state = activate(state, 'home');
  assert.equal(settle(state, 'home', 'leaving', 'home'), state);
});

test('a visited screen is mounted once and kept', () => {
  const state = run('home', [{active: 'movies'}, {settled: 'leaving'}, {settled: 'entering'},
    {active: 'home'}, {settled: 'leaving'}, {settled: 'entering'}]);
  assert.deepEqual(state, {stage: 'home', phase: 'shown', mounted: ['home', 'movies']});
});

test('preloading mounts a screen off stage, once', () => {
  let state = preload(initialStage('home'), 'search');
  assert.deepEqual(state, {stage: 'home', phase: 'shown', mounted: ['home', 'search']});
  assert.equal(preload(state, 'search'), state);
  state = run('home', [{active: 'search'}, {settled: 'leaving'}]);
  assert.deepEqual(state.mounted, ['home', 'search']);
});
