import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createPremiumize, pickContent} = await import('./premiumize.js');

// Issue #20: Premiumize answers a magnet or a host link with direct links when it already holds the
// file, and otherwise takes it as a transfer to fetch. These answers follow the documented API
// (https://www.premiumize.me/api, 2026-10-24); no account was available to replay a live one.

const MAGNET = 'magnet:?xt=urn:btih:7acf8fb590b2060dd9c3146ef770169d593433b0&dn=Debian';
const NFO = {path: 'Debian/readme.nfo', size: 1024, link: 'https://storage.premiumize.me/nfo'};
const ISO = {path: 'Debian/debian.iso', size: 792723456, link: 'https://storage-11.premiumize.me/debian.iso'};

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
const keyed = (http, extra = {}) => createPremiumize({http, key: 'test-key', wait: noWait, ...extra});

test('a cached magnet is linked at once, with its largest file', async () => {
  const http = server([
    {match: /\/transfer\/directdl$/, answer: () => ({body: {status: 'success', content: [NFO, ISO]}})},
  ]);
  const prepared = await keyed(http).prepare(MAGNET);
  assert.equal(prepared.url, ISO.link);
  assert.equal(prepared.filename, 'debian.iso');
  assert.equal(prepared.sizeBytes, 792723456);
  assert.equal(http.calls.length, 1);
  assert.equal(new URLSearchParams(http.calls[0].options.body).get('src'), MAGNET);
  assert.equal(http.calls[0].options.headers.Authorization, 'Bearer test-key');
});

test('an uncached magnet becomes a transfer, is polled, then linked', async () => {
  let direct = 0;
  let polls = 0;
  const http = server([
    {match: /\/transfer\/directdl$/, answer: () => ({body: ++direct === 1
      ? {status: 'error', message: 'This file is not cached yet.'}
      : {status: 'success', content: [ISO]}})},
    {match: /\/transfer\/create$/, answer: () => ({body: {status: 'success', id: 'T1', name: 'Debian'}})},
    {match: /\/transfer\/list$/, answer: () => {
      const index = Math.min(polls++, 1);
      return {body: {status: 'success', transfers: [[
        {id: 'T1', name: 'Debian', status: 'running', progress: 0.5, file_id: null, message: null},
      ], [
        {id: 'T1', name: 'Debian', status: 'finished', progress: 1, file_id: 'F1', message: null},
      ]][index]}};
    }},
  ]);
  const progress = [];
  const prepared = await keyed(http).prepare(MAGNET, {onProgress: report => progress.push(report.progress)});
  assert.equal(prepared.url, ISO.link);
  assert.equal(prepared.filename, 'debian.iso');
  // The transfer was made once, polled until finished, and the direct link asked for again.
  assert.equal(http.calls.filter(call => /transfer\/create$/.test(call.url)).length, 1);
  assert.equal(http.calls.filter(call => /transfer\/directdl$/.test(call.url)).length, 2);
  assert.deepEqual(progress, [0.5, 1]);
});

test('a host link Premiumize holds is linked without a transfer', async () => {
  const http = server([
    {match: /\/transfer\/directdl$/, answer: () => ({body: {status: 'success', content: [{path: 'game.zip', size: 2048, link: 'https://storage.premiumize.me/game.zip'}]}})},
  ]);
  const prepared = await keyed(http).prepare('https://host/files/game.zip');
  assert.equal(prepared.url, 'https://storage.premiumize.me/game.zip');
  assert.equal(prepared.filename, 'game.zip');
});

test('a refused key is named as such', async () => {
  const http = server([
    {match: /\/transfer\/directdl$/, answer: () => ({status: 401, body: {status: 'error', message: 'Authentication failed.'}})},
  ]);
  await assert.rejects(keyed(http).prepare('https://host/files/game.pkg'), /rejected the API key/);
});

test('a host Premiumize does not support says what it answered', async () => {
  const http = server([
    {match: /\/transfer\/directdl$/, answer: () => ({body: {status: 'error', message: 'This file is not supported.'}})},
    {match: /\/transfer\/create$/, answer: () => ({body: {status: 'error', message: 'This file is not supported.'}})},
  ]);
  await assert.rejects(keyed(http).prepare('https://host/files/game.pkg'), /Premiumize: This file is not supported\./);
});

test('a transfer Premiumize could not fetch fails with its message', async () => {
  const http = server([
    {match: /\/transfer\/directdl$/, answer: () => ({body: {status: 'error', message: 'not cached'}})},
    {match: /\/transfer\/create$/, answer: () => ({body: {status: 'success', id: 'T9', name: 'Broken'}})},
    {match: /\/transfer\/list$/, answer: () => ({body: {status: 'success', transfers: [{id: 'T9', status: 'error', progress: 0, message: 'No peers available'}]}})},
  ]);
  await assert.rejects(keyed(http).prepare(MAGNET), /could not fetch it \(No peers available\)/);
});

test('waiting too long says to come back, and keeps what Premiumize has', async () => {
  let clock = 0;
  const http = server([
    {match: /\/transfer\/directdl$/, answer: () => ({body: {status: 'error', message: 'not cached'}})},
    {match: /\/transfer\/create$/, answer: () => ({body: {status: 'success', id: 'SLOW', name: 'Debian'}})},
    {match: /\/transfer\/list$/, answer: () => ({body: {status: 'success', transfers: [{id: 'SLOW', status: 'running', progress: 0.2}]}})},
  ]);
  const service = createPremiumize({http, key: 'k', timeoutMs: 10, now: () => (clock += 6), wait: noWait});
  await assert.rejects(service.prepare(MAGNET), /still fetching it\. Add it again later/);
});

test('the largest file wins, bare links count, and only a real one counts', () => {
  assert.equal(pickContent([NFO, ISO])?.url, ISO.link);
  assert.equal(pickContent([{path: 'x', size: 5, link: 'https://a/x'}, {path: 'y', size: 9, link: 'https://a/y'}])?.url, 'https://a/y');
  assert.equal(pickContent(['https://a/bare.bin'])?.url, 'https://a/bare.bin');
  assert.equal(pickContent([]), null);
  assert.equal(pickContent(null), null);
  assert.equal(pickContent([{path: 'x', size: 1, link: 'not-a-link'}]), null);
});
