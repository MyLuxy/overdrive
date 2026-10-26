import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createDownloadQueue} = await import('./download-queue.js');

// A torrent release is fetched by the engine the app carries: no external client, WebUI or debrid
// service takes part. These tests drive the queue against a stand-in engine.
const ROOT = '/mnt/usb0';
const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef&tr=udp%3A%2F%2Ftracker.example%3A6969';

function console_() {
  const files = new Map();
  const dirs = new Set(['/data', ROOT]);
  const fs = {
    exists: path => dirs.has(path) || files.has(path),
    stat: path => dirs.has(path) ? {isDirectory: true, device: 'dev1', inode: 'root', modified: 0} :
      files.has(path) ? {isFile: true, size: files.get(path)?.size ?? 4096, modified: 0} : null,
    diskUsage: () => ({free: 1024 ** 4}),
    mkdir: path => { dirs.add(path); },
    writeFile: (path, data) => { files.set(path, data); },
    readFile: path => files.get(path) ?? '',
    rename: (source, target) => { if (files.has(source)) { files.set(target, files.get(source)); files.delete(source); } },
    readDir: () => [],
    remove: path => { files.delete(path); },
    removeAsync: async path => { files.delete(path); dirs.delete(path); },
  };
  return {files, dirs, fs, fetched: []};
}

// One download() call, controllable from the test: push progress, finish or stop.
function engineHarness() {
  const requests = [];
  const tasks = [];
  const torrents = {
    supported: true,
    setSeeding() {},
    download(options) {
      const listeners = new Set();
      let resolve, reject;
      const done = new Promise((res, rej) => { resolve = res; reject = rej; });
      const task = {
        done,
        listeners,
        cancelled: false,
        snapshot: {state: 'starting'},
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        push(progress) {
          Object.assign(task.snapshot, progress);
          for (const listener of listeners) listener(progress);
        },
        complete() { resolve({written: 0}); },
        fail(message = 'engine failed') { reject(new Error(message)); },
        cancel() { task.cancelled = true; reject(new Error('cancelled')); },
      };
      requests.push(options);
      tasks.push(task);
      return task;
    },
  };
  return {torrents, requests, tasks};
}

function boot(machine, harness, {seeding = () => true} = {}) {
  const formats = {artifact: (release, where) => ({
    directory: `${where}/downloads/packages`,
    destination: `${where}/downloads/packages/${release.filename}`,
    nextAction: 'installer-required',
  })};
  const downloads = {
    enqueue({url, destination}) {
      machine.fetched.push(url);
      machine.files.set(destination, 'd8:announce12:http://x/ann4:infod...');
      return {done: Promise.resolve({written: 33}), snapshot: {state: 'completed'}, subscribe: () => () => {}, cancel() {}};
    },
  };
  return createDownloadQueue({
    fs: machine.fs, downloads, formats, dataDir: '/data', platform: 'desktop',
    notifications: {show() {}}, power: {keepAwake() {}},
    sources: {resolve: async release => ({url: release.url})},
    torrents: harness.torrents,
    seeding,
  });
}

async function until(predicate, what) {
  for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function settled(queue, id, states) {
  return until(() => {
    const job = queue.snapshot().find(item => item.id === id);
    return job && states.includes(job.state) ? job : null;
  }, `job ${id} to be ${states.join('/')}`);
}

const released = () => ({
  id: 'r0123456789a', filename: 'Game.pkg', format: 'pkg', flow: 'torrent',
  url: MAGNET, magnet: MAGNET, sizeBytes: 900,
});

test('a magnet release downloads through the app own engine', async () => {
  const machine = console_();
  const harness = engineHarness();
  const queue = boot(machine, harness);
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, released(), ROOT);

  const options = await until(() => harness.requests[0], 'the engine to start');
  assert.deepEqual(options, {
    magnet: MAGNET,
    torrentPath: '',
    destination: `${ROOT}/downloads/packages/Game.pkg`,
    wanted: 'Game.pkg',
    seeding: true,
  });
  assert.deepEqual(machine.fetched, [], 'a magnet needs no .torrent file');

  harness.tasks[0].push({
    state: 'downloading', size: 900, verified: 300, downloaded: 400, bytesPerSecond: 2048,
    peers: 3, seeds: 2, leechers: 1, swarmSeeds: 12, swarmLeechers: 4, uploaded: 64, seeding: false,
  });
  // The job carries the engine's own numbers: what the health display reads.
  const job = await until(() => {
    const found = queue.snapshot().find(item => item.id === id);
    return found?.state === 'downloading' && found.written === 300 ? found : null;
  }, 'the engine progress to reach the job');
  assert.equal(job.total, 900);
  assert.equal(job.received, 400);
  assert.equal(job.bytesPerSecond, 2048);
  assert.equal(job.peers, 3);
  assert.equal(job.seeds, 2);
  assert.equal(job.leechers, 1);
  assert.equal(job.swarmSeeds, 12);
  assert.equal(job.swarmLeechers, 4);
  assert.equal(job.uploaded, 64);
  assert.equal(job.seeding, false);

  harness.tasks[0].push({state: 'downloading', verified: 900, downloaded: 900, bytesPerSecond: 0});
  harness.tasks[0].complete();
  const done = await settled(queue, id, ['installer-required', 'failed']);
  assert.equal(done.state, 'installer-required', done.error);
  assert.equal(done.written, 900);
});

test('a .torrent URL is fetched beside the destination and handed to the engine', async () => {
  const machine = console_();
  const harness = engineHarness();
  const queue = boot(machine, harness);
  const release = {
    id: 'r-fedcba9876', filename: 'Game.pkg', format: 'pkg', flow: 'torrent',
    url: 'https://download.ps4ar.com/Game.torrent', torrentUrl: 'https://download.ps4ar.com/Game.torrent',
    torrentPage: 'https://www.mediafire.com/file/abc/Game', sizeBytes: 900,
  };
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, release, ROOT);

  const options = await until(() => harness.requests[0], 'the engine to start');
  const torrentPath = `${ROOT}/downloads/packages/Game.pkg.torrent`;
  assert.deepEqual(machine.fetched, ['https://download.ps4ar.com/Game.torrent'], 'the .torrent is downloaded, not parsed as text');
  assert.ok(machine.files.has(torrentPath), 'the .torrent lands beside its file');
  assert.deepEqual(options, {
    magnet: '',
    torrentPath,
    destination: `${ROOT}/downloads/packages/Game.pkg`,
    wanted: 'Game.pkg',
    seeding: true,
  });

  harness.tasks[0].push({state: 'downloading', verified: 900, downloaded: 900, size: 900});
  harness.tasks[0].complete();
  assert.equal((await settled(queue, id, ['installer-required', 'failed'])).state, 'installer-required');
});

test('pausing a torrent keeps its file and resuming continues where it stopped', async () => {
  const machine = console_();
  const harness = engineHarness();
  const queue = boot(machine, harness);
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, released(), ROOT);
  const destination = `${ROOT}/downloads/packages/Game.pkg`;
  await until(() => harness.requests[0], 'the engine to start');

  harness.tasks[0].push({state: 'downloading', verified: 300, downloaded: 400, size: 900});
  machine.files.set(destination, 'three hundred bytes');
  queue.pause(id);
  const paused = await settled(queue, id, ['paused', 'failed']);
  assert.equal(paused.state, 'paused', paused.error);
  assert.ok(machine.files.has(destination), 'pausing keeps the pieces already verified');

  queue.resume(id);
  await until(() => harness.requests[1], 'the engine to start again');
  assert.equal(harness.requests[1].magnet, MAGNET);
  assert.equal(harness.requests[1].destination, destination, 'the same file continues');

  harness.tasks[1].push({state: 'downloading', verified: 900, downloaded: 900, size: 900});
  harness.tasks[1].complete();
  assert.equal((await settled(queue, id, ['installer-required', 'failed'])).state, 'installer-required');
});

test('cancelling a torrent deletes its file, its piece sidecar and its .torrent', async () => {
  const machine = console_();
  const harness = engineHarness();
  const queue = boot(machine, harness);
  const release = {
    id: 'r-fedcba9876', filename: 'Game.pkg', format: 'pkg', flow: 'torrent',
    torrentUrl: 'https://download.ps4ar.com/Game.torrent', sizeBytes: 900,
  };
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, release, ROOT);
  const destination = `${ROOT}/downloads/packages/Game.pkg`;
  await until(() => harness.requests[0], 'the engine to start');
  harness.tasks[0].push({state: 'downloading', verified: 300, downloaded: 400, size: 900});
  machine.files.set(destination, 'three hundred bytes');
  machine.files.set(`${destination}.torrent-parts`, 'pieces');

  await queue.cancel(id);
  await until(() => !queue.snapshot().some(job => job.id === id), 'the cancelled job to leave the queue');
  assert.equal(machine.files.has(destination), false, 'the downloaded pieces go');
  assert.equal(machine.files.has(`${destination}.torrent-parts`), false, 'the piece sidecar goes');
  assert.equal(machine.files.has(`${destination}.torrent`), false, 'the .torrent it was read from goes');
});

test('a pasted magnet URL is recognised without a magnet field, and seeding follows the setting', async () => {
  const machine = console_();
  const harness = engineHarness();
  const queue = boot(machine, harness, {seeding: () => false});
  const release = {id: 'link-7', filename: 'Pasted.pkg', format: 'pkg', url: MAGNET, link: true};
  queue.enqueue({id: 'PPSA28000', title: 'Demo'}, release, ROOT);

  const options = await until(() => harness.requests[0], 'the engine to start');
  assert.equal(options.magnet, MAGNET);
  assert.equal(options.torrentPath, '');
  assert.equal(options.seeding, false, 'a player who turned seeding off is obeyed');
  assert.deepEqual(machine.fetched, []);
});

test('a completed torrent keeps seeding in the queue until the job is removed', async () => {
  const machine = console_();
  const harness = engineHarness();
  const queue = boot(machine, harness);
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, released(), ROOT);
  await until(() => harness.requests[0], 'the engine to start');
  const task = harness.tasks[0];

  task.push({state: 'completed', verified: 900, downloaded: 900, size: 900, seeding: true, uploaded: 0});
  task.complete();
  const done = await settled(queue, id, ['installer-required', 'failed']);
  assert.equal(done.state, 'installer-required', done.error);
  assert.equal(done.seeding, true, 'the row can show what it shares');
  assert.equal(task.listeners.size, 1, 'the queue keeps listening while it seeds');

  task.push({state: 'completed', uploaded: 8192, seeding: true});
  const sharing = await until(() => {
    const job = queue.snapshot().find(item => item.id === id);
    return job?.uploaded === 8192 ? job : null;
  }, 'the upload total to reach the row');
  assert.equal(sharing.seeding, true);

  await until(() => {
    queue.remove(id);
    return !queue.snapshot().some(job => job.id === id);
  }, 'the finished job to leave the queue');
  assert.equal(task.cancelled, true, 'removing the job stops its seeder');
  assert.equal(task.listeners.size, 0, 'and drops its subscription');
});

test('turning seeding off ends a finished torrent subscription and keeps the job', async () => {
  const machine = console_();
  const harness = engineHarness();
  const queue = boot(machine, harness);
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, released(), ROOT);
  await until(() => harness.requests[0], 'the engine to start');
  const task = harness.tasks[0];

  task.push({state: 'completed', verified: 900, downloaded: 900, size: 900, seeding: true, uploaded: 0});
  task.complete();
  await settled(queue, id, ['installer-required', 'failed']);
  assert.equal(task.listeners.size, 1);

  // What the engine publishes when the setting goes off: the file is complete, nothing is shared.
  task.push({state: 'completed', uploaded: 4096, seeding: false});
  await until(() => task.listeners.size === 0, 'the subscription to end');
  const kept = queue.snapshot().find(item => item.id === id);
  assert.equal(kept.state, 'installer-required', 'the job and its file stay');
  assert.equal(kept.seeding, false);
  assert.equal(kept.uploaded, 4096);
  assert.equal(task.cancelled, false, 'the engine stopped on its own');
});
