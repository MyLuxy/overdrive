import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createDownloadQueue} = await import('./download-queue.js');

// A host that answers busy (HTTP 429 or a 5xx) is asked again by itself, as many times as the player
// chose in Settings. The wait doubles each time; once the tries are used up the download stays failed
// with Retry, as before. Anything else (a dead link, a refusal) fails at once.
const ROOT = '/data';

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

function transfer() {
  let settle, refuse;
  const done = new Promise((resolve, reject) => { settle = resolve; refuse = reject; });
  let received = 0;
  const timer = setInterval(() => {
    received += 100;
    if (received >= 1000) { clearInterval(timer); settle({written: 1000}); }
  }, 5);
  timer.unref();
  const task = {
    done,
    snapshot: {state: 'downloading'},
    subscribe() { return () => {}; },
    cancel() { clearInterval(timer); refuse(new Error('download cancelled by the test')); },
  };
  return task;
}

function boot(machine, {resolve, retries = () => 0, retryMs = 50} = {}) {
  return createDownloadQueue({
    fs: machine.fs, downloads: {enqueue: () => transfer()}, dataDir: ROOT, platform: 'desktop',
    stallMs: 60000,
    formats: {artifact: (release, where) => ({
      directory: where + '/downloads/packages',
      destination: where + '/downloads/packages/' + release.filename,
      nextAction: 'installer-required',
    })},
    notifications: {show() {}}, power: {keepAwake() {}},
    sources: {resolve},
    retries, retryMs,
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

test('a busy server is asked again by itself and the download goes on', async () => {
  const machine = console_();
  let calls = 0;
  const queue = boot(machine, {
    retries: () => 2,
    resolve: async () => {
      if (++calls === 1) throw new Error('Provider HTTP 503.');
      return {url: 'https://source.example/file'};
    },
  });
  const id = queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
  const job = await settled(queue, id, ['installer-required', 'failed']);
  assert.equal(job.state, 'installer-required', job.error);
  assert.equal(calls, 2);
});

test('a busy server retried up to the count chosen, then the download stays failed', async () => {
  const machine = console_();
  let calls = 0;
  const queue = boot(machine, {
    retries: () => 1,
    retryMs: 20,
    resolve: async () => { calls++; throw new Error('Provider HTTP 503.'); },
  });
  const id = queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
  const job = await settled(queue, id, ['installer-required', 'failed']);
  assert.equal(job.state, 'failed');
  assert.match(job.error, /HTTP 503/);
  // The first ask plus one automatic retry.
  assert.equal(calls, 2);
});

test('with retries off a busy server fails at once', async () => {
  const machine = console_();
  let calls = 0;
  const queue = boot(machine, {
    retries: () => 0,
    resolve: async () => { calls++; throw new Error('Provider HTTP 503.'); },
  });
  const id = queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
  const job = await settled(queue, id, ['failed']);
  assert.equal(job.state, 'failed');
  assert.equal(calls, 1);
});

test('an error that is not a busy server is not retried', async () => {
  const machine = console_();
  let calls = 0;
  const queue = boot(machine, {
    retries: () => 3,
    resolve: async () => { calls++; throw new Error('Invalid HTTP URL.'); },
  });
  const id = queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
  const job = await settled(queue, id, ['failed']);
  assert.equal(job.state, 'failed');
  assert.equal(calls, 1);
});

test('"always" keeps asking without ever failing, past the old largest count', async () => {
  const machine = console_();
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  let calls = 0, queue, id, job;
  try {
    queue = boot(machine, {
      retries: () => 'always',
      retryMs: 5,
      resolve: async () => { calls++; throw new Error('Provider HTTP 429.'); },
    });
    id = queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
    // Five automatic tries would exhaust every fixed count the page offers but the last.
    for (const end = Date.now() + 6000; Date.now() < end && calls < 6;) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    job = queue.snapshot().find(item => item.id === id);
    assert.ok(calls >= 6, `it kept asking: ${calls}`);
    assert.notEqual(job.state, 'failed');
    assert.ok(!job.message?.includes('Infinity'), job.message);
    assert.ok(lines.some(line => line.includes('(always)')), lines.join('\n'));
  } finally {
    console.log = original;
  }
  queue.pause(id);
  const paused = await settled(queue, id, ['paused']);
  assert.equal(paused.state, 'paused');
});

test('a waiting retry is queued with a countdown, and Pause ends the wait', async () => {
  const machine = console_();
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  let calls = 0, queue, id;
  try {
    queue = boot(machine, {
      retries: () => 2,
      retryMs: 60000,
      resolve: async () => { calls++; throw new Error('Provider HTTP 429.'); },
    });
    id = queue.enqueue(game, release('https://filekeeper.net/file/abc'), ROOT);
    // The job starts queued: wait for the failure to put it back there with its countdown.
    let waiting;
    for (const end = Date.now() + 4000; Date.now() < end && waiting?.busyRetries !== 1;) {
      await new Promise(resolve => setTimeout(resolve, 5));
      waiting = queue.snapshot().find(item => item.id === id);
    }
    assert.equal(waiting.state, 'queued');
    assert.equal(waiting.busyRetries, 1);
    // The row's note is the retry message: the Node test has no locale loaded, so only its presence.
    assert.ok(waiting.message, 'the row says it waits');
    assert.ok(lines.some(line => line.includes('retry 1 of 2 in 60 s')), lines.join('\n'));
  } finally {
    console.log = original;
  }
  queue.pause(id);
  const paused = await settled(queue, id, ['paused']);
  assert.equal(paused.message, undefined);
  assert.equal(calls, 1);
});
