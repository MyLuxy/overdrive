import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {base64, createQBittorrent, pickFile} = await import('./qbittorrent.js');

// Issue #89: the user's own qBittorrent fetches the torrent and its WebUI hands the finished file
// over HTTP (torrents/downloadFile, WebAPI 2.16.0). Nothing here talks to a real client: the calls
// are the documented ones, replayed, so the console test is the one that proves the real client.

const MAGNET = 'magnet:?xt=urn:btih:7acf8fb590b2060dd9c3146ef770169d593433b0&dn=Debian';
const HASH = '7acf8fb590b2060dd9c3146ef770169d593433b0';

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
const client = (http, extra = {}) => createQBittorrent({http, address: 'http://192.168.1.10:8080', username: 'admin', password: 'p@ss', wait: noWait, ...extra});

test('a magnet is added, waited for, and its file is linked through the WebUI', async () => {
  let polls = 0;
  const http = server([
    {match: /\/api\/v2\/app\/webapiVersion$/, answer: () => ({body: '2.16.0'})},
    {match: /\/api\/v2\/torrents\/add$/, answer: () => ({body: 'Ok.'})},
    {match: /\/api\/v2\/torrents\/info\?hashes=/, answer: () => ({body: [{
      hash: HASH, name: 'Debian', progress: ++polls === 1 ? 0.4 : 1, state: polls === 1 ? 'downloading' : 'uploading', size: 900
    }]})},
    {match: /\/api\/v2\/torrents\/files\?hash=/, answer: () => ({body: [
      {index: 0, name: 'Debian/readme.nfo', size: 1024, progress: 1},
      {index: 1, name: 'Debian/debian.iso', size: 792723456, progress: 1},
      {index: 2, name: 'Debian/second.iso', size: 10, progress: 0.5},
    ]})},
  ]);
  const progress = [];
  const prepared = await client(http).prepare(MAGNET, {onProgress: report => progress.push(report.progress)});
  assert.deepEqual(progress, [0.4]);
  assert.equal(prepared.filename, 'debian.iso');
  assert.equal(prepared.sizeBytes, 792723456);
  assert.equal(prepared.url, 'http://192.168.1.10:8080/api/v2/torrents/downloadFile?hash=' + HASH + '&file=Debian%2Fdebian.iso');
  // The queue sends these with the file itself: the WebUI is behind a password.
  assert.equal(prepared.headers.Authorization, 'Basic ' + base64('admin:p@ss'));
  assert.equal(new URLSearchParams(http.calls[1].options.body).get('urls'), MAGNET);
  assert.equal(http.calls[0].options.headers.Authorization, 'Basic ' + base64('admin:p@ss'));
});

test('a WebUI too old to hand files over says exactly that', async () => {
  const http = server([{match: /webapiVersion$/, answer: () => ({body: '2.11.0'})}]);
  await assert.rejects(client(http).prepare(MAGNET), /needs 2\.16\.0 or newer/);
});

test('a wrong login is named as a login', async () => {
  const http = server([{match: /webapiVersion$/, answer: () => ({status: 403, body: 'Forbidden'})}]);
  await assert.rejects(client(http).prepare(MAGNET), /refused the login/);
});

test('a .torrent link is followed by the client\'s newest torrent', async () => {
  const http = server([
    {match: /webapiVersion$/, answer: () => ({body: '2.16.0'})},
    {match: /\/api\/v2\/torrents\/add$/, answer: () => ({body: 'Ok.'})},
    {match: /\/api\/v2\/torrents\/info\?sort=added_on/, answer: () => ({body: [{hash: 'abcdef', progress: 1}]})},
    {match: /\/api\/v2\/torrents\/info\?hashes=abcdef/, answer: () => ({body: [{hash: 'abcdef', progress: 1, state: 'uploading'}]})},
    {match: /\/api\/v2\/torrents\/files\?hash=abcdef/, answer: () => ({body: [{index: 0, name: 'game.pkg', size: 12, progress: 1}]})},
  ]);
  const prepared = await client(http).prepare('https://tracker.example/game.torrent');
  assert.equal(prepared.url, 'http://192.168.1.10:8080/api/v2/torrents/downloadFile?hash=abcdef&file=game.pkg');
  assert.equal(prepared.filename, 'game.pkg');
});

test('a torrent the client stopped on fails with its state', async () => {
  const http = server([
    {match: /webapiVersion$/, answer: () => ({body: '2.16.0'})},
    {match: /torrents\/add$/, answer: () => ({body: 'Ok.'})},
    {match: /torrents\/info\?hashes=/, answer: () => ({body: [{hash: HASH, progress: 0.2, state: 'error'}]})},
  ]);
  await assert.rejects(client(http).prepare(MAGNET), /stopped on it \(error\)/);
});

test('Basic auth encodes what the WebUI expects', () => {
  assert.equal(base64('admin:p@ss'), 'YWRtaW46cEBzcw==');
  assert.equal(base64('user:pass'), 'dXNlcjpwYXNz');
  // A password in UTF-8: the bytes, not the UTF-16 code units.
  assert.equal(base64('user:päss'), 'dXNlcjpww6Rzcw==');
  assert.equal(base64(''), '');
});

test('only a finished file is handed over, the largest of them', () => {
  assert.equal(pickFile([{name: 'a', size: 5, progress: 1}, {name: 'b', size: 9, progress: 0.2}])?.name, 'a');
  assert.equal(pickFile([{name: 'a', size: 5, progress: 1}, {name: 'b', size: 9, progress: 1}])?.name, 'b');
  assert.equal(pickFile([]), null);
});
