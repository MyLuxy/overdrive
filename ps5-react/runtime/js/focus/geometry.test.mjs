// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {anchorOffset, catchUpSpeed, findClosest, findNearest, findWrap, revealOffset, scrollStep} from './geometry.js';

const rect = (x, y, width = 100, height = 100) => ({x, y, width, height});
const grid = () => {
  const cells = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      cells.push({id: `${row}${column}`, rect: rect(column * 120, row * 120), order: cells.length});
    }
  }
  return cells;
};
const move = (cells, id, direction) => {
  const from = cells.find(cell => cell.id === id);
  return findNearest(from.rect, cells.filter(cell => cell !== from), direction)?.id ?? null;
};

test('a grid moves one cell per direction and stops at the edges', () => {
  const cells = grid();
  assert.equal(move(cells, '11', 'up'), '01');
  assert.equal(move(cells, '11', 'down'), '21');
  assert.equal(move(cells, '11', 'left'), '10');
  assert.equal(move(cells, '11', 'right'), '12');
  assert.equal(move(cells, '00', 'up'), null);
  assert.equal(move(cells, '00', 'left'), null);
  assert.equal(move(cells, '22', 'right'), null);
});

test('orthogonal offset weighs double the primary distance', () => {
  const from = rect(0, 0);
  const aligned = {rect: rect(400, 0), order: 0};
  const diagonal = {rect: rect(150, 200), order: 1};
  // aligned: 300 + 0; diagonal: 50 + 2 × 100.
  assert.equal(findNearest(from, [aligned, diagonal], 'right'), diagonal);
  const far = {rect: rect(150, 300), order: 1};
  assert.equal(findNearest(from, [aligned, far], 'right'), aligned);
});

test('ties prefer more orthogonal overlap, then document order', () => {
  const from = rect(0, 0, 100, 100);
  const partial = {rect: rect(0, 120, 100, 100), order: 0};
  const shifted = {rect: rect(50, 120, 100, 100), order: 1};
  assert.equal(findNearest(from, [shifted, partial], 'down'), partial);
  const first = {rect: rect(0, 120), order: 0};
  const second = {rect: rect(0, 120), order: 1};
  assert.equal(findNearest(from, [second, first], 'down'), first);
});

test('an element containing the origin or behind it is not a candidate', () => {
  const from = rect(100, 100);
  assert.equal(findNearest(from, [{rect: rect(0, 0, 400, 400), order: 0}], 'right'), null);
  assert.equal(findNearest(from, [{rect: rect(50, 100), order: 0}], 'right'), null);
  assert.ok(findNearest(from, [{rect: rect(150, 100), order: 0}], 'right'));
});

test('wrap picks the far end of the same row or column', () => {
  const cells = grid();
  const at = id => cells.find(cell => cell.id === id);
  const others = id => cells.filter(cell => cell.id !== id);
  assert.equal(findWrap(at('12').rect, others('12'), 'right').id, '10');
  assert.equal(findWrap(at('10').rect, others('10'), 'left').id, '12');
  assert.equal(findWrap(at('21').rect, others('21'), 'down').id, '01');
  assert.equal(findWrap(at('00').rect, [], 'right'), null);
});

test('closest by centre distance', () => {
  const cells = grid();
  assert.equal(findClosest(rect(250, 250, 20, 20), cells).id, '22');
});

test('reveal scrolls the least, keeps a margin, and clamps', () => {
  assert.equal(revealOffset(0, 100, 50, 300, 1000, 10), 0);
  assert.equal(revealOffset(0, 400, 50, 300, 1000, 10), 160);
  assert.equal(revealOffset(500, 400, 50, 300, 1000, 10), 390);
  assert.equal(revealOffset(0, 5, 50, 300, 1000, 10), 0);
  assert.equal(revealOffset(0, 1400, 50, 300, 1000, 10), 1000);
  assert.equal(revealOffset(0, 400, 500, 300, 1000, 10), 390);
});

/** Per-frame steps of a scroll from `from` to `to`, retargeting by `extra` px every `every` frames. */
function steps(from, to, {extra = 0, every = 0, frames = 200} = {}) {
  let position = from, speed = 0, target = to;
  const deltas = [];
  for (let frame = 1; frame <= frames && (position !== target || (every && frame < frames)); frame++) {
    if (every && frame % every === 0) target += extra;
    const [next, nextSpeed] = scrollStep(position, speed, target, 60, 18, 6);
    deltas.push(next - position);
    [position, speed] = [next, nextSpeed];
  }
  return {position, deltas};
}

test('a scroll step speeds up, cruises and brakes to land exactly in whole pixels', () => {
  const {position, deltas} = steps(0, 1000);
  assert.equal(position, 1000);
  assert.deepEqual(deltas.slice(0, 4), [18, 36, 54, 60]);
  assert.ok(deltas.every(Number.isInteger));
  // Braking never speeds up again and ends without a tail of tiny steps.
  const braking = deltas.slice(deltas.lastIndexOf(60) + 1);
  assert.ok(braking.every((delta, i) => i === 0 || delta <= braking[i - 1]));
  assert.ok(braking.length <= 11);
  assert.deepEqual(steps(1000, 0).deltas.slice(0, 2), [-18, -36]);
  assert.deepEqual(steps(0, 3).deltas, [3]);
});

test('a target that keeps moving ahead scrolls at one steady speed', () => {
  // A held key: one 421 px row every 6 frames, faster than the cap.
  const {deltas} = steps(0, 421, {extra: 421, every: 6, frames: 70});
  assert.ok(deltas.slice(6).every(delta => delta >= 58 && delta <= 60), deltas.join());
});

test('an anchor aligns its start past the margin, scrolls to 0 near the top, and never hides the item', () => {
  // A section at 600 whose card sits at 650: the title stays on screen, not just the card.
  assert.equal(anchorOffset(0, 650, 100, 600, 300, 1000, 10), 590);
  assert.equal(anchorOffset(800, 650, 100, 600, 300, 1000, 10), 590);
  // The hero at the top of the content scrolls all the way back to 0.
  assert.equal(anchorOffset(400, 200, 100, 5, 300, 1000, 10), 0);
  assert.equal(anchorOffset(0, 1300, 50, 1200, 300, 1000, 10), 1000);
  // An anchor taller than the viewport: the item far below its start moves the least instead.
  assert.equal(anchorOffset(0, 700, 50, 100, 300, 1000, 10), revealOffset(0, 700, 50, 300, 1000, 10));
});

test('a scroll far behind its target is allowed faster than the cap, near it the cap holds', () => {
  assert.equal(catchUpSpeed(300, 1080, 60), 60);
  assert.equal(catchUpSpeed(-300, 1080, 60), 60);
  assert.equal(catchUpSpeed(1360, 1080, 60), 250);
  assert.equal(catchUpSpeed(-1360, 1080, 60), 250);
});
