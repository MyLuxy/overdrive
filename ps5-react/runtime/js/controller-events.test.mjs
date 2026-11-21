// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import test from 'node:test';
import {gamepadEvents, gamepadSource} from './controller-events.js';

const pad = (buttons = [], l2 = 0, r2 = 0) => ({connected: true, leftX: 0, leftY: 0, rightX: 0, rightY: 0, l2, r2, buttons});
const brief = events => events.map(({type, button, trigger, value, previous, heldMs}) =>
  type === 'trigger' ? `${trigger} ${previous}->${value}` : `${type} ${button}${heldMs === undefined ? '' : ` ${heldMs}`}`);

test('a frame reports releases, then presses, then trigger travel, and how long a button was held', () => {
  const held = new Map();
  assert.deepEqual(brief(gamepadEvents(pad(), pad(['r2', 'cross'], 0, 0.6), held, 16)),
    ['press cross', 'press r2', 'r2 0->0.6']);
  assert.deepEqual(brief(gamepadEvents(pad(['r2', 'cross'], 0, 0.6), pad(['r2', 'cross'], 0, 0.6), held, 16)), [],
    'a steady hold is no event');
  // The other trigger pressed as this one is let go: the release comes first.
  assert.deepEqual(brief(gamepadEvents(pad(['r2', 'cross'], 0, 0.6), pad(['l2', 'cross'], 0.9, 0.2), held, 17)),
    ['release r2 33', 'press l2', 'l2 0->0.9', 'r2 0.6->0.2']);
  assert.deepEqual(brief(gamepadEvents(pad(['l2', 'cross'], 0.9, 0.2), pad([], 0, 0), held, 16)),
    ['release cross 49', 'release l2 16', 'l2 0.9->0', 'r2 0.2->0']);
  assert.equal(held.size, 0);
});

test('a watcher sees the buttons held when it started as held, not pressed, and frames stop with the last one', () => {
  let state = pad(['touchpad']);
  const frames = [];
  const source = gamepadSource(() => state);
  const first = [], late = [];
  const stopFirst = source.watch((next, events) => first.push(...brief(events)));
  state = pad(['touchpad', 'l3']);
  globalThis.__ps5ReactFrame(16);
  // Started by a press it should not see again: l3 is held when this one starts.
  const stopLate = source.watch((next, events, elapsedMs) => { frames.push(elapsedMs); late.push(...brief(events)); });
  state = pad(['l3']);
  globalThis.__ps5ReactFrame(20);
  state = pad([]);
  globalThis.__ps5ReactFrame(16);
  assert.deepEqual(first, ['press l3', 'release touchpad 36', 'release l3 36']);
  assert.deepEqual(late, ['release touchpad 20', 'release l3 36']);
  assert.deepEqual(frames, [20, 16]);
  stopFirst();
  stopLate();
  state = pad(['cross']);
  globalThis.__ps5ReactFrame(16);
  assert.equal(first.length + late.length, 5);
});
