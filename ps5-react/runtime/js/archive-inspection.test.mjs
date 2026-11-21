// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import {Archives} from './native.js';

test('archive inspection reports whether the host has an asynchronous worker', async () => {
  let synchronous = 0;
  globalThis.__ps5ReactNative = {archives: {
    inspect: () => { synchronous++; return {kind: '7z', refusal: ''}; },
  }};
  try {
    assert.equal(Archives.supportsAsyncInspection, false);
    assert.deepEqual(await Archives.inspectAsync(['/data/game.7z']), {
      kind: '7z', refusal: '', waitedMs: 0, tookMs: 0,
    });
    assert.equal(synchronous, 1, 'the legacy API retains its existing compatibility behavior');
  } finally {
    delete globalThis.__ps5ReactNative;
  }
});

test('asynchronous archive inspection uses the worker and propagates worker errors', async () => {
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  let tick, snapshots = [], nextId = 1, synchronous = 0;
  const started = [];
  globalThis.setInterval = callback => { tick = callback; return 1; };
  globalThis.clearInterval = () => {};
  globalThis.__ps5ReactNative = {
    archives: {
      inspect: () => { synchronous++; return {kind: 'zip'}; },
      inspectAsync: sources => { started.push(sources); return nextId++; },
    },
    inspections: {poll: () => snapshots, cancel: () => {}},
  };
  try {
    assert.equal(Archives.supportsAsyncInspection, true);
    const result = Archives.inspectAsync(['/data/game.part']);
    assert.deepEqual(started, [['/data/game.part']]);
    snapshots = [{id: 1, state: 'completed', kind: 'rar', refusal: '', title: 'PPSA28000', waitedMs: 18, tookMs: 32}];
    tick();
    assert.deepEqual(await result, {kind: 'rar', refusal: '', title: 'PPSA28000', waitedMs: 18, tookMs: 32});

    const failed = Archives.inspectAsync(['/data/failed.part']);
    snapshots = [{id: 2, state: 'failed', error: 'disk unavailable'}];
    tick();
    await assert.rejects(failed, /disk unavailable/);
    assert.equal(synchronous, 0, 'failed inspections must not trigger the synchronous API');
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    delete globalThis.__ps5ReactNative;
  }
});
