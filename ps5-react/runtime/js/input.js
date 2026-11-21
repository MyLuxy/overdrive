// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
const listeners = new Set();
const touchListeners = new Set();

// Actions as strings, touch samples as [x, y] (x null when the finger lifts), in arrival order.
const pending = [];

function deliver() {
  for (const item of pending.splice(0)) {
    if (typeof item === 'string') for (const listener of listeners) listener(item);
    else for (const listener of touchListeners) listener(item[0], item[1]);
  }
}

// Input protocol v5 (versioned apart from the native API's ABI in host_api.hpp): hosts emit
// up/down/left/right/confirm/back/l1/r1/l2/r2/triangle/square/options (v2: the first six; v3: up to
// square) on the JS/render thread, before the frame's pump. Actions are delivered from the pump's microtask
// drain, which runs inside React's batch like the bridge's own events: a direct host call is outside
// it, so each setState of a handler would render and commit on its own, and the frame log would
// count that render outside `react`.
globalThis.__ps5ReactDispatch = action => {
  if (pending.push(action) === 1) Promise.resolve().then(deliver);
};

// Input protocol v5: the touchpad's first finger, each frame it moves, at (x, y) 0..1 across the pad,
// and (null) once when it lifts. The focus runtime turns its travel into moves (focus/touch.js).
globalThis.__ps5ReactTouch = (x, y) => {
  if (pending.push([x ?? null, y ?? null]) === 1) Promise.resolve().then(deliver);
};

/**
 * The host actions, as native/shared/actions.hpp names them.
 * @typedef {'l1' | 'r1' | 'l2' | 'r2' | 'triangle' | 'square' | 'options'} ButtonAction shoulders, triggers, Triangle, Square, Options
 * @typedef {'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | ButtonAction} Action
 */

/**
 * Internal: receive every host action until the returned function is called.
 * @param {(action: Action) => void} listener
 */
export function subscribeInput(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Internal: receive the touchpad's finger until the returned function is called.
 * @param {(x: number | null, y: number | null) => void} listener
 */
export function subscribeTouch(listener) {
  touchListeners.add(listener);
  return () => { touchListeners.delete(listener); };
}
