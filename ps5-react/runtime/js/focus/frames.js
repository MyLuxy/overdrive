// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Node rectangles through their scrolling ancestors: layout rectangles are pre-scroll, and each
// enclosing ScrollView (a Frame) moves its content by its offset.
import {intersection, overlaps} from './geometry.js';

/**
 * @typedef {import('./geometry.js').Rect} Rect
 * @typedef {import('./manager.js').Frame} Frame
 * @typedef {import('./manager.js').Node} Node
 */

/** `rect` as `frame`'s scroll offset moves it. @param {Rect} rect @param {Frame} frame @returns {Rect} */
export function scrolledBy(rect, frame) {
  return {...rect, x: rect.x - frame.x, y: rect.y - frame.y};
}

/** `rect` as `frame` is currently displayed, rather than its animation target. */
function displayedScrolledBy(rect, frame) {
  const [x, y] = frame.timer !== null && frame.position ? frame.position : [frame.x, frame.y];
  return {...rect, x: rect.x - x, y: rect.y - y};
}

/** @param {Node} node @returns {Rect | null} the rectangle on screen, scrolling applied */
export function screenRect(node) {
  let rect = node.rect;
  if (!rect) return null;
  for (let frame = node.frame; frame; frame = frame.parent) rect = scrolledBy(rect, frame);
  return rect;
}

/**
 * Whether any of a layout rectangle under `frame` shows within `bounds` (the screen), clipped by each
 * enclosing ScrollView's viewport. Transforms are not applied: layout rectangles do not include them.
 * @param {Rect | null} rect @param {Frame | null} frame @param {Rect} bounds
 */
export function shownIn(rect, frame, bounds) {
  for (; rect && frame; frame = frame.parent) {
    rect = displayedScrolledBy(rect, frame);
    if (frame.viewport) rect = intersection(rect, frame.viewport);
  }
  return !!rect && overlaps(rect, bounds);
}

/**
 * Whether a move from inside `from` (the focused node's frames) can reach `node`: entering a
 * ScrollView from outside reaches only what it shows, at least in part, not items scrolled away.
 * @param {Node} node @param {Set<Frame>} from
 */
export function reachable(node, from) {
  let rect = node.rect;
  for (let frame = node.frame; frame && !from.has(frame); frame = frame.parent) {
    rect = scrolledBy(rect, frame);
    if (frame.viewport && !overlaps(rect, frame.viewport)) return false;
  }
  return true;
}
