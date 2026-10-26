import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createPkgHelper} = await import('./pkg-helper.js');

// A helper payload behind 127.0.0.1: `up` says whether it answers; it keeps the links it is given.
function world({up = false, savedConfig = null} = {}) {
  const files = new Map();
  if (savedConfig) files.set('/q/pkg-helper.json', JSON.stringify(savedConfig));
  const fs = {readFile: path => files.get(path) ?? '', writeFile: (path, data) => files.set(path, data), mkdir() {}};
  const state = {up, starts: [], links: new Map(), calls: []};
  const packages = {
    async startHelper(request) {
      state.starts.push(request);
      state.up = true;
      return {port: request.port || 42000};
    },
  };
  const http = {
    async request(url, options = {}) {
      state.calls.push({url, ...options});
      if (!state.up) throw new Error('Http.request: Could not connect to server');
      const command = url.split('/').pop();
      const answer = text => ({status: 200, text: async () => text});
      if (command === 'ping') return answer('ok 42000\n');
      if (command === 'stats') return answer([...state.links].map(([token, link]) => `${token} ${link.total} 1000 3 50 2 2048`).join('\n') + '\n');
      if (command === 'add') {
        const [token, total, link, file] = options.body.split('\n');
        const named = token === '-' ? 'a'.repeat(64) : token;
        state.links.set(named, {total: Number(total), url: link});
        return answer(`token=${named}\nurl=http://192.168.1.20:42000/${named}/${file}\nlocal=http://127.0.0.1:42000/${named}/${file}\nport=42000\n`);
      }
      return answer('ok\n');
    },
  };
  return {fs, files, state, helper: createPkgHelper({packages, http, fs, dir: '/q', log: '/data/pkg-helper.log'})};
}

test('the first link starts the helper and keeps its port and secret for the next session', async () => {
  const {helper, state, files} = world();
  const served = await helper.add({url: 'https://cdn.example/a.pkg', total: 5e9, file: 'a.pkg'});
  assert.equal(state.starts.length, 1);
  assert.equal(state.starts[0].port, 0);
  assert.ok(state.starts[0].secret.length >= 16);
  assert.equal(state.starts[0].log, '/data/pkg-helper.log');
  assert.deepEqual(served, {url: `http://192.168.1.20:42000/${'a'.repeat(64)}/a.pkg`, localUrl: `http://127.0.0.1:42000/${'a'.repeat(64)}/a.pkg`, token: 'a'.repeat(64), port: 42000, background: true});
  assert.deepEqual(JSON.parse(files.get('/q/pkg-helper.json')), {port: 42000, secret: state.starts[0].secret});
  const add = state.calls.find(call => call.url.endsWith('/add'));
  assert.equal(add.method, 'POST');
  assert.ok(add.url.startsWith(`http://127.0.0.1:42000/control/${state.starts[0].secret}/`));
});

test('a helper still running from before is used as it is, and one that is gone starts on the same port', async () => {
  const running = world({up: true, savedConfig: {port: 42000, secret: 's'.repeat(20)}});
  await running.helper.add({url: 'https://cdn.example/b.pkg', total: 1, file: 'b.pkg', token: 'b'.repeat(64)});
  assert.equal(running.state.starts.length, 0);
  assert.ok(running.state.links.has('b'.repeat(64)));
  const gone = world({up: false, savedConfig: {port: 42000, secret: 's'.repeat(20)}});
  await gone.helper.ensure();
  assert.deepEqual(gone.state.starts, [{port: 42000, secret: 's'.repeat(20), log: '/data/pkg-helper.log'}]);
});

test('the progress of each link is read back from the helper', async () => {
  const {helper} = world({up: true, savedConfig: {port: 42000, secret: 's'.repeat(20)}});
  await helper.add({url: 'https://cdn.example/c.pkg', total: 9000, file: 'c.pkg', token: 'c'.repeat(64)});
  assert.deepEqual(await helper.stats(), [{token: 'c'.repeat(64), total: 9000, delivered: 1000, requests: 3, idleMs: 50, gets: 2, asked: 2048}]);
});
