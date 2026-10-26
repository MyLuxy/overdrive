// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import test from 'node:test';
import {acquireImage, Archives, BrowserCapture, Controller, Downloads, FileSystem, Http, LocalNetwork, Power, Sound, Torrents} from './native.js';
import {setFrameBatcher} from './frame.js';

test('native network tasks deliver progress, release listeners and stop polling', async () => {
  let tick;
  let clears = 0;
  let snapshots = [];
  const cancelled = [];
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  globalThis.setInterval = callback => { tick = callback; return 1; };
  globalThis.clearInterval = () => { clears++; };
  globalThis.__ps5ReactNative = {network: {
    download: () => 1, request: () => 2,
    cancel: id => cancelled.push(id), poll: () => snapshots, version: () => 'fixture',
  }};
  try {
    const task = Downloads.enqueue({url: 'https://example.com/file', destination: '/download0/file'});
    const states = [];
    const unsubscribe = task.subscribe(progress => states.push(progress.state));
    snapshots = [{id: 1, state: 'downloading', body: 'must not reach progress', written: 12}];
    tick();
    assert.equal(task.snapshot.destination, '/download0/file');
    assert.equal('body' in task.snapshot, false);
    unsubscribe();
    snapshots = [{id: 1, state: 'completed', written: 24}];
    tick();
    assert.equal((await task.done).written, 24);
    assert.deepEqual(states, ['queued', 'downloading']);
    assert.equal(clears, 1);
    task.cancel();
    assert.deepEqual(cancelled, []);
    const aborted = Downloads.enqueue({url: 'https://example.com/file', destination: '/download0/file'});
    aborted.cancel();
    snapshots = [{id: 1, state: 'cancelled'}];
    tick();
    await assert.rejects(aborted.done, error => error.name === 'AbortError' && error.message.includes('/download0/file'));
    assert.deepEqual(cancelled, [1]);
    const response = Http.request('https://example.com/json');
    snapshots = [{id: 2, state: 'completed', status: 404, url: 'https://example.com/final', headers: {'content-type': 'application/json'}, body: '{"value":42}'}];
    tick();
    const result = await response;
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.url, 'https://example.com/final');
    assert.equal(result.headers['content-type'], 'application/json');
    assert.equal(Object.isFrozen(result.headers), true);
    assert.deepEqual(await result.json(), {value: 42});
    assert.equal(await result.text(), '{"value":42}');
    assert.equal(clears, 3);
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    delete globalThis.__ps5ReactNative;
  }
});

test('a completed torrent keeps polling while it seeds and ends on the snapshot that stops seeding', async () => {
  let tick;
  let clears = 0;
  let snapshots = [];
  const started = [];
  const cancelled = [];
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  globalThis.setInterval = callback => { tick = callback; return 1; };
  globalThis.clearInterval = () => { clears++; };
  globalThis.__ps5ReactNative = {torrent: {
    start: options => { started.push(options); return 7; },
    cancel: id => cancelled.push(id), poll: () => snapshots, setSeeding: () => {},
  }};
  try {
    const task = Torrents.download({magnet: 'magnet:?xt=urn:btih:0123&tr=udp%3A%2F%2Ft.example%3A6969',
      destination: '/download0/Game.pkg', seeding: true});
    assert.equal(started[0].seeding, true);
    const seen = [];
    task.subscribe(progress => seen.push([progress.state, progress.seeding === true, progress.uploaded ?? 0]));
    snapshots = [{id: 7, state: 'completed', downloaded: 100, uploaded: 0, seeding: true}];
    tick();
    // The download is over, so `done` settles; the engine is still serving pieces.
    assert.equal((await task.done).uploaded, 0);
    assert.equal(clears, 0);
    snapshots = [{id: 7, state: 'completed', downloaded: 100, uploaded: 4096, seeding: true}];
    tick();
    assert.equal(task.snapshot.uploaded, 4096);
    assert.equal(clears, 0);
    snapshots = [{id: 7, state: 'completed', downloaded: 100, uploaded: 8192, seeding: false}];
    tick();
    assert.equal(clears, 1);
    assert.deepEqual(seen, [['queued', false, 0], ['completed', true, 0],
      ['completed', true, 4096], ['completed', false, 8192]]);
    // The job is gone from the poll, so there is nothing left to cancel.
    task.cancel();
    assert.deepEqual(cancelled, []);
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    delete globalThis.__ps5ReactNative;
  }
});

test('removeAsync resolves once the worker removed the path and rejects with the path and system error', async () => {
  let tick;
  let snapshots = [];
  const started = [];
  const originalInterval = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  globalThis.setInterval = callback => { tick = callback; return 1; };
  globalThis.clearInterval = () => {};
  globalThis.__ps5ReactNative = {
    fs: {removeAsync: path => {
      if (path.includes('..')) throw new Error(`fs.removeAsync ${path}: Path is not allowed`);
      return started.push(path);
    }},
    removals: {poll: () => snapshots},
  };
  try {
    const removed = FileSystem.removeAsync('/download0/game');
    const refused = FileSystem.removeAsync('/download0/locked');
    assert.deepEqual(started, ['/download0/game', '/download0/locked']);
    snapshots = [{id: 1, state: 'removing', error: ''}, {id: 2, state: 'queued', error: ''}];
    tick();
    snapshots = [{id: 1, state: 'completed', error: ''}, {id: 2, state: 'failed', error: 'Permission denied'}];
    tick();
    assert.equal(await removed, undefined);
    await assert.rejects(refused, {message: 'fs.removeAsync /download0/locked: Permission denied'});
    await assert.rejects(FileSystem.removeAsync('/download0/../x'), /Path is not allowed/);
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClear;
    delete globalThis.__ps5ReactNative;
  }
});

test('remote images poll only while loads are pending and release every reference', () => {
  const released = [];
  let finished = [];
  let polls = 0;
  globalThis.__ps5ReactNative = {image: {
    load: (uri, width, height) => (width === 10
      ? {id: 7, state: 'ready', name: '@image:7', width: 10, height: 10, error: ''}
      : {id: 8, state: 'loading', name: '', width: 0, height: 0, error: ''}),
    release: id => released.push(id),
    poll: () => { polls++; const out = finished; finished = []; return out; },
  }};
  const seen = [];
  const releaseReady = acquireImage('https://example.com/a.jpg', 10, 10, 0, false, result => seen.push(result.state));
  globalThis.__ps5ReactFrame(16);
  assert.equal(polls, 0, 'a cached image needs no polling');
  const releaseLoading = acquireImage('https://example.com/b.jpg', 20, 20, 0, false, result => seen.push(result.state));
  globalThis.__ps5ReactFrame(16);
  finished = [{id: 8, state: 'ready', name: '@image:8', width: 20, height: 20, error: ''}];
  globalThis.__ps5ReactFrame(16);
  globalThis.__ps5ReactFrame(16);
  assert.equal(polls, 2, 'polling stops once nothing is pending');
  assert.deepEqual(seen, ['ready', 'loading', 'ready']);
  releaseReady();
  releaseLoading();
  assert.deepEqual(released, [7, 8]);
  globalThis.__ps5ReactFrame(16);
  globalThis.__ps5ReactFrame(16);
  assert.equal(polls, 3, 'a release polls once more so eviction can run');
  delete globalThis.__ps5ReactNative;
});

test('finished image loads arriving together are delivered across frames under a time budget', () => {
  const originalNow = performance.now;
  let clock = 0, polls = 0, nextId = 1, finished = [];
  performance.now = () => clock;
  globalThis.__ps5ReactNative = {image: {
    load: () => ({id: nextId++, state: 'loading', name: '', width: 0, height: 0, error: ''}),
    release: () => {},
    poll: () => { polls++; const out = finished; finished = []; return out; },
  }};
  try {
    let frame = [];
    const frames = [];
    const step = () => { globalThis.__ps5ReactFrame(16); frames.push(frame); frame = []; };
    // Each arrival costs what re-rendering its <Image> would: 1.5 ms, or 10 ms for id 6.
    const releases = new Map();
    for (let i = 1; i <= 9; i++) {
      releases.set(i, acquireImage(`https://example.com/${i}.jpg`, 20, 20, 0, false, result => {
        if (result.state === 'loading') return;
        frame.push(result.state === 'failed' ? `${result.id}:${result.error}` : result.id);
        clock += result.id === 6 ? 10 : 1.5;
      }));
    }
    releases.get(3)();
    finished = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id => (id === 9
      ? {id, state: 'failed', name: '', width: 0, height: 0, error: 'HTTP 404'}
      : {id, state: 'ready', name: `@image:${id}`, width: 20, height: 20, error: ''}));
    step();
    releases.get(5)();
    while (frames.length < 6) step();
    assert.deepEqual(frames.filter(frame => frame.length), [[1, 2, 4], [6], [7, 8, '9:HTTP 404']],
      'released ids are skipped for free, a slow arrival still lands, failures are delivered too');
    assert.equal(polls, 3, 'polling continues while results are queued and stops once all are delivered');
  } finally {
    performance.now = originalNow;
    delete globalThis.__ps5ReactNative;
  }
});

test('image listener commits are measured individually despite the frame batcher', () => {
  const originalNow = performance.now;
  let finished = [], clock = 0;
  const delivered = [];
  const deferredBatches = [];
  performance.now = () => clock;
  setFrameBatcher(run => deferredBatches.push(run));
  globalThis.__ps5ReactNative = {image: {
    load: () => ({id: 1, state: 'loading', name: '', width: 0, height: 0, error: ''}),
    release: () => {},
    poll: () => { const out = finished; finished = []; return out; },
  }};
  try {
    for (let id = 1; id <= 7; id++) acquireImage(`https://example.com/${id}.jpg`, 20, 20, 0, false, result => {
      if (result.state === 'ready') { delivered.push(id); clock += 3; }
    });
    finished = [{id: 1, state: 'ready', name: '@image:1', width: 20, height: 20, error: ''}];
    const batches = [];
    for (let frame = 0; frame < 4; frame++) {
      globalThis.__ps5ReactFrame(16);
      batches.push(delivered.length);
    }
    assert.deepEqual(batches, [2, 4, 6, 7], 'the next listener waits until the next frame after commits cross 4 ms');
    assert.deepEqual(delivered, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(deferredBatches.length, 4, 'listeners ran although no batch did; each frame still closes with one');
  } finally {
    setFrameBatcher(run => run());
    performance.now = originalNow;
    delete globalThis.__ps5ReactNative;
  }
});

test('Controller trigger effects map 0..1 onto the DualSense zones and steps', () => {
  const calls = [];
  globalThis.__ps5ReactNative = {pad: {setTriggerEffect: (...args) => calls.push(args)}};
  try {
    Controller.setTriggerResistance('l2', 0.75, 0.5);
    Controller.setTriggerResistance('both', 0.01);
    Controller.setTriggerResistance('r2', 0);
    assert.deepEqual(calls.splice(0), [[1, 1, 5, 6], [3, 1, 0, 1], [2, 0]], 'a weak resistance is one step, not off');
    Controller.setTriggerEffect('r2', {type: 'weapon', start: 0.25, end: 0.75, strength: 0.75});
    Controller.setTriggerEffect('r2', {type: 'weapon', start: 0, end: 0.05, strength: 1});
    Controller.setTriggerEffect('both', {type: 'weapon', start: 0.9, end: 1, strength: 0.5});
    Controller.setTriggerEffect('l2', {type: 'vibration', amplitude: 0.5, frequency: 40.4});
    Controller.setTriggerEffect('l2', {type: 'vibration', from: 1, amplitude: 0, frequency: 40});
    Controller.setTriggerEffect('both', {type: 'off'});
    assert.deepEqual(calls, [
      [2, 2, 2, 7, 6],
      [2, 2, 2, 3, 8], // zones the controller accepts: start 2..7, end start+1..8
      [3, 2, 7, 8, 4],
      [1, 3, 0, 4, 40],
      [1, 0],
      [3, 0],
    ]);
    assert.throws(() => Controller.setTriggerResistance('l1', 1), /setTriggerResistance: trigger must be/);
    assert.throws(() => Controller.setTriggerResistance('l2', 2), /must be 0\.\.1/);
    assert.throws(() => Controller.setTriggerResistance('l2', 0.5, NaN), /must be 0\.\.1/);
    assert.throws(() => Controller.setTriggerEffect('l2', {type: 'click'}), /setTriggerEffect: effect type must be/);
    assert.throws(() => Controller.setTriggerEffect('l2'), /effect type must be/);
    assert.throws(() => Controller.setTriggerEffect('l2', {type: 'weapon', start: 0.6, end: 0.4, strength: 1}), /start < end/);
    assert.throws(() => Controller.setTriggerEffect('l2', {type: 'vibration', amplitude: 1, frequency: 0}), /1\.\.255 Hz/);
    assert.throws(() => Controller.setTriggerEffect('l2', {type: 'resistance'}), /must be 0\.\.1/);
  } finally {
    delete globalThis.__ps5ReactNative;
  }
});

test('Controller.subscribe reads the pad once a frame for every listener and stops with the last', () => {
  let reads = 0;
  let state = {connected: true, leftX: 0, leftY: 0, rightX: 0, rightY: 0, l2: 0, r2: 0, buttons: []};
  globalThis.__ps5ReactNative = {pad: {state: () => { reads++; return state; }}};
  try {
    const a = [], b = [];
    const stopA = Controller.subscribe(event => a.push(event.type === 'trigger' ? `${event.trigger}=${event.value}` : `${event.type} ${event.button}`));
    const stopB = Controller.subscribe(event => b.push(event.type), {frames: true});
    reads = 0;
    state = {...state, r2: 0.7, buttons: ['r2', 'touchpad']};
    globalThis.__ps5ReactFrame(16);
    assert.equal(reads, 1, 'one read a frame, shared');
    assert.deepEqual(a, ['press r2', 'press touchpad', 'r2=0.7']);
    assert.deepEqual(b, ['press', 'press', 'trigger', 'frame']);
    stopA();
    stopA();
    globalThis.__ps5ReactFrame(16);
    assert.deepEqual(b.slice(4), ['frame']);
    stopB();
    reads = 0;
    globalThis.__ps5ReactFrame(16);
    assert.equal(reads, 0, 'no listener, no frame work');
  } finally {
    delete globalThis.__ps5ReactNative;
  }
});

test('Power.keepAwake passes a boolean to the host', () => {
  const calls = [];
  globalThis.__ps5ReactNative = {power: {keepAwake: enabled => calls.push(enabled)}};
  try {
    Power.keepAwake(true);
    Power.keepAwake(0);
    assert.deepEqual(calls, [true, false]);
  } finally {
    delete globalThis.__ps5ReactNative;
  }
});

test('Sound passes the name, volume and pan to the host and returns whether it started', () => {
  const calls = [];
  globalThis.__ps5ReactNative = {sound: {
    play: (name, volume, pan) => { calls.push(['play', name, volume, pan]); return name === 'tick'; },
    setVolume: volume => calls.push(['setVolume', volume]),
  }};
  try {
    assert.equal(Sound.play('tick'), true);
    assert.equal(Sound.play('page', {pan: -0.4}), false);
    Sound.play('tick', {volume: 0.5});
    Sound.setVolume(0);
    assert.deepEqual(calls, [['play', 'tick', 1, 0], ['play', 'page', 1, -0.4], ['play', 'tick', 0.5, 0],
      ['setVolume', 0]]);
  } finally {
    delete globalThis.__ps5ReactNative;
  }
});

test('archive and download task IDs are isolated while sharing the polling timer', async () => {
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let tick, networkSnapshots = [], archiveSnapshots = [];
  const cancelled = [];
  const extractions = [];
  globalThis.setInterval = callback => { tick = callback; return 1; };
  globalThis.clearInterval = () => {};
  globalThis.__ps5ReactNative = {
    network: {download: () => 1, poll: () => networkSnapshots, cancel: id => cancelled.push(`network:${id}`)},
    archives: {extract: (...args) => { extractions.push(args); return 1; }, poll: () => archiveSnapshots, cancel: id => cancelled.push(`archives:${id}`)},
  };
  try {
    const download = Downloads.enqueue({url: 'https://example.com/file', destination: '/download0/file'});
    const archive = Archives.extract({sources: ['/download0/file'], destination: '/download0/out', password: '[DLPSGAME.COM]'});
    assert.deepEqual(extractions, [[['/download0/file'], '/download0/out', 1024**4, '[DLPSGAME.COM]', false]]);
    assert.equal(Archives.streams, true);
    for (const password of [42, 'bad\0password', 'x'.repeat(1025)])
      assert.throws(() => Archives.extract({sources: ['/download0/file'], destination: '/download0/out', password}), /password/);
    assert.equal(extractions.length, 1);
    archive.cancel(); assert.deepEqual(cancelled, ['archives:1']);
    archiveSnapshots = [{id: 1, state: 'extracting', phase: 'finishing', written: 50, synced: 1, syncTotal: 3}]; tick();
    assert.deepEqual([archive.snapshot.phase, archive.snapshot.synced, archive.snapshot.syncTotal], ['finishing', 1, 3]);
    archiveSnapshots = [{id: 1, state: 'completed', written: 50, artifacts: ['game.ffpfsc']}]; tick();
    assert.deepEqual((await archive.done).artifacts, ['game.ffpfsc']);
    assert.equal(download.snapshot.state, 'queued');
    networkSnapshots = [{id: 1, state: 'completed', written: 100}]; tick();
    assert.equal((await download.done).written, 100);
  } finally {
    globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear;
    delete globalThis.__ps5ReactNative;
  }
});


test('browser capture delivers only its result and cancellation rejects as AbortError', async () => {
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let tick, snapshots = [], next = 1;
  const calls = [], cancelled = [];
  globalThis.setInterval = callback => { tick = callback; return 1; };
  globalThis.clearInterval = () => {};
  globalThis.__ps5ReactNative = {browser: {
    capture: (...args) => { calls.push(args); return next++; },
    poll: () => { const result = snapshots; snapshots = []; return result; },
    cancel: id => cancelled.push(id),
  }};
  try {
    const capture = BrowserCapture.capture({suffix: '/Game.pkg'});
    assert.deepEqual(calls, [['https://vikingfile.com/d/', '/Game.pkg', 180, [], false]]);
    const states = [];
    const off = capture.subscribe(snapshot => states.push(snapshot.state));
    snapshots = [{id: 1, state: 'capturing'}]; tick();
    const url = 'https://vikingfile.com/d/Ab01234567/Game.pkg';
    snapshots = [{id: 1, state: 'completed', url}]; tick();
    assert.equal((await capture.done).url, url);
    assert.deepEqual(states, ['queued', 'capturing', 'completed']); off();
    const second = BrowserCapture.capture({suffix: '/Other.pkg', timeoutSeconds: 30});
    second.cancel(); assert.deepEqual(cancelled, [2]);
    snapshots = [{id: 2, state: 'cancelled'}]; tick();
    await assert.rejects(second.done, {name: 'AbortError'});
  } finally {
    // Drain pending captures even if an assertion fails, so the shared timer cannot leak into the next test.
    snapshots = Array.from({length: next - 1}, (_, index) => ({id: index + 1, state: 'cancelled'}));
    tick?.();
    globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear;
    delete globalThis.__ps5ReactNative;
  }
});

test('a LAN broadcast resolves with its replies, and an abort cancels it', async () => {
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let tick, snapshots = [], next = 1;
  const calls = [], cancelled = [];
  globalThis.setInterval = callback => { tick = callback; return 1; };
  globalThis.clearInterval = () => {};
  globalThis.__ps5ReactNative = {lan: {
    broadcast: (...args) => { calls.push(args); return next++; },
    poll: () => { const result = snapshots; snapshots = []; return result; },
    cancel: id => cancelled.push(id),
  }};
  try {
    const found = LocalNetwork.broadcast({port: 7359, message: 'who is JellyfinServer?'});
    assert.deepEqual(calls, [[7359, 'who is JellyfinServer?', 1500, 16]]);
    snapshots = [{id: 1, state: 'completed', error: '', replies: [{address: '192.168.0.10', port: 7359, body: '{"Id":"a"}'}]}];
    tick();
    assert.deepEqual(await found, [{address: '192.168.0.10', port: 7359, text: '{"Id":"a"}'}]);

    const listeners = new Set();
    const signal = {aborted: false, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn)};
    const second = LocalNetwork.broadcast({port: 7359, message: 'who is EmbyServer?', timeoutMs: 800, signal});
    for (const listener of listeners) listener();
    assert.deepEqual(cancelled, [2]);
    snapshots = [{id: 2, state: 'cancelled', error: '', replies: []}];
    tick();
    await assert.rejects(second, {name: 'AbortError'});
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear;
    delete globalThis.__ps5ReactNative;
  }
});
