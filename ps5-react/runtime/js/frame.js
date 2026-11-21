// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
const callbacks = new Set();
let batch = run => run();

// Hosts call this once per frame, after the pump and before the commit, with the time the frame
// advances: on the PS5 a whole number of vblanks. Motion stepped here moves once per presented frame;
// a timer drifts against the display and skips or doubles frames.
// Batched callbacks share one render. Unbatched callbacks split that batch and run after it, which
// lets image delivery measure each synchronous React commit before deciding whether to continue.
// The frame always ends in a batch, even an empty one: leaving it flushes React work the pump left
// queued, and without it a press waits a frame (the starter self-test fails).
globalThis.__ps5ReactFrame = elapsedMs => {
  let pending = [];
  const flush = () => {
    const callbacksToRun = pending;
    pending = [];
    batch(() => { for (const callback of callbacksToRun) callback(elapsedMs); });
  };
  for (const entry of callbacks) {
    if (entry.batched) pending.push(entry.callback);
    else {
      if (pending.length) flush();
      entry.callback(elapsedMs);
    }
  }
  flush();
};

/** Internal: runs each frame's callbacks inside `batcher(run)`; index.js installs React's. */
export function setFrameBatcher(batcher) {
  batch = batcher;
}

/**
 * Internal: call `callback(elapsedMs)` every frame until the returned function is called.
 * @param {(elapsedMs: number) => void} callback
 */
export function onFrame(callback) {
  return subscribe(callback, true);
}

/** Internal: call outside the React frame batch so synchronous work can be measured. */
export function onFrameUnbatched(callback) {
  return subscribe(callback, false);
}

function subscribe(callback, batched) {
  const entry = {callback, batched};
  callbacks.add(entry);
  return () => { callbacks.delete(entry); };
}
