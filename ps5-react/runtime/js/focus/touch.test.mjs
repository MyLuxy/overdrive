// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {LOCK, STEP_X, STEP_Y, TouchNavigator} from './touch.js';

function swipe(points) {
  const steps = [];
  const touch = new TouchNavigator(direction => steps.push(direction));
  for (const point of points) touch.touch(...point);
  return steps;
}

/** A straight swipe from (x0, y0) to (x1, y1), sampled in `n` frames. */
const line = (x0, y0, x1, y1, n = 30) =>
  Array.from({length: n + 1}, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);

test('one step per stretch of travel, in the direction the finger goes', () => {
  assert.deepEqual(swipe(line(0.2, 0.5, 0.2 + STEP_X * 3.5, 0.5)), ['right', 'right', 'right']);
  assert.deepEqual(swipe(line(0.8, 0.5, 0.8 - STEP_X * 2.2, 0.5)), ['left', 'left']);
  assert.deepEqual(swipe(line(0.5, 0.1, 0.5, 0.1 + STEP_Y * 2.1)), ['down', 'down']);
});

test('a tap or a wobble moves nothing', () => {
  assert.deepEqual(swipe([[0.5, 0.5], [0.5 + LOCK / 2, 0.5 - LOCK / 2], [0.5, 0.5], [null]]), []);
});

test('a swipe stays on the axis it started on', () => {
  // Mostly sideways with a drift down that would be a row's worth on its own.
  assert.deepEqual(swipe(line(0.1, 0.2, 0.1 + STEP_X * 2.5, 0.2 + STEP_Y * 1.5)), ['right', 'right']);
});

test('lifting the finger forgets the travel left over', () => {
  const half = line(0.2, 0.5, 0.2 + STEP_X * 0.7, 0.5, 5);
  assert.deepEqual(swipe([...half, [null], ...half]), []);
});

test('turning back mid-swipe steps back over the same points', () => {
  const out = line(0.2, 0.5, 0.2 + STEP_X * 2.5, 0.5, 10);
  const back = line(0.2 + STEP_X * 2.5, 0.5, 0.2 + STEP_X * 0.5, 0.5, 10);
  assert.deepEqual(swipe([...out, ...back]), ['right', 'right', 'left', 'left']);
});
