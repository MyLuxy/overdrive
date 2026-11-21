// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {revealOffset} from './geometry.js';
import {FocusManager} from './manager.js';
import {nearEnd, rebase, recycleSlots, stepRange, windowRows} from './window.js';

const base = {rows: 100, stride: 100, top: 0, viewport: 350, focusedRow: -1, direction: 1, ahead: 2, behind: 1};

test('the window covers the viewport, with more overscan in the direction of travel', () => {
  assert.deepEqual(windowRows({...base, scroll: 1000}), {required: [10, 14], desired: [9, 16]});
  assert.deepEqual(windowRows({...base, scroll: 1000, direction: -1}), {required: [10, 14], desired: [8, 15]});
  assert.deepEqual(windowRows({...base, scroll: 0}).desired, [0, 6]);
  assert.deepEqual(windowRows({...base, scroll: 9650}).desired, [95, 100]);
});

test('the focused row and its neighbours stay required even off screen', () => {
  assert.deepEqual(windowRows({...base, scroll: 1000, focusedRow: 20}).required, [10, 22]);
  assert.deepEqual(windowRows({...base, scroll: 1000, focusedRow: 0}).required, [0, 14]);
});

test('a list off screen keeps the rows at its nearer edge for focus arriving from outside', () => {
  assert.deepEqual(windowRows({...base, top: 5000, scroll: 0}), {required: [0, 0], desired: [0, 2]});
  assert.deepEqual(windowRows({...base, scroll: 20000}), {required: [98, 98], desired: [98, 100]});
  assert.deepEqual(windowRows({...base, rows: 0, scroll: 0}).desired, [0, 0]);
});

test('stepping mounts the required rows at once and the overscan a row per frame', () => {
  assert.deepEqual(stepRange([10, 14], [10, 14], [9, 16], 1), [9, 15]);
  assert.deepEqual(stepRange([9, 15], [10, 14], [9, 16], 1), [9, 16]);
  assert.deepEqual(stepRange([0, 4], [3, 7], [2, 9], 1), [1, 7]);
  // Shrinking edges also move a row at a time, never past the required rows.
  assert.deepEqual(stepRange([0, 20], [10, 14], [9, 16], 1), [1, 19]);
  // Far away (new data): restart from the required rows.
  assert.deepEqual(stepRange([0, 5], [50, 54], [49, 56], 1), [49, 55]);
});

test('onEndReached fires within the threshold of the content end', () => {
  const end = {rows: 10, stride: 100, top: 200, viewport: 300, threshold: 1};
  assert.equal(nearEnd({...end, scroll: 500}), false);
  assert.equal(nearEnd({...end, scroll: 600}), true);
});

test('recycled rows keep their slots and reuse the slots of rows that left', () => {
  const first = recycleSlots(new Map(), [0, 3]);
  assert.deepEqual([...first], [[0, 0], [1, 1], [2, 2]]);
  const next = recycleSlots(first, [1, 4]);
  assert.deepEqual([...next].sort(), [[1, 1], [2, 2], [3, 0]]);
  assert.deepEqual([...recycleSlots(next, [1, 5])].sort(), [[1, 1], [2, 2], [3, 0], [4, 3]]);
});

/**
 * A 5-column grid of 611 items under 1500 px of other content, windowed like VirtualList, with focus
 * moving one row per frame (faster than any held-key repeat) while the window steps a row per frame.
 */
function heldScroll(direction, presses, startRow) {
  const columns = 5, count = 611, stride = 429, top = 1500, viewport = 900;
  const rows = Math.ceil(count / columns);
  const queue = [];
  const focus = new FocusManager({schedule: fn => queue.push(fn)});
  const mounted = new Map();
  let range = [0, 0];
  const mount = ([first, end]) => {
    for (const [index, node] of mounted) {
      const row = Math.floor(index / columns);
      if (row < first || row >= end) {
        focus.unregister(node);
        mounted.delete(index);
      }
    }
    for (let index = first * columns; index < Math.min(count, end * columns); index++) {
      if (mounted.has(index)) continue;
      const node = focus.createNode(focus.root, null, {focusKey: `item${index}`});
      focus.register(node);
      focus.setRect(node, {x: (index % columns) * 180, y: top + Math.floor(index / columns) * stride,
        width: 150, height: 260});
      mounted.set(index, node);
    }
    while (queue.length) queue.shift()();
    range = [first, end];
  };
  let scroll = Math.max(0, top + startRow * stride - 300);
  const window = () => windowRows({rows, stride, top, scroll, viewport, direction,
    focusedRow: Math.floor((focus.focused.rect.y - top) / stride), ahead: 2, behind: 1});
  mount([Math.max(0, startRow - 3), Math.min(rows, startRow + 4)]);
  focus.focus(`item${startRow * columns}`);
  let peak = 0;
  for (let press = 0; press < presses; press++) {
    const expected = Math.floor(focus.focused.rect.y - top) / stride + direction;
    focus.move(direction > 0 ? 'down' : 'up');
    assert.equal((focus.focused.rect.y - top) / stride, expected, `press ${press} reached row ${expected}`);
    scroll = revealOffset(scroll, focus.focused.rect.y, 260, viewport, top + rows * stride - viewport, 48);
    const {required, desired} = window();
    mount(stepRange(range, required, desired, 1));
    peak = Math.max(peak, mounted.size);
  }
  return peak;
}

test('focus held down or up through the whole grid always finds the next row mounted', () => {
  const peakDown = heldScroll(1, 122, 0);
  const peakUp = heldScroll(-1, 122, 122);
  // Bounded by the window (viewport rows, focus neighbours and overscan), not by the 611 items.
  assert.ok(peakDown <= 45 && peakUp <= 45, `peak mounted ${peakDown} / ${peakUp}`);
});

test('a list longer than its span re-centres the represented rows near an edge only', () => {
  assert.equal(rebase(0, [0, 7], 30, 50, 2), 0);
  assert.equal(rebase(0, [30, 37], 123, 50, 2), 0);
  assert.equal(rebase(0, [42, 49], 123, 50, 2), 20);
  assert.equal(rebase(20, [21, 28], 123, 50, 2), 0);
  assert.equal(rebase(60, [110, 117], 123, 50, 2), 73);
  assert.equal(rebase(40, [80, 89], 123, 50, 2), 59);
  assert.equal(rebase(73, [118, 123], 123, 50, 2), 73);
});

test('rows the scroll passes on its way to the target stay required', () => {
  const base = {rows: 50, stride: 100, top: 0, viewport: 300, focusedRow: -1, direction: 1, ahead: 2, behind: 1};
  assert.deepEqual(windowRows({...base, scroll: 1000}).required, [10, 13]);
  // Held Down: the target ran ahead of a scroll still at 400.
  assert.deepEqual(windowRows({...base, scroll: 1000, from: 400}).required, [4, 13]);
  assert.deepEqual(windowRows({...base, scroll: 400, from: 1000}).required, [4, 13]);
});
