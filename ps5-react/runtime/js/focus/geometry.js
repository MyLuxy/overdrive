// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Spatial navigation over screen rectangles; see docs/NAVIGATION.md.

/**
 * @typedef {{x: number, y: number, width: number, height: number}} Rect
 * @typedef {'up' | 'down' | 'left' | 'right'} Direction
 * @typedef {{rect: Rect, order: number}} Candidate order is document order
 */

const HORIZONTAL = {left: -1, right: 1};

/** Whether two rectangles share any area. @param {Rect} a @param {Rect} b */
export function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The area two rectangles share, or null when none. @param {Rect} a @param {Rect} b @returns {Rect | null} */
export function intersection(a, b) {
  if (!overlaps(a, b)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {x, y, width: Math.min(a.x + a.width, b.x + b.width) - x, height: Math.min(a.y + a.height, b.y + b.height) - y};
}

/** Edges along the pressed axis and across it, so every direction reads like `right`. */
function axes(rect, direction) {
  const horizontal = direction in HORIZONTAL;
  const sign = horizontal ? HORIZONTAL[direction] : direction === 'down' ? 1 : -1;
  const [start, size, crossStart, crossSize] = horizontal
    ? [rect.x, rect.width, rect.y, rect.height] : [rect.y, rect.height, rect.x, rect.width];
  const [near, far] = sign > 0 ? [start, start + size] : [-(start + size), -start];
  return {near, far, crossStart, crossEnd: crossStart + crossSize};
}

/** Length shared on the orthogonal axis; negative is the gap between the rectangles. */
function overlap(a, b) {
  return Math.min(a.crossEnd, b.crossEnd) - Math.max(a.crossStart, b.crossStart);
}

/** Whether candidate `a` (score `sa`, overlap `oa`) beats `b`: lower score, more overlap, earlier. */
function better(a, sa, oa, b, sb, ob) {
  if (sa !== sb) return sa < sb;
  if (oa !== ob) return oa > ob;
  return a.order < b.order;
}

/**
 * The candidate the D-pad moves to from `from`: among rectangles lying in `direction`, the one
 * minimising `primary + 2 × orthogonal` distance between nearest edges; ties prefer more orthogonal
 * overlap, then document order.
 * @template {Candidate} T
 * @param {Rect} from
 * @param {T[]} candidates
 * @param {Direction} direction
 * @returns {T | null}
 */
export function findNearest(from, candidates, direction) {
  const origin = axes(from, direction);
  let best = null;
  let bestScore = Infinity;
  let bestOverlap = -Infinity;
  for (const candidate of candidates) {
    const target = axes(candidate.rect, direction);
    if (!(target.far > origin.far && target.near > origin.near)) continue;
    const shared = overlap(origin, target);
    const score = Math.max(0, target.near - origin.far) + 2 * Math.max(0, -shared);
    if (!best || better(candidate, score, shared, best, bestScore, bestOverlap)) {
      best = candidate;
      bestScore = score;
      bestOverlap = shared;
    }
  }
  return best;
}

/**
 * Wrapping past the last element: the candidate in the same row (or column) farthest in the
 * opposite direction, or null when `from` is already the only one.
 * @template {Candidate} T
 * @param {Rect} from
 * @param {T[]} candidates
 * @param {Direction} direction
 * @returns {T | null}
 */
export function findWrap(from, candidates, direction) {
  const origin = axes(from, direction);
  let best = null;
  let bestNear = Infinity;
  let bestOverlap = -Infinity;
  for (const candidate of candidates) {
    const target = axes(candidate.rect, direction);
    const shared = overlap(origin, target);
    if (shared <= 0 || target.near >= origin.near) continue;
    if (!best || better(candidate, target.near, shared, best, bestNear, bestOverlap)) {
      best = candidate;
      bestNear = target.near;
      bestOverlap = shared;
    }
  }
  return best;
}

/**
 * The candidate whose centre is closest to `rect`'s, ties in document order.
 * @template {Candidate} T
 * @param {Rect} rect
 * @param {T[]} candidates
 * @returns {T | null}
 */
export function findClosest(rect, candidates) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const {x, y, width, height} = candidate.rect;
    const distance = Math.hypot(x + width / 2 - cx, y + height / 2 - cy);
    if (distance < bestDistance || (distance === bestDistance && candidate.order < best.order)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The scroll offset on one axis that brings an item into view with the least movement, keeping
 * `margin` around it; an item larger than the viewport aligns its start.
 * @param {number} offset current offset
 * @param {number} start item start in content coordinates
 * @param {number} size item size
 * @param {number} viewport viewport size
 * @param {number} max largest valid offset
 * @param {number} margin
 */
export function revealOffset(offset, start, size, viewport, max, margin) {
  let next = offset;
  if (start + size + margin > next + viewport) next = start + size + margin - viewport;
  if (start - margin < next) next = start - margin;
  return Math.min(Math.max(next, 0), max);
}

/**
 * The offset that aligns an anchor's start `margin` past the viewport start (clamped), so a section
 * title stays above its focused card; minimal movement instead when that would not show the item.
 * @param {number} offset @param {number} start @param {number} size @param {number} anchor anchor start
 * @param {number} viewport @param {number} max @param {number} margin
 */
export function anchorOffset(offset, start, size, anchor, viewport, max, margin) {
  const aligned = Math.min(Math.max(anchor - margin, 0), max);
  if (start >= aligned && start + size <= aligned + viewport) return aligned;
  return revealOffset(offset, start, size, viewport, max, margin);
}

/**
 * The speed cap for a scroll `distance` from its target: `maxSpeed`, raised once the target is more
 * than a third of the viewport away by a quarter of the excess, so a held key that moves focus faster
 * than the cap does not leave the screen ever further behind (rows a VirtualList has not mounted).
 * @param {number} distance px to the target @param {number} viewport px @param {number} maxSpeed
 */
export function catchUpSpeed(distance, viewport, maxSpeed) {
  const excess = Math.abs(distance) - viewport / 3;
  return excess > 0 ? Math.max(maxSpeed, Math.round(excess / 4)) : maxSpeed;
}

/**
 * One frame of a scroll toward `target`, in whole pixels: the speed rises by up to `accel` px per frame,
 * cruises at `maxSpeed`, and falls by `brake` px per frame to stop exactly on the target, with no slow
 * tail. At cruise every frame moves the same distance, and a new target keeps the current speed, so a
 * held key scrolls at one steady speed.
 * @param {number} position whole px @param {number} speed px per frame, signed
 * @param {number} target whole px @param {number} maxSpeed @param {number} accel @param {number} brake
 * @returns {[number, number]} the new position and speed
 */
export function scrollStep(position, speed, target, maxSpeed, accel, brake) {
  const remaining = target - position;
  if (remaining === 0) return [position, 0];
  const direction = Math.sign(remaining);
  const distance = Math.abs(remaining);
  // The fastest speed that still stops within `distance`: v + (v - brake) + ... <= distance.
  const stoppable = Math.floor((Math.sqrt(brake * brake + 8 * brake * distance) - brake) / 2);
  const step = Math.min(distance, Math.max(1, Math.min(maxSpeed, stoppable, speed * direction + accel)));
  return [position + direction * step, direction * step];
}
