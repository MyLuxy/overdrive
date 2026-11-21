// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Controller events from the per-frame GamepadState: native.js reads the state, this diffs it. Pure
// apart from the frame subscription, so the diffing is testable without a host.
import {onFrame} from './frame.js';

/** In GamepadState bit order (native/shared/host_api.hpp kButtonNames). */
export const BUTTONS = ['up', 'down', 'left', 'right', 'cross', 'circle', 'triangle', 'square', 'l1', 'r1',
  'l2', 'r2', 'l3', 'r3', 'options', 'touchpad'];

/**
 * @typedef {import('./native.js').Button} Button
 * @typedef {import('./native.js').GamepadState} GamepadState
 * @typedef {{type: 'press', button: Button, state: GamepadState}
 *   | {type: 'release', button: Button, heldMs: number, state: GamepadState}
 *   | {type: 'trigger', trigger: 'l2' | 'r2', value: number, previous: number, state: GamepadState}
 *   | {type: 'frame', elapsedMs: number, state: GamepadState}} ControllerEvent
 */

/**
 * The events between two frames' states: releases, then presses (each in button order), then trigger
 * travel changes. `held` maps each held button to the milliseconds it has been down, and is updated.
 * @param {GamepadState} previous @param {GamepadState} next
 * @param {Map<Button, number>} held @param {number} elapsedMs
 * @returns {ControllerEvent[]}
 */
export function gamepadEvents(previous, next, held, elapsedMs) {
  const events = [];
  const was = new Set(previous.buttons), now = new Set(next.buttons);
  for (const [button, ms] of held) held.set(button, ms + elapsedMs);
  for (const button of BUTTONS) {
    if (!was.has(button) || now.has(button)) continue;
    events.push({type: 'release', button, heldMs: held.get(button) ?? 0, state: next});
    held.delete(button);
  }
  for (const button of BUTTONS) {
    if (was.has(button) || !now.has(button)) continue;
    events.push({type: 'press', button, state: next});
    held.set(button, 0);
  }
  for (const trigger of ['l2', 'r2']) {
    if (next[trigger] !== previous[trigger])
      events.push({type: 'trigger', trigger, value: next[trigger], previous: previous[trigger], state: next});
  }
  return events;
}

/**
 * One frame subscription shared by every watcher, active only while there are watchers: each frame
 * reads the state once and gives every watcher it and the events since that watcher's last frame. A
 * button already held when a watcher starts is not a press for it (it may be the press that mounted
 * the watcher); its release is.
 * @param {() => GamepadState} read
 */
export function gamepadSource(read) {
  const watchers = new Set();
  let stop = null;
  const step = elapsedMs => {
    const next = read();
    // A watcher added by another's callback starts next frame.
    for (const watcher of [...watchers]) {
      if (!watchers.has(watcher)) continue;
      const events = gamepadEvents(watcher.state, next, watcher.held, elapsedMs);
      watcher.state = next;
      watcher.callback(next, events, elapsedMs);
    }
  };
  return {
    /**
     * @param {(state: GamepadState, events: ControllerEvent[], elapsedMs: number) => void} callback
     * @returns {() => void} stops watching
     */
    watch(callback) {
      const state = read();
      const watcher = {callback, state, held: new Map(state.buttons.map(button => [button, 0]))};
      watchers.add(watcher);
      stop ??= onFrame(step);
      return () => {
        if (!watchers.delete(watcher) || watchers.size) return;
        stop();
        stop = null;
      };
    },
  };
}
