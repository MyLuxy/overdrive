// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// One element's engine values: lazily allocated per key, retargeted from wherever they are, and
// released together. JavaScript runs only when an animation starts or settles, never per frame.
import {engineConfig, repeatOf} from './transitions.js';

/**
 * @typedef {object} Engine
 * @property {(initial: number) => object} create
 * @property {(value: object, to: number, config: object, done: (finished: boolean) => void) => () => void} animate
 *   Returns stop(); done(false) when interrupted.
 * @property {(value: object, to: number) => void} set
 * @property {(value: object) => number} get
 * @property {(value: object) => void} destroy
 * @typedef {{value: number, transition?: object, delay?: number}} KeyTarget logical value; delay in seconds
 */

function once(fn) {
  let called = false;
  return finished => {
    if (called) return;
    called = true;
    fn(finished);
  };
}

export class MotionValues {
  /** @param {Engine} engine @param {number} scale physical px per logical px */
  constructor(engine, scale) {
    this.engine = engine;
    this.scale = scale;
    /** @type {Map<string, {value: object, target: number, stop: (() => void) | null, token: object | null,
     *   waiters: Array<(finished: boolean) => void>}>} */
    this.entries = new Map();
    this.batch = 0;
  }

  physical(key, value) {
    return key === 'x' || key === 'y' ? value * this.scale : value;
  }

  /** Allocates the key's value at `initial` (logical) on first use. */
  ensure(key, initial) {
    if (this.entries.has(key)) return;
    this.entries.set(key, {value: this.engine.create(this.physical(key, initial)), target: initial,
      stop: null, token: null, waiters: []});
  }

  /** @returns {Map<string, object>} */
  bound() {
    return new Map([...this.entries].map(([key, entry]) => [key, entry.value]));
  }

  /**
   * Animates every key whose target changed, then calls `onDone(finished)` once every key in
   * `targets` has settled (right away when none is moving). Each call supersedes the previous one:
   * its onDone no longer fires, and keys it retargets are interrupted.
   * @param {{[key: string]: KeyTarget}} targets
   * @param {(finished: boolean) => void} onDone
   */
  apply(targets, onDone) {
    const batch = ++this.batch;
    for (const entry of this.entries.values()) entry.waiters = [];
    for (const [key, {value, transition = {}, delay = 0}] of Object.entries(targets)) {
      const entry = this.entries.get(key);
      if (entry.target !== value) this.start(entry, key, value, transition, delay);
    }
    const moving = Object.keys(targets).map(key => this.entries.get(key)).filter(entry => entry.stop);
    if (!moving.length) {
      onDone(true);
      return;
    }
    let pending = moving.length;
    let finishedAll = true;
    for (const entry of moving) {
      entry.waiters.push(finished => {
        if (batch !== this.batch) return;
        finishedAll &&= finished;
        if (--pending === 0) onDone(finishedAll);
      });
    }
  }

  start(entry, key, to, transition, delay) {
    const previous = entry.stop;
    const token = {};
    entry.token = token;
    entry.stop = null;
    entry.target = to;
    previous?.();
    const stop = this.run(entry, key, to, transition, delay, once(finished => {
      if (entry.token !== token) return;
      entry.token = null;
      entry.stop = null;
      const waiters = entry.waiters;
      entry.waiters = [];
      for (const waiter of waiters) waiter(finished);
    }));
    if (entry.token === token) entry.stop = stop;
  }

  run(entry, key, to, transition, delay, done) {
    const {count, reverse} = repeatOf(transition);
    const config = engineConfig(transition, key, delay, this.scale);
    const target = this.physical(key, to);
    if (count === 1) {
      const stop = this.engine.animate(entry.value, target, config, done);
      return () => {
        stop();
        done(false);
      };
    }
    const from = this.engine.get(entry.value);
    let iteration = 0;
    let stop = () => {};
    let timer;
    const step = () => {
      const back = reverse && iteration % 2 === 1;
      if (!reverse && iteration > 0) this.engine.set(entry.value, from);
      const iterationConfig = iteration === 0 ? config : {...config, delay: 0};
      iteration++;
      stop = this.engine.animate(entry.value, back ? from : target, iterationConfig, finished => {
        if (!finished) done(false);
        else if (iteration >= count) done(true);
        // A short iteration can settle synchronously; deferring keeps the chain off the stack.
        else timer = setTimeout(step, 0);
      });
    };
    step();
    return () => {
      clearTimeout(timer);
      stop();
      done(false);
    };
  }

  /** Stops every animation and releases the engine values. */
  dispose() {
    for (const entry of this.entries.values()) {
      const stop = entry.stop;
      entry.token = null;
      entry.stop = null;
      stop?.();
      this.engine.destroy(entry.value);
    }
    this.entries.clear();
  }
}
