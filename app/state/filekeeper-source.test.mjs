import assert from 'node:assert/strict';
import test from 'node:test';
import {createSourceResolver} from './download-sources.js';

// A FileKeeper release as the catalog holds it: the page, its twelve-character code, no known size.
const release = {
  format: 'binary',
  url: 'https://filekeeper.net/ejlzy0u1lrpv',
  browserUrl: 'https://filekeeper.net/ejlzy0u1lrpv'
};
const gateway = 'https://edge01.fetchio.cc/f/s0Jb9lsw8n53AYLRv03-abcdef?sig=0123456789';

// The console's HTTP surface, cut down to what the resolver asks it for. Every call is recorded, so a
// test can say which request carried the parameters.
function consoleHttp({get, post, head} = {}) {
  const asked = [];
  return {
    asked,
    request: async (url, options = {}) => {
      asked.push({url, method: options.method || 'GET', body: options.body, headers: options.headers});
      if (options.method === 'HEAD') return head?.() ?? {ok: true, status: 200, headers: {
        'content-type': 'binary/octet-stream', 'content-length': '75701293992',
        'content-disposition': 'attachment; filename="PPSA31246.7z"',
      }};
      if (options.method === 'POST') return post?.() ?? {ok: true, status: 200, headers: {}, url};
      return get?.() ?? {ok: true, status: 302, headers: {location: gateway}, url};
    }
  };
}

// The resolver waits FileKeeper's five-second countdown before asking; the test does not.
const resolve = async http => createSourceResolver({http}).resolve(release);
const fastResolve = async http => {
  const started = Date.now();
  const answer = await resolve(http);
  assert.ok(Date.now() - started < 15000, 'the countdown must stay near the host\'s five seconds');
  return answer;
};

test('the parameters go in the query string, so no request body is needed', async () => {
  const http = consoleHttp();
  const found = await fastResolve(http);
  const first = http.asked[0];
  assert.equal(first.method, 'GET');
  assert.match(first.url, /^https:\/\/filekeeper\.net\/ejlzy0u1lrpv\?op=download2&id=ejlzy0u1lrpv&rand=&referer=&method_free=&down_direct=1$/);
  assert.equal(first.body, undefined, 'the first try carries no body at all');
  assert.equal(found.url, gateway);
  assert.equal(found.expectedBytes, 75701293992);
  assert.equal(found.rejectHtml, true);
});

test('a host that ignores the query string is answered by the form', async () => {
  const http = consoleHttp({
    get: () => ({ok: true, status: 200, headers: {}, url: release.url}),
    post: () => ({ok: true, status: 302, headers: {location: gateway}, url: release.url})
  });
  const found = await fastResolve(http);
  assert.equal(http.asked.length, 3, 'GET, then POST, then the HEAD that proves the file');
  const post = http.asked.find(call => call.method === 'POST');
  assert.equal(post.url, release.url);
  assert.equal(post.body, 'op=download2&id=ejlzy0u1lrpv&rand=&referer=&method_free=&down_direct=1');
  assert.equal(post.headers.Referer, release.url);
  assert.equal(found.url, gateway);
});

test('a refusal from the host is reported, not mistaken for a file', async () => {
  const http = consoleHttp({
    get: () => ({ok: false, status: 403, headers: {}, url: release.url}),
    post: () => ({ok: false, status: 403, headers: {}, url: release.url})
  });
  await assert.rejects(fastResolve(http), /Browser verification required/);
  assert.equal(http.asked.filter(call => call.method === 'HEAD').length, 0);
});

test('a redirect whose file is a web page still needs the browser', async () => {
  const http = consoleHttp({head: () => ({ok: true, status: 200, headers: {'content-type': 'text/html; charset=utf-8'}})});
  await assert.rejects(fastResolve(http), /Browser verification required/);
});
