import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createDownloadQueue} = await import('./download-queue.js');

function harness({parts = false, inspections = [], extractError = null, supportsWorker = true, format = 'binary', acceptedPassword, archivePassword} = {}) {
  const files = new Map();
  const dirs = new Set(['/data']);
  const root = '/data', filename = parts ? 'multi.rar' : format === 'binary' ? 'mystery.binary' : 'mystery.' + format;
  const reads = [], extractions = [];
  let syncCalls = 0;
  const fs = {
    exists: path => dirs.has(path) || files.has(path),
    stat: path => dirs.has(path) ? {isDirectory: true, device: 'dev', inode: 'root', modified: 0} :
      files.has(path) ? {isFile: true, size: 4096, modified: 0} : null,
    diskUsage: () => ({free: 1024 ** 4}),
    mkdir: path => { dirs.add(path); },
    writeFile: (path, data) => { files.set(path, data); },
    readFile: path => files.get(path) ?? '',
    rename: (source, target) => { if (files.has(source)) { files.set(target, files.get(source)); files.delete(source); } },
    readDir: () => [],
    removeAsync: async path => { files.delete(path); dirs.delete(path); },
  };
  const downloads = {
    enqueue({destination}) {
      files.set(destination, 'game bytes');
      return {
        done: Promise.resolve({written: 4096}),
        snapshot: {state: 'completed'},
        subscribe: () => () => {},
        cancel: () => {},
      };
    },
  };
  const archives = {
    streams: true,
    supportsAsyncInspection: supportsWorker,
    inspect: () => { syncCalls++; throw new Error('synchronous read used'); },
    async inspectAsync(paths) {
      reads.push(paths[0]);
      const next = inspections.shift() ?? new Error('native worker unavailable');
      if (next instanceof Error) throw next;
      return next;
    },
    extract(options) {
      extractions.push(options);
      const error = extractError || (acceptedPassword !== undefined && options.password !== acceptedPassword
        ? new Error('Incorrect RAR5 archive password.') : null);
      if (error) return {
        done: Promise.reject(error), subscribe: () => () => {}, cancel: () => {},
      };
      return {
        done: Promise.resolve({artifacts: []}), subscribe: () => () => {}, cancel: () => {},
      };
    },
  };
  const formats = { artifact: (release, where) => ({
    directory: where + '/downloads/files',
    destination: where + '/downloads/files/' + release.filename,
    nextAction: 'downloaded',
  }) };
  const queue = createDownloadQueue({
    fs, downloads, archives, formats,
    dataDir: root, platform: 'desktop',
    notifications: {show() {}}, power: {keepAwake() {}},
    sources: {resolve: async entry => ({url: entry.url || 'https://example.com/part'})},
  });
  const release = {
    id: 'source-1', filename, url: 'https://example.com/release', format,
    ...(archivePassword !== undefined && {archivePassword}),
    ...(parts && {parts: [1, 2].map(number => ({
      number,
      sources: [{url: 'https://example.com/part' + number}],
    }))}),
  };
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, release, root);
  return {
    queue, id, files, reads, extractions,
    get syncCalls() { return syncCalls; },
  };
}

// By time, not turns: a finished "binary" download asks the worker again after two seconds.
async function completed(fixture) {
  for (const until = Date.now() + 10000; Date.now() < until;) {
    const job = fixture.queue.snapshot().find(item => item.id === fixture.id);
    if (['file-downloaded', 'extracted', 'failed'].includes(job?.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Queue did not settle');
}

test('a finished download of a declared format stays completed when its header worker fails', async () => {
  const fixture = harness({format: 'pkg'});
  const job = await completed(fixture);
  assert.equal(job.state, 'file-downloaded', job.error);
  assert.equal(job.error, '');
  assert.equal(fixture.files.has(job.downloadDestination), true);
  assert.equal(fixture.syncCalls, 0);
  assert.equal(fixture.reads.length, 1);
});

// A "binary" source is routed by its headers: one nothing can read fails with a reason instead of
// staying a ".binary" the console cannot use. The worker is asked twice, then the file is read here.
test('a finished binary download nothing can read fails with a reason, never as a .binary', async () => {
  const fixture = harness();
  const job = await completed(fixture);
  assert.equal(job.state, 'failed');
  assert.match(job.error, /Could not read the downloaded file/);
  assert.equal(fixture.reads.length, 2);
  assert.equal(fixture.syncCalls, 1);
});

test('without worker support a finished binary download is read here, once complete', async () => {
  const fixture = harness({supportsWorker: false});
  const job = await completed(fixture);
  assert.equal(job.state, 'failed');
  assert.equal(fixture.reads.length, 0);
  assert.equal(fixture.syncCalls, 1);
});

test('a verified header refusal still fails a completed download', async () => {
  const fixture = harness({inspections: [{kind: 'rar', refusal: 'RAR dictionary too large'}]});
  const job = await completed(fixture);
  assert.equal(job.state, 'failed');
  assert.match(job.error, /RAR dictionary too large/);
  assert.equal(fixture.syncCalls, 0);
});

test('multi-volume download falls back from unavailable streaming inspection', async () => {
  const fixture = harness({parts: true});
  const job = await completed(fixture);
  assert.equal(job.state, 'extracted', job.error);
  assert.equal(job.error, '');
  assert.equal(fixture.syncCalls, 0);
  assert.equal(fixture.extractions.length, 1);
  assert.equal(fixture.extractions[0].stream, undefined);
  assert.equal(fixture.reads.length, 2, 'first-part and streaming checks both ran');
});

test('worker failure on completed first volume does not stop normal extraction', async () => {
  const fixture = harness({
    parts: true,
    inspections: [new Error('worker crashed'), {kind: 'zip', refusal: ''}],
  });
  const job = await completed(fixture);
  assert.equal(job.state, 'extracted', job.error);
  assert.equal(fixture.extractions.length, 1);
  assert.equal(fixture.syncCalls, 0);
});

test('real header refusals still stop the affected archive before extraction', async () => {
  const fixture = harness({
    parts: true,
    inspections: [{kind: 'rar', refusal: 'RAR dictionary too large'}],
  });
  const job = await completed(fixture);
  assert.equal(job.state, 'failed');
  assert.match(job.error, /RAR dictionary too large/);
  assert.equal(fixture.extractions.length, 0);
  assert.equal(fixture.syncCalls, 0);
});

test('extraction failure is not swallowed by optional header checks', async () => {
  const fixture = harness({parts: true, extractError: new Error('corrupt archive')});
  const job = await completed(fixture);
  assert.equal(job.state, 'failed');
  assert.match(job.error, /corrupt archive/);
});

for (const password of [
  '(DLPSGAME.COM)', 'pspkg.com', 'Th3B4tm4nWhoL4ugh$', 'DLPSGAME.COM_37629',
  'Kupo! Kupo! Kupo!', 'www.[DLPSGAME.COM]', 'Darksoftware', 'Superpsx',
]) {
  test(`an archive without password metadata retries the published password ${password}`, async () => {
    const fixture = harness({parts: true, acceptedPassword: password});
    const job = await completed(fixture);
    assert.equal(job.state, 'extracted', job.error);
    assert.equal(fixture.extractions[0].password, undefined);
    assert.equal(fixture.extractions.at(-1).password, password);
    assert.equal(fixture.extractions.filter(attempt => attempt.password === password).length, 1);
    for (const previous of ['DLPSGAME.COM', '[DLPSGAME.COM]', 'www.DLPSGAME.COM', 'SuperPSX', 'downloadgameps3.com', 'hako'])
      assert(fixture.extractions.some(attempt => attempt.password === previous), `Existing password lost: ${previous}`);
  });
}

test('a published password in release metadata is tried first with punctuation intact', async () => {
  const fixture = harness({parts: true, acceptedPassword: '(DLPSGAME.COM)', archivePassword: '(DLPSGAME.COM)'});
  const job = await completed(fixture);
  assert.equal(job.state, 'extracted', job.error);
  assert.equal(fixture.extractions.length, 1);
  assert.equal(fixture.extractions[0].password, '(DLPSGAME.COM)');
});
