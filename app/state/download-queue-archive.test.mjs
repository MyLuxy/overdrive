import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createDownloadQueue} = await import('./download-queue.js');

const ARCHIVE = 'https://archive.org/download/item/game.pkg';
const NODE = 'https://dn123.ca.archive.org/0/items/item/game.pkg';
const COOKIE = 'logged-in-user=alice; logged-in-sig=sig123';

function archive({failFirst = false} = {}) {
  const calls = {headers: 0, resolve: 0, refresh: 0};
  let attempts = 0;
  return {
    calls,
    enabled: () => true,
    isArchive: url => String(url).includes('archive.org'),
    async headersFor() {
      calls.headers++;
      return {Cookie: COOKIE};
    },
    async resolve() {
      calls.resolve++;
      attempts++;
      if (failFirst && attempts === 1) throw new Error('Source unavailable: HTTP 401. Sign in with an account that can download this item.');
      return NODE;
    },
    async refresh() {
      calls.refresh++;
    },
  };
}

function harness(options = {}) {
  const files = new Map();
  const dirs = new Set(['/data']);
  const enqueued = [];
  const sourceContexts = [];
  const installs = [];
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
    remove: path => { files.delete(path); },
    removeAsync: async path => { files.delete(path); dirs.delete(path); },
  };
  const http = {async request(url) { throw new Error('no HTTP request expected: ' + url); }};
  const downloads = {
    enqueue(given) {
      enqueued.push(given);
      files.set(given.destination, 'game bytes');
      return {
        done: Promise.resolve({written: 4096}),
        snapshot: {state: 'completed'},
        subscribe(listener) {
          listener({state: 'downloading', written: 4096, completedBytes: 4096, received: 4096, total: 4096, connections: 1});
          return () => {};
        },
        cancel() {},
      };
    },
  };
  const packages = {
    install() {
      installs.push('install');
    },
  };
  const formats = {artifact: (release, where) => ({
    directory: where + '/downloads/packages',
    destination: where + '/downloads/packages/' + release.filename,
    nextAction: 'installer-required',
  })};
  const auth = archive(options);
  const queue = createDownloadQueue({
    fs, http, downloads, packages, formats,
    dataDir: '/data', platform: 'desktop',
    archives: {streams: true, supportsAsyncInspection: false, inspect: () => ({kind: null})},
    notifications: {show() {}}, power: {keepAwake() {}},
    sources: {resolve: async (entry, context) => {
      sourceContexts.push(context);
      return {url: entry.url};
    }},
    archiveAuth: auth,
  });
  const release = {
    id: 'source-1', filename: 'game.pkg', url: ARCHIVE, format: 'pkg', provider: 'archive.org', sizeBytes: 4096,
    ...(options.unavailable ? {unavailableReason: options.unavailable} : {}),
  };
  const id = queue.enqueue({id: 'CUSA00009', title: 'Archive Game'}, release, '/data');
  return {queue, id, files, enqueued, installs, auth, sourceContexts};
}

async function settled(fixture) {
  for (const until = Date.now() + 10000; Date.now() < until;) {
    const job = fixture.queue.snapshot().find(item => item.id === fixture.id);
    if (['installer-required', 'file-downloaded', 'failed'].includes(job?.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Queue did not settle');
}

test('an Archive.org download carries the account cookie to the node it redirects to', async () => {
  const fixture = harness();
  const job = await settled(fixture);
  assert.equal(job.state, 'installer-required', job.error);
  assert.equal(fixture.enqueued.length, 1);
  assert.equal(fixture.enqueued[0].url, NODE);
  assert.equal(fixture.enqueued[0].headers.Cookie, COOKIE);
  assert.equal(fixture.enqueued[0].connections, 4, 'Archive.org takes four connections, not sixty-four');
  assert.equal(fixture.sourceContexts[0].catalog, false, 'an authenticated archive retains its account route instead of automatic debrid conversion');
  assert.equal(fixture.installs.length, 0, 'the console cannot send the cookies: nothing is installed from the link');
  // The queue file keeps the job, never the session.
  const saved = fixture.files.get('/data/overdrive/downloads.json') || '';
  assert.equal(saved.includes('logged-in-sig'), false);
  assert.equal(fixture.auth.calls.refresh, 0);
});

test('a refused session signs in again once and downloads', async () => {
  const fixture = harness({failFirst: true});
  const job = await settled(fixture);
  assert.equal(job.state, 'installer-required', job.error);
  assert.equal(fixture.auth.calls.refresh, 1);
  assert.equal(fixture.auth.calls.resolve, 2);
  assert.equal(fixture.enqueued.length, 1);
  assert.equal(fixture.enqueued[0].headers.Cookie, COOKIE);
});

test('a stored Archive.org refusal is tried again with an account', async () => {
  const fixture = harness({unavailable: 'Source unavailable: HTTP 401. Choose another source.'});
  const job = await settled(fixture);
  assert.equal(job.state, 'installer-required', job.error);
  assert.equal(fixture.enqueued.length, 1);
  assert.equal(fixture.enqueued[0].headers.Cookie, COOKIE);
});
