import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createDownloadQueue} = await import('./download-queue.js');

// Issue #111: a .part an earlier session left behind makes the queue "adopt" it. Its checkpoint names
// another run, so the transfer fails at once with nothing written; Retry then refused with the same
// words for good. It now deletes that partial and starts the download over.
const ROOT = '/data';
const DESTINATION = ROOT + '/downloads/files/game.pkg';

function console_() {
  const files = new Map();
  const dirs = new Set([ROOT, ROOT + '/downloads', ROOT + '/downloads/files']);
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

function boot(machine, {stale = false} = {}) {
  let attempts = 0;
  const downloads = {
    enqueue({destination}) {
      // The first transfer is the one the adopted partial stops, as the engine words it.
      if (stale && attempts++ === 0)
        return {done: Promise.reject(new Error('partial file has no matching durable checkpoint')), snapshot: {state: 'connecting'},
          subscribe: () => () => {}, cancel: () => {}};
      machine.files.delete(destination + '.part');
      machine.files.set(destination, 'game bytes');
      return {done: Promise.resolve({written: 4096}), snapshot: {state: 'completed'}, subscribe: () => () => {}, cancel: () => {}};
    },
  };
  const formats = {artifact: (release, where) => ({
    directory: where + '/downloads/files',
    destination: where + '/downloads/files/' + release.filename,
    nextAction: 'downloaded',
  })};
  return createDownloadQueue({
    fs: machine.fs, downloads, formats, dataDir: ROOT, platform: 'desktop',
    notifications: {show() {}}, power: {keepAwake() {}},
    sources: {resolve: async () => ({url: 'https://example.com/game.pkg'})},
  });
}

async function settled(queue, id, states) {
  for (const until = Date.now() + 5000; Date.now() < until;) {
    const job = queue.snapshot().find(item => item.id === id);
    if (states.includes(job?.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Queue did not settle: ' + JSON.stringify(queue.snapshot().find(item => item.id === id)));
}

const release = {id: 'source-1', filename: 'game.pkg', url: 'https://example.com/game.pkg', format: 'pkg', sizeBytes: 4096};

test('Retry replaces a partial from an earlier session instead of failing on it again', async () => {
  const machine = console_();
  machine.files.set(DESTINATION + '.part', 'half');
  const queue = boot(machine, {stale: true});
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, release, ROOT);
  const failed = await settled(queue, id, ['failed', 'file-downloaded']);
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /from another source holds this name/);
  await new Promise(resolve => setTimeout(resolve, 20));
  await queue.restart(id);
  const job = await settled(queue, id, ['file-downloaded', 'failed']);
  assert.equal(job.state, 'file-downloaded', job.error);
  assert.equal(machine.files.has(DESTINATION + '.part'), false);
});

test('a download with no partial of its own needs no restart', async () => {
  const machine = console_();
  const queue = boot(machine);
  const id = queue.enqueue({id: 'PPSA28000', title: 'Demo'}, release, ROOT);
  const job = await settled(queue, id, ['file-downloaded', 'failed']);
  assert.equal(job.state, 'file-downloaded', job.error);
});
