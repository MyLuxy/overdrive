import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createDownloadQueue} = await import('./download-queue.js');

const PS4_ID = 'UP0001-CUSA04013_00-TITANFALL2000000';
const PS4_HEAD = '\x7FCNT' + '\x00\x01\xff\xfe'.repeat(15) + PS4_ID + '\x00'.repeat(64);
const PS5_HEAD = '\x7FFIH' + '\x00'.repeat(120);
const RAR_HEAD = 'Rar!\x1a\x07\x01\x00' + '\x00'.repeat(120);
const SIGNED_LINK = 'https://asia-upload.04b3d96d52475741e6b10f97f0a84a16.r2.cloudflarestorage.com/rVl2jfZkC7' +
  '?response-content-disposition=attachment%3Bfilename%3D%22GAME%20%5Bv01.01%5D%2094.7GB.pkg%22' +
  '&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2Fauto%2Fs3%2Faws4_request' +
  '&X-Amz-Date=20261025T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=' + 'a'.repeat(64);

// The console's answer to a link: 'accepted' reports bytes, 'refused' fails, 'silent' says nothing.
function harness({head = PS4_HEAD, status = 206, console: answer = 'accepted', platform = 'ps5', format = 'binary', redirect = false, size = 100e9, url = 'https://cdn.example/file.pkg', proxy = true, lan = '192.168.1.20', saved = null, delivered = () => 0, helper = null, streamMode, endless = false} = {}) {
  const files = new Map();
  const dirs = new Set(['/data']);
  const requests = [], installs = [], enqueued = [], proxied = [], removed = [];
  if (saved) {
    dirs.add('/data/overdrive');
    files.set('/data/overdrive/downloads.json', JSON.stringify(saved));
  }
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
  const http = {
    async request(url, options) {
      requests.push({url, options});
      if (redirect && url === 'https://host.example/f/abc')
        return {status: 302, ok: false, headers: {location: 'https://cdn.example/file.pkg'}, text: async () => ''};
      return {status, ok: status < 300, headers: status === 206 ? {'content-range': `bytes 0-4095/${size}`, 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="game.pkg"'} : {}, text: async () => head};
    },
  };
  const downloads = {
    enqueue(options) {
      enqueued.push(options);
      if (endless) {
        // A transfer that runs until it is stopped, as a big one does.
        files.set(options.destination + '.part', 'part');
        let stop;
        const done = new Promise((_, reject) => { stop = reject; });
        done.catch(() => {});
        return {done, snapshot: {state: 'downloading'}, subscribe: listener => { listener({state: 'downloading', written: 10, total: 100}); return () => {}; }, cancel: () => stop(new Error('cancelled'))};
      }
      files.set(options.destination, 'game bytes');
      return {done: Promise.resolve({written: 4096}), snapshot: {state: 'completed'}, subscribe: () => () => {}, cancel: () => {}};
    },
  };
  const packages = {
    // The engine's own link to the package (ABI v21); `proxy: false` is an engine without it, and
    // 'fails' one that cannot listen.
    ...proxy ? {
      proxy(request) {
        proxied.push(request);
        if (proxy === 'fails') throw new Error('packages.proxy: listen: Operation not permitted');
        const token = request.token || 'a'.repeat(64);
        const port = request.port || 41000;
        return {url: lan ? `http://${lan}:${port}/${token}/${request.file}` : '', localUrl: `http://127.0.0.1:${port}/${token}/${request.file}`, token, port};
      },
      proxyStats: () => proxied.map(request => ({token: request.token || 'a'.repeat(64), total: request.total, delivered: delivered(), requests: 3, idleMs: 0})),
      proxyRemove: token => removed.push(token),
    } : {},
    install(request) {
      installs.push(request);
      const listeners = new Set();
      let finish, fail;
      const done = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      done.catch(() => {});
      const task = {
        snapshot: {state: 'queued', written: 0},
        done,
        subscribe(listener) { listener(task.snapshot); listeners.add(listener); return () => listeners.delete(listener); },
        cancel() { fail(new Error('cancelled')); },
      };
      setTimeout(() => {
        // The frame's message names the link first, as long as a signed CDN's can be.
        const verdict = typeof answer === 'function' ? answer(request.url) : answer;
        if (verdict === 'refused') return fail(new Error(`Packages.install ${SIGNED_LINK}: The console refused the package. (0x80990085)`));
        task.snapshot = {state: 'installing', written: 0};
        if (verdict === 'accepted') {
          task.snapshot = {state: 'installing', written: 1 << 20, total: 1 << 30};
          for (const listener of listeners) listener(task.snapshot);
        }
      }, 5);
      return task;
    },
  };
  const formats = {artifact: (release, where) => ({
    directory: where + '/downloads/files',
    destination: where + '/downloads/files/' + release.filename,
    nextAction: release.format === 'pkg' ? 'installer-required' : 'downloaded',
  })};
  const queue = createDownloadQueue({
    fs, http, downloads, packages, formats,
    dataDir: '/data', platform,
    archives: {streams: true, supportsAsyncInspection: false, inspect: () => ({kind: null})},
    notifications: {show() {}}, power: {keepAwake() {}},
    sources: {resolve: async entry => ({url: entry.url})},
    helper,
  });
  const release = {id: 'source-1', filename: format === 'binary' ? 'game.binary' : 'game.' + format,
    url: redirect ? 'https://host.example/f/abc' : url, format, provider: 'vikingfile'};
  const id = saved ? saved.jobs[0].id : queue.enqueue({id: 'CUSA04013', title: 'Titanfall 2'}, release, '/data', {streamMode});
  return {queue, id, requests, installs, enqueued, proxied, removed, files};
}

async function settled(fixture, states = ['installed', 'file-downloaded', 'installer-required', 'failed', 'downloaded']) {
  for (const until = Date.now() + 10000; Date.now() < until;) {
    const job = fixture.queue.snapshot().find(item => item.id === fixture.id);
    if (states.includes(job?.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Queue did not settle');
}

test('a PS4 PKG link goes to the console with its content ID, and nothing downloads here', async () => {
  const fixture = harness();
  const job = await settled(fixture);
  assert.equal(job.state, 'installed', job.error);
  assert.equal(job.streamed, true);
  assert.deepEqual(fixture.installs, [{url: 'https://cdn.example/file.pkg', name: 'Titanfall 2', contentId: PS4_ID}]);
  assert.equal(fixture.enqueued.length, 0);
  assert.equal(fixture.requests[0].options.headers.Range, 'bytes=0-4095');
});

test('a PS5 PKG goes without a content ID, through the link a redirect names', async () => {
  const fixture = harness({head: PS5_HEAD, redirect: true});
  const job = await settled(fixture);
  assert.equal(job.state, 'installed', job.error);
  assert.deepEqual(fixture.installs.map(item => [item.url, item.contentId]), [['https://cdn.example/file.pkg', '']]);
});

test('an archive downloads here as before', async () => {
  const fixture = harness({head: RAR_HEAD});
  const job = await settled(fixture);
  assert.notEqual(job.state, 'installed');
  assert.equal(fixture.installs.length, 0);
  assert.equal(fixture.enqueued.length, 1);
});

test('a host that ignores ranges downloads here', async () => {
  const fixture = harness({status: 200});
  await settled(fixture);
  assert.equal(fixture.installs.length, 0);
  assert.equal(fixture.enqueued.length, 1);
});

test('a link the console refuses downloads here instead, and is not offered again', async () => {
  const fixture = harness({console: 'refused', format: 'pkg'});
  const job = await settled(fixture);
  assert.equal(fixture.installs.length, 4, "the link, the app's link on the LAN and on 127.0.0.1, then the downloaded file");
  assert.equal(fixture.installs[3].path, '/data/downloads/files/game.pkg');
  assert.equal(fixture.enqueued.length, 1);
  assert.equal(job.streamTried, true);
  assert.equal(job.streamed, undefined);
  assert.deepEqual(fixture.removed, ['a'.repeat(64)], 'a link the console never took is not served');
});

// A pre-signed link answers the console's HEAD 403 (it signs only the GET), and the console refuses it
// with 0x80B22403 (the user's Vikingfile logs, 2026-10-25). The app's own link answers that HEAD, on
// the console's LAN address first, as Pegasus DL+ serves its packages.
test('a refused link is offered again through the app on the LAN, and taken there', async () => {
  const fixture = harness({console: url => url.startsWith('http://192.168.') ? 'accepted' : 'refused', format: 'pkg'});
  const job = await settled(fixture);
  assert.equal(job.state, 'installed', job.error);
  assert.equal(job.streamed, true);
  assert.equal(job.proxied, true);
  assert.equal(job.message, 'downloads.streamedProxy');
  assert.deepEqual(fixture.installs.map(item => [item.url, item.contentId]), [
    ['https://cdn.example/file.pkg', PS4_ID],
    ['http://192.168.1.20:41000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/game.pkg', PS4_ID],
  ]);
  assert.deepEqual(fixture.proxied, [{url: 'https://cdn.example/file.pkg', total: 100e9, file: 'game.pkg'}]);
  assert.equal(job.proxy.token, 'a'.repeat(64));
  assert.equal(job.proxy.port, 41000);
  assert.equal(job.proxy.origin, 'https://cdn.example/file.pkg');
  assert.equal(fixture.enqueued.length, 0);
  assert.equal(fixture.removed.length, 0);
});

test('a console that refuses the LAN address is offered 127.0.0.1', async () => {
  const fixture = harness({console: url => url.startsWith('http://127.0.0.1') ? 'accepted' : 'refused', format: 'pkg'});
  const job = await settled(fixture);
  assert.equal(job.state, 'installed', job.error);
  assert.deepEqual(fixture.installs.map(item => item.url), ['https://cdn.example/file.pkg', 'http://192.168.1.20:41000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/game.pkg', 'http://127.0.0.1:41000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/game.pkg']);
});

test('a console with no LAN address goes straight to 127.0.0.1', async () => {
  const fixture = harness({console: 'refused', format: 'pkg', lan: ''});
  await settled(fixture);
  assert.deepEqual(fixture.installs.slice(0, 2).map(item => item.url), ['https://cdn.example/file.pkg', 'http://127.0.0.1:41000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/game.pkg']);
  assert.equal(fixture.installs[2].path, '/data/downloads/files/game.pkg');
});

test('a link the console takes as it came is never served by the app', async () => {
  const fixture = harness();
  const job = await settled(fixture);
  assert.equal(job.state, 'installed', job.error);
  assert.equal(job.proxied, undefined);
  assert.equal(job.message, 'downloads.streamed');
  assert.equal(fixture.proxied.length, 0);
});

test("an engine without the app's own link offers the link once, then downloads here", async () => {
  const fixture = harness({console: 'refused', format: 'pkg', proxy: false});
  await settled(fixture);
  assert.equal(fixture.installs.length, 2, 'the link, then the downloaded file');
  assert.equal(fixture.installs[1].path, '/data/downloads/files/game.pkg');
});

test('an app that cannot serve the link says so and downloads here', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  let fixture;
  try {
    fixture = harness({console: 'refused', format: 'pkg', proxy: 'fails'});
    await settled(fixture);
  } finally {
    console.log = original;
  }
  assert.equal(fixture.installs.length, 2);
  assert.ok(lines.some(line => line.includes('could not serve it to the console: packages.proxy: listen')), lines.join('\n'));
});

// The response the host gives is logged while it still may explain the refusal.
test("a refused link with a query has the host's own answer beside it", async () => {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  let fixture;
  try {
    fixture = harness({console: 'refused', format: 'pkg', url: 'https://cdn.example/file.pkg?b=1&a=2'});
    await settled(fixture);
  } finally {
    console.log = original;
  }
  assert.deepEqual(fixture.installs.slice(0, 3).map(item => item.url), ['https://cdn.example/file.pkg?b=1&a=2', 'http://192.168.1.20:41000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/game.pkg', 'http://127.0.0.1:41000/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/game.pkg']);
  assert.equal(fixture.installs[3].path, '/data/downloads/files/game.pkg');
  assert.ok(lines.some(line => line.includes('the host answers 206 to a one-byte range')), lines.join('\n'));
  assert.ok(lines.some(line => line.includes('its query names b, a')), lines.join('\n'));
  assert.ok(lines.some(line => line.includes('offered it again through Overdrive to the console: http://192.168.1.20:41000/')), lines.join('\n'));
});

// Closed and opened again, the app serves the same URL on the same token and port, so the console's
// queue reconnects to it without a second install; once every byte went out, it is no longer served.
function servedJob(proxy) {
  return {version: 1, jobs: [{
    id: 'CUSA04013/source-1', gameId: 'CUSA04013', title: 'Titanfall 2', root: '/data', state: 'installed', streamed: true, proxied: true,
    release: {id: 'source-1', filename: 'game.pkg', url: 'https://cdn.example/file.pkg', format: 'pkg', provider: 'vikingfile'},
    artifact: {directory: '/data/downloads/files', destination: '/data/downloads/files/game.pkg', nextAction: 'installer-required'},
    proxy,
  }]};
}

test('after a restart the package is served again on its own token and port, with its progress', async () => {
  const proxy = {token: 'b'.repeat(64), port: 41234, origin: 'https://cdn.example/file.pkg', total: 4e9, file: 'game.pkg', since: Date.now()};
  let sent = 1e9;
  const fixture = harness({saved: servedJob(proxy), delivered: () => sent});
  assert.deepEqual(fixture.proxied, [{url: 'https://cdn.example/file.pkg', total: 4e9, file: 'game.pkg', token: 'b'.repeat(64), port: 41234}]);
  const progress = await new Promise(resolve => {
    const off = fixture.queue.subscribe(jobs => {
      const job = jobs.find(item => item.id === fixture.id);
      if (job?.message === 'downloads.proxyProgress') { off?.(); resolve(job); }
    });
  });
  assert.equal(progress.state, 'installed');
  sent = 4e9;
  for (const until = Date.now() + 8000; Date.now() < until;) {
    const job = fixture.queue.snapshot().find(item => item.id === fixture.id);
    if (job.proxy.done) {
      assert.equal(job.message, 'downloads.proxyDone');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('the package was never marked as fetched');
});

test('a package served more than a week ago, or already fetched, is not served again', async () => {
  const old = harness({saved: servedJob({token: 'c'.repeat(64), port: 41000, origin: 'https://cdn.example/file.pkg', total: 4e9, file: 'game.pkg', since: Date.now() - 8 * 24 * 3600e3})});
  assert.equal(old.proxied.length, 0);
  const done = harness({saved: servedJob({token: 'd'.repeat(64), port: 41000, origin: 'https://cdn.example/file.pkg', total: 4e9, file: 'game.pkg', since: Date.now(), done: true})});
  assert.equal(done.proxied.length, 0);
});

// app.log cuts a line at 382 characters: a signed CDN link alone fills one, so the reason and its code
// have to come without it, or the next report says nothing again.
test('a refusal is logged with its reason and code, not the link in front of them', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    await settled(harness({console: 'refused', format: 'pkg'}));
  } finally {
    console.log = original;
  }
  const refusal = lines.find(line => line.includes('the console refused the link after'));
  assert.ok(refusal, 'the refusal is logged');
  assert.equal(refusal.split(' ms: ')[1], 'code=0x80990085 The console refused the package.');
  const whole = lines.find(line => line.includes(SIGNED_LINK));
  assert.ok(!whole, `the link never reaches app.log whole: ${whole?.slice(0, 200)}`);
});

// A file that turns out not to be a PKG is not a failure, but the log has to say so: a bare
// "downloading it here instead" left the reason unnamed in every report until now.
// The package's size beside the room the console has: the two lines together say whether a refusal
// could have been about space, which no other line in app.log can answer. Nothing here sets a locale,
// so a size renders as its translation key: this checks the line is shaped right, not the number.
test('the handoff names the package size, and still reads well when the host gives none', async () => {
  const capture = async (options) => {
    const lines = [];
    const original = console.log;
    console.log = (...parts) => lines.push(parts.join(' '));
    try {
      await settled(harness(options));
    } finally {
      console.log = original;
    }
    return lines;
  };
  const sized = await capture({size: 100e9});
  const unsized = await capture({size: 0});
  assert.ok(sized.some(line => line.includes('a PS4 PKG of ')), sized.join('\n'));
  assert.ok(unsized.some(line => line.includes('a PS4 PKG, handed to the console')), unsized.join('\n'));
  assert.ok(sized.some(line => line.includes('internal drive free')), sized.join('\n'));
  assert.ok(sized.some(line => line.includes('the host serves it as application/octet-stream, attachment; filename="game.pkg"')), sized.join('\n'));
});

test('a file whose first bytes are not a PKG says so before downloading here', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    harness({head: RAR_HEAD, format: 'pkg'});
    for (const until = Date.now() + 2000; Date.now() < until && !lines.some(line => line.includes('not streamed'));)
      await new Promise(resolve => setTimeout(resolve, 5));
  } finally {
    console.log = original;
  }
  assert.ok(lines.some(line => line.includes('not streamed, its first bytes are not a PKG')), lines.join('\n'));
});

test('a source of a declared archive format is never probed', async () => {
  const fixture = harness({format: 'rar', head: RAR_HEAD});
  await settled(fixture, ['file-downloaded', 'failed', 'extraction-required', 'extracted', 'downloaded']);
  assert.equal(fixture.requests.length, 0);
});

test('outside the PS5 nothing is probed', async () => {
  const fixture = harness({platform: 'desktop'});
  await settled(fixture);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.installs.length, 0);
});

// The helper payload (pkg-helper.js) serves the package once Overdrive has closed: the console's
// download goes on while the player uses the console for anything else.
function fakeHelper({fails = false, running = false, delivered = () => 0} = {}) {
  const added = [], removed = [];
  return {
    added, removed,
    alive: async () => running,
    ensure: async () => {},
    async add(request) {
      if (fails) throw new Error('Packages.startHelper: the payload loader on port 9021 did not answer');
      added.push(request);
      const token = request.token || 'e'.repeat(64);
      return {url: `http://192.168.1.20:42000/${token}/${request.file}`, localUrl: `http://127.0.0.1:42000/${token}/${request.file}`, token, port: 42000, background: true};
    },
    stats: async () => added.map(request => ({token: request.token || 'e'.repeat(64), total: request.total, delivered: delivered(), requests: 4, idleMs: 0})),
    remove: async token => { removed.push(token); },
  };
}
const HELPER_LAN = 'http://192.168.1.20:42000/' + 'e'.repeat(64) + '/game.pkg';

test('a refused link goes to the helper, so Overdrive can close while the console downloads it', async () => {
  const helper = fakeHelper();
  const fixture = harness({console: url => url.includes(':42000/') ? 'accepted' : 'refused', format: 'pkg', helper});
  const job = await settled(fixture);
  assert.equal(job.state, 'installed', job.error);
  assert.equal(job.proxy.background, true);
  assert.equal(job.message, 'downloads.streamedBackground');
  assert.deepEqual(fixture.installs.map(item => item.url), ['https://cdn.example/file.pkg', HELPER_LAN]);
  assert.equal(fixture.proxied.length, 0, 'the app serves nothing itself');
  assert.deepEqual(helper.added, [{url: 'https://cdn.example/file.pkg', total: 100e9, file: 'game.pkg'}]);
});

test('a helper that does not start leaves the app serving it, which has to stay open', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  let fixture;
  try {
    fixture = harness({console: url => url.startsWith('http://192.168.1.20:41000') ? 'accepted' : 'refused', format: 'pkg', helper: fakeHelper({fails: true})});
    const job = await settled(fixture);
    assert.equal(job.proxy.background, false);
    assert.equal(job.message, 'downloads.streamedProxy');
  } finally {
    console.log = original;
  }
  assert.ok(lines.some(line => line.includes('the package helper did not start')), lines.join('\n'));
});

test('a download asked for in Overdrive is never handed to the console', async () => {
  const helper = fakeHelper();
  const fixture = harness({console: 'refused', format: 'pkg', helper, streamMode: 'here'});
  const job = await settled(fixture);
  assert.equal(job.streamMode, 'here');
  assert.equal(fixture.installs.filter(item => item.url).length, 0);
  assert.equal(fixture.enqueued.length, 1);
  assert.equal(helper.added.length, 0);
});

test('reopened, the app finds the helper still serving and shows its progress', async () => {
  let sent = 2e9;
  const helper = fakeHelper({running: true, delivered: () => sent});
  const proxy = {token: 'f'.repeat(64), port: 42000, origin: 'https://cdn.example/file.pkg', total: 4e9, file: 'game.pkg', since: Date.now(), background: true};
  const fixture = harness({saved: servedJob(proxy), helper});
  for (const until = Date.now() + 2000; !helper.added.length && Date.now() < until;) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(helper.added, [{url: 'https://cdn.example/file.pkg', total: 4e9, file: 'game.pkg', token: 'f'.repeat(64)}]);
  assert.equal(fixture.proxied.length, 0);
  for (const until = Date.now() + 8000; Date.now() < until;) {
    const job = fixture.queue.snapshot().find(item => item.id === fixture.id);
    if (job.proxy.done) return;
    if (job.message === 'downloads.helperProgress') sent = 4e9;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('the helper progress was never shown through to the end');
});

// Delete on a paused download takes it off the list and its partial off the drive. A second function
// named like the one that does it once replaced it, and Delete did nothing at all (Horizon, 2026-10-25).
test('a paused download that is deleted leaves the queue and the drive', async () => {
  const fixture = harness({format: 'pkg', streamMode: 'here', endless: true});
  await settled(fixture, ['downloading']);
  fixture.queue.pause(fixture.id);
  await settled(fixture, ['paused']);
  await fixture.queue.cancel(fixture.id);
  assert.equal(fixture.queue.snapshot().find(item => item.id === fixture.id), undefined);
  assert.ok(![...fixture.files.keys()].some(path => path.endsWith('.part')), [...fixture.files.keys()].join(', '));
});
