import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createRealDebrid, pickFile} = await import('./realdebrid.js');

// Issue #20: Real-Debrid fetches a magnet on its servers and gives a direct link to the largest
// file, which the queue then downloads; a host link is unrestricted straight away. These answers
// follow the documented API (https://api.real-debrid.com/, 2026-10-24); no account was available to
// replay a live one, so the shapes are the documentation's.

const MAGNET = 'magnet:?xt=urn:btih:7acf8fb590b2060dd9c3146ef770169d593433b0&dn=Debian';
const NFO = {id: 1, path: 'Debian/readme.nfo', bytes: 1024, selected: 0};
const ISO = {id: 2, path: 'Debian/debian.iso', bytes: 792723456, selected: 0};
const SELECTED = {...ISO, selected: 1};

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
const keyed = (http, extra = {}) => createRealDebrid({http, key: 'test-token', wait: noWait, ...extra});

test('a magnet is added, its largest file selected, and its direct link returned', async () => {
  let polls = 0;
  const http = server([
    {match: /\/torrents\/addMagnet$/, answer: () => ({status: 201, body: {id: 'ABC123', uri: 'https://api.real-debrid.com/rest/1.0/torrents/info/ABC123'}})},
    {match: /\/torrents\/info\/ABC123$/, answer: () => ({body: [
      {id: 'ABC123', status: 'magnet_conversion', progress: 0, files: [NFO, ISO], links: []},
      {id: 'ABC123', status: 'waiting_files_selection', progress: 0, files: [NFO, ISO], links: []},
      {id: 'ABC123', status: 'downloading', progress: 42, files: [NFO, SELECTED], links: []},
      {id: 'ABC123', status: 'downloaded', progress: 100, files: [NFO, SELECTED], links: ['https://real-debrid.com/d/XYZ']},
    ][polls++]})},
    {match: /\/torrents\/selectFiles\/ABC123$/, answer: () => ({status: 204, body: ''})},
    {match: /\/unrestrict\/link$/, answer: () => ({body: {id: 'L1', filename: 'debian.iso', filesize: 792723456, link: 'https://real-debrid.com/d/XYZ', host: 'real-debrid', download: 'https://cache-42.real-debrid.com/d/XYZ/debian.iso'}})},
  ]);
  const progress = [];
  const prepared = await keyed(http).prepare(MAGNET, {onProgress: report => progress.push(report.progress)});
  assert.deepEqual(progress, [0, 0, 0.42, 1]);
  assert.equal(prepared.url, 'https://cache-42.real-debrid.com/d/XYZ/debian.iso');
  assert.equal(prepared.filename, 'debian.iso');
  assert.equal(prepared.sizeBytes, 792723456);
  // The magnet goes as a form field, and only the largest file is selected.
  assert.equal(new URLSearchParams(http.calls[0].options.body).get('magnet'), MAGNET);
  const select = http.calls.find(call => /selectFiles/.test(call.url));
  assert.equal(new URLSearchParams(select.options.body).get('files'), '2');
  assert.equal(http.calls[0].options.headers.Authorization, 'Bearer test-token');
});

test('a host link is unrestricted without a torrent', async () => {
  const http = server([
    {match: /\/unrestrict\/link$/, answer: () => ({body: {id: 'L2', filename: 'game.zip', filesize: 2048, host: 'other', download: 'https://node.real-debrid.com/d/game.zip'}})},
  ]);
  const prepared = await keyed(http).prepare('https://host/files/game.zip');
  assert.equal(prepared.url, 'https://node.real-debrid.com/d/game.zip');
  assert.equal(prepared.filename, 'game.zip');
  assert.equal(new URLSearchParams(http.calls[0].options.body).get('link'), 'https://host/files/game.zip');
});

test('a refused token is named as such', async () => {
  const http = server([
    {match: /\/torrents\/addMagnet$/, answer: () => ({status: 401, body: {error: 'bad_token', error_code: 8}})},
  ]);
  await assert.rejects(keyed(http).prepare(MAGNET), /rejected the token/);
});

test('a locked or free account says so instead of a bare HTTP code', async () => {
  const http = server([
    {match: /\/unrestrict\/link$/, answer: () => ({status: 403, body: {error: 'permission_denied', error_code: 9}})},
  ]);
  await assert.rejects(keyed(http).prepare('https://host/files/game.pkg'), /locked or not premium/);
});

test('a torrent Real-Debrid could not fetch fails with its state', async () => {
  const http = server([
    {match: /\/torrents\/addMagnet$/, answer: () => ({status: 201, body: {id: 'DEAD1'}})},
    {match: /\/torrents\/info\/DEAD1$/, answer: () => ({body: {id: 'DEAD1', status: 'dead', progress: 0, files: [], links: []}})},
  ]);
  await assert.rejects(keyed(http).prepare(MAGNET), /could not fetch it \(dead\)/);
});

test('a torrent that finished without files is selected once, then linked', async () => {
  let polls = 0;
  const http = server([
    {match: /\/torrents\/addMagnet$/, answer: () => ({status: 201, body: {id: 'CACHED'}})},
    {match: /\/torrents\/info\/CACHED$/, answer: () => ({body: [
      {id: 'CACHED', status: 'downloaded', progress: 100, files: [NFO, ISO], links: []},
      {id: 'CACHED', status: 'downloaded', progress: 100, files: [NFO, SELECTED], links: ['https://real-debrid.com/d/XYZ']},
    ][polls++]})},
    {match: /\/torrents\/selectFiles\/CACHED$/, answer: () => ({status: 204, body: ''})},
    {match: /\/unrestrict\/link$/, answer: () => ({body: {filename: 'debian.iso', filesize: 792723456, download: 'https://node.real-debrid.com/d/debian.iso'}})},
  ]);
  const prepared = await keyed(http).prepare(MAGNET);
  assert.equal(prepared.filename, 'debian.iso');
  assert.equal(http.calls.filter(call => /selectFiles/.test(call.url)).length, 1);
});

test('waiting too long says to come back, and keeps what Real-Debrid has', async () => {
  let clock = 0;
  const http = server([
    {match: /\/torrents\/addMagnet$/, answer: () => ({status: 201, body: {id: 'SLOW'}})},
    {match: /\/torrents\/info\/SLOW$/, answer: () => ({body: {id: 'SLOW', status: 'downloading', progress: 50, files: [ISO], links: []}})},
  ]);
  const service = createRealDebrid({http, key: 'k', timeoutMs: 10, now: () => (clock += 6), wait: noWait});
  await assert.rejects(service.prepare(MAGNET), /still fetching it\. Add it again later/);
});

test('the largest file wins, and only a real one counts', () => {
  assert.equal(pickFile([NFO, ISO])?.id, 2);
  assert.equal(pickFile([{id: 1, path: 'x', bytes: 5}, {id: 2, path: 'y', bytes: 9}])?.id, 2);
  assert.equal(pickFile([]), null);
  assert.equal(pickFile(null), null);
  assert.equal(pickFile([{path: 'no-id', bytes: 10}]), null);
});
