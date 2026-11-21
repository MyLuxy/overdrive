import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createTorbox, pickFile, ready} = await import('./torbox.js');

// Issue #20: TorBox fetches a magnet or a link and gives a direct link to the file, which the queue
// then downloads. These are the API's real answers (2026-10-24) replayed; the calls themselves were
// checked against api.torbox.app with a live key, and the key is never part of the app.

const MAGNET = 'magnet:?xt=urn:btih:7acf8fb590b2060dd9c3146ef770169d593433b0&dn=Debian';
const ISO = {id: 2, name: 'Debian/debian.iso', short_name: 'debian.iso', size: 792723456};
const NFO = {id: 1, name: 'Debian/readme.nfo', short_name: 'readme.nfo', size: 1024};

function server(routes) {
  const calls = [];
  return {
    calls,
    async request(url, options = {}) {
      calls.push({url, options});
      const route = routes.find(entry => entry.match.test(url));
      if (!route) throw new Error('unexpected request: ' + url);
      const answer = route.answer(url, options);
      const status = answer.status ?? 200;
      const body = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
      return {status, ok: status >= 200 && status < 300, url, headers: {}, text: async () => body, json: async () => JSON.parse(body)};
    },
  };
}

const noWait = async () => {};
const keyed = (http, extra = {}) => createTorbox({http, key: 'test-key', wait: noWait, ...extra});
const ok = data => ({success: true, error: null, detail: 'ok', data});

test('a magnet is added, waited for, and its largest file is linked', async () => {
  let polls = 0;
  const http = server([
    {match: /\/v1\/api\/torrents\/createtorrent$/, answer: () => ({body: ok({torrent_id: 42, hash: '7acf8fb5', auth_id: 'x'})})},
    {match: /\/v1\/api\/torrents\/mylist\?id=42$/, answer: () => ({body: ok(++polls === 1
      ? {id: 42, download_state: 'downloading', progress: 0.25, size: 792724000, files: [ISO, NFO]}
      : {id: 42, download_state: 'cached', download_finished: true, progress: 1, size: 792724000, files: [NFO, ISO]})})},
    {match: /\/v1\/api\/torrents\/requestdl\?/, answer: () => ({body: ok('https://nexus-318.ceur.tb-cdn.st/dld/abc?token=test-key')})},
  ]);
  const progress = [];
  const prepared = await keyed(http).prepare(MAGNET, {onProgress: report => progress.push(report.progress)});
  assert.deepEqual(progress, [0.25]);
  assert.equal(prepared.url, 'https://nexus-318.ceur.tb-cdn.st/dld/abc?token=test-key');
  assert.equal(prepared.filename, 'debian.iso');
  assert.equal(prepared.sizeBytes, 792723456);
  // The magnet goes as a form field, and the download link names the largest file's id.
  assert.equal(new URLSearchParams(http.calls[0].options.body).get('magnet'), MAGNET);
  assert.match(http.calls.at(-1).url, /torrent_id=42&file_id=2$/);
  assert.equal(http.calls[0].options.headers.Authorization, 'Bearer test-key');
});

test('a link is a web download, and its id answers the same way', async () => {
  const http = server([
    {match: /\/v1\/api\/webdl\/createwebdownload$/, answer: () => ({body: ok({web_id: 7, hash: 'abc'})})},
    {match: /\/v1\/api\/webdl\/mylist\?id=7$/, answer: () => ({body: ok({id: 7, download_state: 'completed', progress: 1, size: 2048, files: [{id: 3, name: 'game.zip', size: 2048}]})})},
    {match: /\/v1\/api\/webdl\/requestdl\?/, answer: () => ({body: ok('https://cdn/web/game.zip')})},
  ]);
  const prepared = await keyed(http).prepare('https://host/files/game.zip');
  assert.equal(prepared.url, 'https://cdn/web/game.zip');
  assert.equal(prepared.filename, 'game.zip');
  assert.equal(new URLSearchParams(http.calls[0].options.body).get('link'), 'https://host/files/game.zip');
  assert.match(http.calls.at(-1).url, /web_id=7&file_id=3$/);
});

test('a site TorBox does not support says so', async () => {
  const http = server([{match: /createwebdownload$/, answer: () => ({body: {success: false, error: 'UNSUPPORTED_SITE', detail: 'The site you are trying to download from is not supported.', data: null}})},]);
  await assert.rejects(keyed(http).prepare('https://example.com/file.pkg'), /site you are trying to download from is not supported/);
});

test('a refused call logs why, without the key or the link', async () => {
  // The catalog resolves an unsupported host to "Conversion failed" and nothing else: app.log is the
  // only place the reason can be read (the requestdl query carries the key, so it must never appear).
  const http = server([{match: /createwebdownload$/, answer: () => ({status: 500,
    body: {success: false, error: 'UNSUPPORTED_SITE', detail: 'test-key cannot fetch this link', data: null}})}]);
  const lines = [];
  const original = console.log;
  console.log = line => lines.push(String(line));
  try {
    await assert.rejects(keyed(http).prepare('https://example.com/file.pkg'));
  } finally {
    console.log = original;
  }
  const logged = lines.join('\n');
  assert.match(logged, /\[torbox\] \/v1\/api\/webdl\/createwebdownload: HTTP 500 /);
  assert.match(logged, /UNSUPPORTED_SITE/);
  assert.doesNotMatch(logged, /test-key/, 'the key never reaches the log');
});

test('a refused key is named as such, not as a host error', async () => {
  const http = server([{match: /createtorrent$/, answer: () => ({status: 401, body: {detail: 'Unauthorized'}})},]);
  await assert.rejects(keyed(http).prepare(MAGNET), /rejected the API key/);
});

test('a free plan is named as such, not as a refused key', async () => {
  // The console's own answer (2026-10-27): a good key, a free plan, and HTTP 403 like a bad key.
  const http = server([{match: /\/v1\/api\/webdl\/createwebdownload$/, answer: () => ({status: 403,
    body: {success: false, error: 'PLAN_RESTRICTED_FEATURE', detail: 'API feature not available on your plan. Please upgrade to a paid plan to access the API.', data: null}})}]);
  await assert.rejects(keyed(http).prepare('https://vikingfile.com/f/5wFlMbm0lC'), /need a paid plan/);
});

test('a torrent TorBox could not fetch fails with its state', async () => {
  const http = server([
    {match: /createtorrent$/, answer: () => ({body: ok({torrent_id: 9})})},
    {match: /mylist\?id=9$/, answer: () => ({body: ok({id: 9, download_state: 'error', progress: 0, files: []})})},
  ]);
  await assert.rejects(keyed(http).prepare(MAGNET), /could not fetch it \(error\)/);
});

test('waiting too long says to come back, and keeps what TorBox has', async () => {
  let clock = 0;
  const http = server([
    {match: /createtorrent$/, answer: () => ({body: ok({torrent_id: 9})})},
    {match: /mylist\?id=9$/, answer: () => ({body: ok({id: 9, download_state: 'downloading', progress: 0.5, size: 100, files: []})})},
  ]);
  const torbox = createTorbox({http, key: 'k', timeoutMs: 10, now: () => (clock += 6), wait: noWait});
  await assert.rejects(torbox.prepare(MAGNET), /still fetching it\. Add it again later/);
});

test('the largest file wins, and only a real one counts as ready', () => {
  assert.equal(pickFile([NFO, ISO])?.id, 2);
  assert.equal(pickFile([{id: 1, name: 'x', size: 5}, {id: 2, name: 'y', size: 9}])?.id, 2);
  assert.equal(pickFile([]), null);
  assert.equal(pickFile(null), null);
  assert.equal(ready({download_finished: true}), true);
  assert.equal(ready({download_state: 'cached'}), true);
  assert.equal(ready({progress: 1, size: 10}), true);
  assert.equal(ready({progress: 0.9, size: 10}), false);
  assert.equal(ready(null), false);
});
