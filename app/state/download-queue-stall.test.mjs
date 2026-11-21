import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createDownloadQueue} = await import('./download-queue.js');

// Issue #77: DataNodes and FileKeeper's dlproxy.uk gateway answers range after range with HTTP 503
// while it wants a pause. The download then sits at 0 MB/s, and only Pause and Resume brought it
// back; the app restarts such a transfer by itself once nothing has been received for the stall
// time. A retried range drops `received` back, so only a new high counts as progress — otherwise
// every retry reset the wait and the restart never came (Narci115's app.log).
const ROOT = '/data';
const DESTINATION = ROOT + '/downloads/packages/game.pkg';

function console_() {
  const files = new Map();
  const dirs = new Set([ROOT, ROOT + '/downloads', ROOT + '/downloads/packages']);
  const fs = {
    exists: path => dirs.has(path) || files.has(path),
    stat: path => dirs.has(path) ? {isDirectory: true, device: 'dev1', inode: 'root', modified: 0} :
      files.has(path) ? {isFile: true, size: String(files.get(path)).length, modified: 0} : null,
    diskUsage: () => ({free: 1024 ** 4}),
    mkdir: path => { dirs.add(path); },
    writeFile: (path, data) => { files.set(path, data); },
    readFile: path => files.get(path) ?? '',
    rename: (source, target) => { if (files.has(source)) { files.set(target, files.get(source)); files.delete(source); } },
    readDir: () => [],
    remove: path => { files.delete(path); },
    removeAsync: async path => { files.delete(path); dirs.delete(path); },
  };
  return {files, dirs, fs};
}

function transfer(start) {
  let settle, refuse;
  const done = new Promise((resolve, reject) => { settle = resolve; refuse = reject; });
  let timer = null;
  const task = {
    done,
    snapshot: {state: 'downloading'},
    subscribe(listener) {
      timer = start(listener, () => { clearInterval(timer); settle({written: 1000}); });
      return () => { clearInterval(timer); };
    },
    cancel() { clearInterval(timer); refuse(new Error('download cancelled by the test')); },
  };
  return task;
}

function boot(machine, enqueue, {stallMs = 120} = {}) {
  const formats = {artifact: (release, where) => ({
    directory: where + '/downloads/packages',
    destination: where + '/downloads/packages/' + release.filename,
    nextAction: 'installer-required',
  })};
  return createDownloadQueue({
    fs: machine.fs, downloads: {enqueue}, formats, dataDir: ROOT, platform: 'desktop', stallMs,
    notifications: {show() {}}, power: {keepAwake() {}},
    sources: {resolve: async () => ({url: 'https://tunnel1.dlproxy.uk/file'})},
  });
}

const release = url => ({id: 'source-1', filename: 'game.pkg', url, format: 'pkg', sizeBytes: 1000});
const game = {id: 'CUSA00001', title: 'Demo'};

async function settled(queue, id, states, until = 4000) {
  for (const end = Date.now() + until; Date.now() < end;) {
    const job = queue.snapshot().find(item => item.id === id);
    if (states.includes(job?.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Queue did not settle: ' + JSON.stringify(queue.snapshot().find(item => item.id === id)));
}

test('a gateway that only retries ranges is restarted instead of sitting at 0 MB/s', async () => {
  const machine = console_();
  let transfers = 0;
  const enqueue = () => transfer((emit, finish) => {
    if (++transfers === 1) {
      // A 503 for every range: `received` falls back to 0 and climbs to 100 again, never further.
      return setInterval(() => emit({state: 'downloading', received: Date.now() % 2 ? 100 : 0, completedBytes: 0, total: 1000}), 5).unref();
    }
    let received = 0;
    return setInterval(() => {
      received += 100;
      if (received >= 1000) finish();
      else emit({state: 'downloading', received, completedBytes: 0, total: 1000});
    }, 5).unref();
  });
  const queue = boot(machine, enqueue);
  const id = queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
  const job = await settled(queue, id, ['installer-required', 'failed']);
  assert.equal(job.state, 'installer-required', job.error);
  assert.equal(transfers, 2);
});

test('a transfer that keeps receiving is never restarted', async () => {
  const machine = console_();
  let transfers = 0;
  const enqueue = () => transfer((emit, finish) => {
    transfers++;
    let received = 0;
    return setInterval(() => {
      received += 100;
      if (received >= 1000) finish();
      else emit({state: 'downloading', received, completedBytes: 0, total: 1000});
    }, 10).unref();
  });
  const queue = boot(machine, enqueue, {stallMs: 120});
  const id = queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
  const job = await settled(queue, id, ['installer-required', 'failed']);
  assert.equal(job.state, 'installer-required', job.error);
  assert.equal(transfers, 1);
});

test('a source that is not the gateway waits out a quiet patch', async () => {
  const machine = console_();
  let transfers = 0;
  const enqueue = () => {
    transfers++;
    return transfer(() => setInterval(() => {}, 1000).unref());
  };
  const queue = boot(machine, enqueue, {stallMs: 60});
  const id = queue.enqueue(game, release('https://archive.org/download/x/game.pkg'), ROOT);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(transfers, 1);
  assert.notEqual(queue.snapshot().find(item => item.id === id).state, 'failed');
  queue.pause(id);
});

// Elefantex's app.log: FileKeeper's edge01.fetchio.cc gateway sends a few seconds, then answers 503
// with Retry-After 60, again and again. No gap reaches the stall time, yet the download is idle most
// of the time; that counts as a stall too.
test('a gateway that sends in short bursts between long waits is restarted', async () => {
  const machine = console_();
  let transfers = 0;
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    const enqueue = () => transfer((emit, finish) => {
      let received = 0;
      if (++transfers === 1) {
        const start = Date.now();
        // Bytes for 20 ms of every 150: each wait is well under the stall time, and together they
        // are most of it. Timed by the clock, since timers on some systems tick every 15 ms.
        return setInterval(() => {
          if ((Date.now() - start) % 150 < 20) received += 10;
          emit({state: 'downloading', received, completedBytes: 0, total: 1000});
        }, 5).unref();
      }
      return setInterval(() => {
        received += 100;
        if (received >= 1000) finish();
        else emit({state: 'downloading', received, completedBytes: 0, total: 1000});
      }, 5).unref();
    });
    // DataNodes: FileKeeper's own link is asked for again sooner (the tests below).
    const queue = boot(machine, enqueue, {stallMs: 300});
    const id = queue.enqueue(game, release('https://datanodes.to/abc123/game.pkg'), ROOT);
    const job = await settled(queue, id, ['installer-required', 'failed']);
    assert.equal(job.state, 'installer-required', job.error);
  } finally {
    console.log = original;
  }
  assert.equal(transfers, 2);
  assert.ok(lines.some(line => line.includes('in bursts and waits') && line.includes('restart 1 of 10')), lines.join('\n'));
});

// FileKeeper's form hands out a new link after five seconds, and its gateway's 503 asks for a minute:
// a few seconds of nothing ask for the new link, and app.log says whether it brought the bytes back.
function fileKeeperRun(secondFlows) {
  const machine = console_();
  let transfers = 0, resolved = 0;
  const lines = [];
  const enqueue = () => transfer((emit, finish) => {
    let received = 0;
    const flowing = ++transfers > 1 && secondFlows;
    return setInterval(() => {
      if (flowing || received < 50) received += 50;
      if (received >= 1000) finish();
      else emit({state: 'downloading', received, completedBytes: 0, total: 1000});
    }, 5).unref();
  });
  const queue = createDownloadQueue({
    fs: machine.fs, downloads: {enqueue}, dataDir: ROOT, platform: 'desktop', stallMs: 300,
    formats: {artifact: (item, where) => ({directory: where + '/downloads/packages', destination: where + '/downloads/packages/' + item.filename, nextAction: 'installer-required'})},
    notifications: {show() {}}, power: {keepAwake() {}},
    sources: {resolve: async () => { resolved++; return {url: 'https://edge01.fetchio.cc/f/token' + resolved}; }},
  });
  return {queue, lines, counts: () => ({transfers, resolved})};
}

test('a quiet FileKeeper gateway gets a new link at once, and the log says it helped', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  let run;
  try {
    run = fileKeeperRun(true);
    const id = run.queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
    const job = await settled(run.queue, id, ['installer-required', 'failed']);
    assert.equal(job.state, 'installer-required', job.error);
  } finally {
    console.log = original;
  }
  assert.deepEqual(run.counts(), {transfers: 2, resolved: 2});
  assert.ok(lines.some(line => line.includes("a new link instead of waiting its minute out (1 of 30)")), lines.join('\n'));
  assert.ok(lines.some(line => line.includes('the new link brought it back')), lines.join('\n'));
});

test('a new link that brings nothing back either is asked for once, then the gateway is waited out', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  let run, id;
  try {
    run = fileKeeperRun(false);
    id = run.queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
    for (const until = Date.now() + 3000; Date.now() < until && !lines.some(line => line.includes('did not bring it back')); )
      await new Promise(resolve => setTimeout(resolve, 10));
  } finally {
    console.log = original;
    run?.queue.pause(id);
  }
  assert.ok(lines.some(line => line.includes('a new link did not bring it back; waiting')), lines.join('\n'));
  assert.equal(lines.filter(line => line.includes('a new link instead of waiting')).length, 1);
});
