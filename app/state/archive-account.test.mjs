import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {createArchiveAccount} = await import('./archive-account.js');

const ARCHIVE = 'https://archive.org/download/item/game.pkg';
const NODE = 'https://dn123.ca.archive.org/0/items/item/game.pkg';
const COOKIE = 'logged-in-user=alice; logged-in-sig=sig123';

function storage(initial = {}) {
  let settings = {...initial};
  return {
    read: () => ({...settings}),
    write: next => { settings = {...next}; },
    settings: () => ({...settings}),
  };
}

function httpWith(answers) {
  const calls = [];
  return {
    calls,
    async request(url, options) {
      calls.push({url, options});
      const answer = answers.shift();
      if (!answer) throw new Error('unexpected request: ' + url);
      if (answer instanceof Error) throw answer;
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        headers: answer.headers || {},
        text: async () => typeof answer.text === 'string' ? answer.text : '',
      };
    },
  };
}

function signedIn() {
  return {status: 200, text: JSON.stringify({
    success: true,
    values: {cookies: {'logged-in-user': 'alice', 'logged-in-sig': 'sig123'}, screenname: 'Alice'},
  })};
}

test('without credentials no request is made and no cookie is sent', async () => {
  const http = httpWith([]);
  const account = createArchiveAccount({http, read: () => ({}), write: () => {}});
  assert.equal(account.enabled(), false);
  assert.deepEqual(await account.headersFor(ARCHIVE), {});
  assert.deepEqual(await account.headersFor('https://example.com/game.pkg'), {});
  assert.equal(http.calls.length, 0);
  assert.equal(account.snapshot().signedIn, false);
});

test('a sign-in keeps the two cookies and sends them to Archive.org only', async () => {
  const store = storage();
  const http = httpWith([signedIn()]);
  const account = createArchiveAccount({http, read: store.read, write: store.write, log: () => {}});
  account.setField('user', ' alice@example.com ');
  account.setField('password', 'secret pass');

  assert.equal(account.enabled(), true);
  assert.deepEqual(store.settings(), {archiveUser: 'alice@example.com', archivePassword: 'secret pass'});

  await account.signIn();
  assert.equal(http.calls[0].url, 'https://archive.org/services/xauthn/?op=login');
  assert.equal(http.calls[0].options.method, 'POST');
  assert.equal(http.calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(http.calls[0].options.body, 'email=alice%40example.com&password=secret%20pass');

  assert.deepEqual(await account.headersFor(ARCHIVE), {Cookie: COOKIE});
  assert.deepEqual(await account.headersFor(NODE), {Cookie: COOKIE});
  assert.deepEqual(await account.headersFor('https://example.com/game.pkg'), {});
  assert.equal(account.snapshot().signedIn, true);
  assert.equal(account.snapshot().screenname, 'Alice');
});

test('the first request signs in by itself; a bad password is a clear error', async () => {
  const store = storage({archiveUser: 'alice@example.com', archivePassword: 'wrong'});
  const http = httpWith([{status: 200, text: JSON.stringify({success: false, values: {reason: 'account_bad_password'}})}]);
  const account = createArchiveAccount({http, read: store.read, write: store.write, log: () => {}});

  await assert.rejects(() => account.headersFor(ARCHIVE), /refused that password/);
  assert.equal(account.snapshot().signedIn, false);

  const missing = createArchiveAccount({
    http: httpWith([{status: 200, text: JSON.stringify({success: false, values: {reason: 'account_not_found'}})}]),
    read: store.read, write: store.write, log: () => {},
  });
  await assert.rejects(() => missing.signIn(), /no account with that email/);
});

test('a refused session is refreshed with a new sign-in', async () => {
  const store = storage({archiveUser: 'alice@example.com', archivePassword: 'secret'});
  const http = httpWith([signedIn(), signedIn()]);
  const account = createArchiveAccount({http, read: store.read, write: store.write, log: () => {}});
  await account.signIn();
  await account.refresh();
  assert.equal(http.calls.length, 2);
  assert.deepEqual(await account.headersFor(ARCHIVE), {Cookie: COOKIE});
});

test('the archival link is followed to the node, and a refusal is an HTTP error', async () => {
  const store = storage({archiveUser: 'alice@example.com', archivePassword: 'secret'});
  const following = createArchiveAccount({
    http: httpWith([{status: 302, headers: {location: NODE}}, {status: 200}]),
    read: store.read, write: store.write, log: () => {},
  });
  assert.equal(await following.resolve(ARCHIVE, {Cookie: COOKIE}), NODE);

  const refused = createArchiveAccount({
    http: httpWith([{status: 401}]),
    read: store.read, write: store.write, log: () => {},
  });
  await assert.rejects(() => refused.resolve(ARCHIVE, {Cookie: COOKIE}), /HTTP 401/);
});

test('signing out forgets the session and the saved credentials', async () => {
  const store = storage();
  const account = createArchiveAccount({http: httpWith([signedIn()]), read: store.read, write: store.write, log: () => {}});
  account.setField('user', 'alice@example.com');
  account.setField('password', 'secret');
  await account.signIn();
  await account.signOut();
  assert.deepEqual(store.settings(), {});
  assert.equal(account.enabled(), false);
  assert.equal(account.snapshot().signedIn, false);
  assert.deepEqual(await account.headersFor(ARCHIVE), {});
});
