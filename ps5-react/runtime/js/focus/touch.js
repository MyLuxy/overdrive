// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// The touchpad as a D-pad: a finger sliding across it steps focus once per stretch of travel, so a
// slow swipe walks card by card and a long one runs further. See docs/NAVIGATION.md.

// Travel per step, as a fraction of the pad's width or height: about nine cards across a full swipe,
// five rows down one (the pad is twice as wide as it is tall).
export const STEP_X = 0.11;
export const STEP_Y = 0.2;
// Travel before a gesture settles on an axis: a tap or a wobbling finger moves nothing, and a swipe
// stays on its axis to the end, so a sideways swipe never slips into the next row.
export const LOCK = 0.03;
// The pad is about twice as wide as it is tall: a fraction of its width is twice the distance of the
// same fraction of its height, which the axis lock has to weigh.
const ASPECT = 2;

export class TouchNavigator {
  /** @param {(direction: import('./geometry.js').Direction) => void} step */
  constructor(step) {
    this.step = step;
    this.release();
  }

  /** The finger at (x, y), each 0..1 across the pad; `null` x when it lifts. */
  touch(x, y) {
    if (x == null) return this.release();
    if (this.last) this.slide(x - this.last.x, y - this.last.y);
    this.last = {x, y};
    return undefined;
  }

  release() {
    this.last = null;
    this.axis = null;
    this.travel = {x: 0, y: 0};
    this.taken = 0;
  }

  // Steps sit at fixed points along the swipe since it settled on an axis, like a dial's detents:
  // going back over one steps back, so returning to where the swipe began returns focus too.
  /** @param {number} dx @param {number} dy */
  slide(dx, dy) {
    const travel = this.travel;
    travel.x += dx;
    travel.y += dy;
    if (!this.axis) {
      const across = Math.abs(travel.x) * ASPECT, down = Math.abs(travel.y);
      if (Math.max(across, down) < LOCK) return;
      this.axis = across >= down ? 'x' : 'y';
    }
    const [size, back, forward] = this.axis === 'x' ? [STEP_X, 'left', 'right'] : [STEP_Y, 'up', 'down'];
    const due = Math.trunc(travel[this.axis] / size);
    for (; this.taken < due; this.taken++) this.step(forward);
    for (; this.taken > due; this.taken--) this.step(back);
  }
}
