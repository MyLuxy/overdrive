// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Windowing math for VirtualList, without React: which rows of a fixed-height list stay mounted.

/** @typedef {[number, number]} Range rows `[first, end)` */

/**
 * The rows a list needs now (`required`: on screen, plus the focused row and its neighbours) and the
 * rows worth keeping ahead of it (`desired`: `required` plus overscan, more in the direction of travel).
 * Lengths are in the scroll frame's content px.
 * @param {{rows: number, stride: number, top: number, scroll: number, from?: number, viewport: number,
 *   focusedRow: number, direction: number, ahead: number, behind: number}} options
 *   `stride` is a row plus the gap after it; `top` is where the list starts in the scrolled content;
 *   `scroll` is the scroll target and `from` where the scroll is now, when it is still moving there:
 *   every row the viewport passes on the way is on screen at some point, so all of them are required;
 *   `focusedRow` is -1 when focus is elsewhere; `direction` is the sign of the last scroll.
 * @returns {{required: Range, desired: Range}}
 */
export function windowRows({rows, stride, top, scroll, from = scroll, viewport, focusedRow, direction, ahead, behind}) {
  const clamp = row => Math.min(rows, Math.max(0, row));
  let first = Math.floor((Math.min(scroll, from) - top) / stride);
  let end = Math.ceil((Math.max(scroll, from) + viewport - top) / stride);
  if (focusedRow >= 0) {
    first = Math.min(first, focusedRow - 1);
    end = Math.max(end, focusedRow + 2);
  }
  first = clamp(first);
  end = clamp(end);
  const [before, after] = direction < 0 ? [ahead, behind] : [behind, ahead];
  // Off screen, the list keeps the rows at its nearer edge, so focus arriving from outside finds them.
  if (end <= first) {
    const edge = scroll + viewport <= top ? 0 : rows;
    const span = Math.max(1, ahead);
    const range = edge === 0 ? [0, clamp(span)] : [clamp(rows - span), rows];
    return {required: [range[0], range[0]], desired: range};
  }
  return {required: [first, end], desired: [clamp(first - before), clamp(end + after)]};
}

/**
 * The next mounted range: `required` at once, each edge at most `maxRows` closer to `desired`, so a
 * held key mounts a row at a time instead of a burst. A range far from `desired` restarts there.
 * @param {Range} current @param {Range} required @param {Range} desired @param {number} maxRows
 * @returns {Range}
 */
export function stepRange(current, required, desired, maxRows) {
  const needed = required[1] > required[0];
  if (current[1] <= desired[0] || current[0] >= desired[1]) current = needed ? required : desired;
  const toward = (from, to) => (from < to ? Math.min(to, from + maxRows) : Math.max(to, from - maxRows));
  const first = toward(current[0], desired[0]);
  const end = toward(current[1], desired[1]);
  return needed ? [Math.min(first, required[0]), Math.max(end, required[1])] : [first, end];
}

/**
 * Whether the visible end is within `threshold` viewports of the content end (FlatList's
 * `onEndReachedThreshold`). @param {{rows: number, stride: number, top: number, scroll: number,
 * viewport: number, threshold: number}} options
 */
export function nearEnd({rows, stride, top, scroll, viewport, threshold}) {
  return scroll + viewport >= top + rows * stride - threshold * viewport;
}

/**
 * Recycling: each mounted row keeps its slot (its React key); a row coming into the range takes the
 * slot of one that left, so its elements update in place instead of unmounting and mounting.
 * @param {Map<number, number>} previous row → slot @param {Range} range @returns {Map<number, number>}
 */
export function recycleSlots(previous, [first, end]) {
  const slots = new Map();
  const free = [];
  let next = 0;
  for (const [row, slot] of previous) {
    next = Math.max(next, slot + 1);
    if (row >= first && row < end) slots.set(row, slot);
    else free.push(slot);
  }
  for (let row = first; row < end; row++) if (!slots.has(row)) slots.set(row, free.length ? free.pop() : next++);
  return slots;
}

/**
 * The first row the content represents. Engine coordinates are 16-bit, so a long list lays out only
 * `span` rows from `base`; when `range` comes within `margin` rows of a represented edge that is not
 * the list's own, the span re-centres on it. @param {Range} range @returns {number} the new base
 */
export function rebase(base, range, rows, span, margin) {
  if (rows <= span) return 0;
  const nearStart = base > 0 && range[0] < base + margin;
  const nearEnd = base + span < rows && range[1] > base + span - margin;
  if (!nearStart && !nearEnd) return base;
  return Math.min(rows - span, Math.max(0, Math.floor((range[0] + range[1] - span) / 2)));
}
