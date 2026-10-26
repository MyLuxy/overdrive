import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {Expired, accountOf, createDeviceLogin, refreshRealDebrid} = await import('./device-login.js');
const {createRealDebrid} = await import('./realdebrid.js');
const {qrcodegen} = await import('../third_party/qrcodegen.js');

// A service that answers from a script: each URL prefix maps to the answers it gives in turn.
function service(script) {
  const calls = [];
  const http = {
    async request(url, options = {}) {
      calls.push({url, ...options});
      const key = Object.keys(script).find(prefix => url.startsWith(prefix));
      if (!key) throw new Error(`unexpected ${url}`);
      const answers = script[key];
      const [status, body] = answers.length > 1 ? answers.shift() : answers[0];
      return {status, ok: status < 300, headers: {}, text: async () => typeof body === 'string' ? body : JSON.stringify(body)};
    },
  };
  return {http, calls};
}
const clock = () => {
  let time = 1_000_000;
  return {now: () => time, wait: async ms => { time += ms; }};
};

// The live API's own answers, 2026-10-25.
const TORBOX_START = {success: true, error: null, detail: 'Successfully created your device code authorization.', data: {
  device_code: 'IGIfdNrA_8bD5yBA3YxEiFnfKSaJTacArJDkE33RB2U', code: '583133', interval: 5, expires_in: 600,
  verification_url: 'https://torbox.app/oauth/device?app=Overdrive',
  verification_url_complete: 'https://torbox.app/oauth/device?app=Overdrive&code=583133',
  friendly_verification_url: 'https://tor.box/link'}};
const TORBOX_PENDING = {success: false, error: 'DEVICE_CODE_NOT_USED', detail: 'This device code has not been used yet. Please wait for the user to scan the code.', data: null};
const RD_START = {device_code: 'HPF6V3HW3RBOOJNHLBZUGBHVAKOODPZBF3SWF2Z7FXNVX6TEAPZA', user_code: 'VNBENEFA', interval: 5, expires_in: 900,
  verification_url: 'https://real-debrid.com/device',
  direct_verification_url: 'https://real-debrid.com/authorize?client_id=X245A4XAIBGVM&device_id=HPF6V3HW3RBOOJNHLBZUGBHVAKOODPZBF3SWF2Z7FXNVX6TEAPZA'};

test('TorBox shows its six digits, its short page and a QR of the page with the code in it', async () => {
  const {http} = service({'https://api.torbox.app/v1/api/user/auth/device/start': [[200, TORBOX_START]]});
  const session = await createDeviceLogin({http, service: 'torbox', ...clock()}).start();
  assert.equal(session.code, '583133');
  assert.equal(session.page, 'tor.box/link');
  assert.equal(session.qr, 'https://torbox.app/oauth/device?app=Overdrive&code=583133');
  assert.equal(session.interval, 5000);
});

test('TorBox is asked again until the player approves, and its token is the key', async () => {
  const {http, calls} = service({
    'https://api.torbox.app/v1/api/user/auth/device/start': [[200, TORBOX_START]],
    'https://api.torbox.app/v1/api/user/auth/device/token': [[400, TORBOX_PENDING], [400, TORBOX_PENDING], [200, {success: true, data: {access_token: 'tb-key-1234', token_type: 'Bearer'}}]],
  });
  const login = createDeviceLogin({http, service: 'torbox', ...clock()});
  const values = await login.approved(await login.start());
  assert.deepEqual(values, {torbox: 'tb-key-1234'});
  const polls = calls.filter(call => call.url.endsWith('/token'));
  assert.equal(polls.length, 3);
  assert.equal(polls[0].method, 'POST');
  assert.equal(polls[0].body, JSON.stringify({device_code: TORBOX_START.data.device_code}));
});

test('a TorBox answer that names its key differently still links the account', async () => {
  const {http} = service({
    'https://api.torbox.app/v1/api/user/auth/device/start': [[200, TORBOX_START]],
    'https://api.torbox.app/v1/api/user/auth/device/token': [[200, {success: true, data: {expires_in: 0, key: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b'}}]],
  });
  const login = createDeviceLogin({http, service: 'torbox', ...clock()});
  assert.deepEqual(await login.approved(await login.start()), {torbox: '1b2c3d4e-5f60-4718-9a0b-1c2d3e4f5a6b'});
});

test('a code that runs out is reported as expired, so the dialog asks for a new one', async () => {
  const {http} = service({
    'https://api.torbox.app/v1/api/user/auth/device/start': [[200, TORBOX_START]],
    'https://api.torbox.app/v1/api/user/auth/device/token': [[400, TORBOX_PENDING]],
  });
  const login = createDeviceLogin({http, service: 'torbox', ...clock()});
  await assert.rejects(login.approved(await login.start()), Expired);
  const gone = service({
    'https://api.torbox.app/v1/api/user/auth/device/start': [[200, TORBOX_START]],
    'https://api.torbox.app/v1/api/user/auth/device/token': [[400, {success: false, error: 'ITEM_NOT_FOUND', detail: 'expired'}]],
  });
  const again = createDeviceLogin({http: gone.http, service: 'torbox', ...clock()});
  await assert.rejects(again.approved(await again.start()), Expired);
});

test('Real-Debrid: the code, then this user\'s own client, then the tokens that renew themselves', async () => {
  const time = clock();
  const {http, calls} = service({
    'https://api.real-debrid.com/oauth/v2/device/code': [[200, RD_START]],
    'https://api.real-debrid.com/oauth/v2/device/credentials': [[403, {error: null, error_code: null}], [200, {client_id: 'USERCLIENT', client_secret: 'secret'}]],
    'https://api.real-debrid.com/oauth/v2/token': [[200, {access_token: 'rd-access', expires_in: 3600, token_type: 'Bearer', refresh_token: 'rd-refresh'}]],
  });
  const login = createDeviceLogin({http, service: 'realdebrid', ...time});
  const session = await login.start();
  assert.equal(session.code, 'VNBENEFA');
  assert.equal(session.page, 'real-debrid.com/device');
  assert.equal(session.qr, RD_START.direct_verification_url);
  assert.ok(calls[0].url.includes('client_id=X245A4XAIBGVM&new_credentials=yes'));
  const values = await login.approved(session);
  assert.equal(values.realdebrid, 'rd-access');
  assert.equal(values.realdebridRefresh, 'rd-refresh');
  assert.equal(values.realdebridClient, 'USERCLIENT');
  assert.equal(values.realdebridSecret, 'secret');
  assert.ok(Number(values.realdebridExpires) > time.now());
  const exchange = calls.find(call => call.url.endsWith('/oauth/v2/token'));
  assert.equal(exchange.method, 'POST');
  assert.match(exchange.body, /client_id=USERCLIENT&client_secret=secret&code=HPF6V3HW.*&grant_type=http%3A%2F%2Foauth\.net%2Fgrant_type%2Fdevice%2F1\.0/);
});

test('a Real-Debrid token about to lapse is renewed before the call, and a refused one once after it', async () => {
  const {http, calls} = service({
    'https://api.real-debrid.com/oauth/v2/token': [[200, {access_token: 'rd-new', expires_in: 3600, refresh_token: 'rd-refresh-2'}]],
    'https://api.real-debrid.com/rest/1.0/unrestrict/link': [[200, {download: 'https://node.real-debrid.com/d/file.pkg', filename: 'file.pkg', filesize: 10}]],
  });
  let saved = null;
  const renew = async ({signal}) => {
    saved = await refreshRealDebrid({http, client: 'USERCLIENT', secret: 'secret', refresh: 'rd-refresh', signal});
    return saved;
  };
  const client = createRealDebrid({http, key: 'rd-old', renew, expiresAt: Date.now() + 30e3});
  const file = await client.unrestrict('https://host.example/f/1');
  assert.equal(file.url, 'https://node.real-debrid.com/d/file.pkg');
  assert.equal(saved.realdebrid, 'rd-new');
  assert.equal(saved.realdebridRefresh, 'rd-refresh-2');
  const unrestrict = calls.find(call => call.url.endsWith('/unrestrict/link'));
  assert.equal(unrestrict.headers.Authorization, 'Bearer rd-new');

  const refused = service({
    'https://api.real-debrid.com/oauth/v2/token': [[200, {access_token: 'rd-fresh', expires_in: 3600, refresh_token: 'r'}]],
    'https://api.real-debrid.com/rest/1.0/unrestrict/link': [[401, {error: 'bad_token', error_code: 8}], [200, {download: 'https://node.real-debrid.com/d/2.pkg', filename: '2.pkg', filesize: 1}]],
  });
  const again = createRealDebrid({http: refused.http, key: 'rd-old', renew: ({signal}) => refreshRealDebrid({http: refused.http, client: 'c', secret: 's', refresh: 'r', signal})});
  assert.equal((await again.unrestrict('https://host.example/f/2')).url, 'https://node.real-debrid.com/d/2.pkg');
  assert.equal(refused.calls.filter(call => call.url.endsWith('/unrestrict/link')).length, 2);
});

test('a typed Real-Debrid token is never renewed: a refusal says so', async () => {
  const {http} = service({'https://api.real-debrid.com/rest/1.0/unrestrict/link': [[401, {error: 'bad_token', error_code: 8}]]});
  await assert.rejects(createRealDebrid({http, key: 'typed'}).unrestrict('https://host.example/f/1'), /rejected the token/);
});

test('the account a key belongs to is named with its email masked', async () => {
  const {http} = service({'https://api.torbox.app/v1/api/user/me': [[200, {success: true, data: {email: 'alexandro@example.com', plan: 2, premium_expires_at: '2027-03-12T00:00:00Z'}}]]});
  assert.deepEqual(await accountOf({http, service: 'torbox', key: 'k'}), {name: 'al***@example.com', plan: 'Pro', until: '2027-03-12'});
  const rd = service({'https://api.real-debrid.com/rest/1.0/user': [[200, {username: 'luxy', type: 'premium', expiration: '2027-01-02T10:00:00.000Z'}]]});
  assert.deepEqual(await accountOf({http: rd.http, service: 'realdebrid', key: 'k'}), {name: 'luxy', plan: 'Premium', until: '2027-01-02'});
});

test('both approval pages fit a QR code a TV shows at 380 px', () => {
  for (const text of [TORBOX_START.data.verification_url_complete, RD_START.direct_verification_url]) {
    const code = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
    // Whole pixels per module with the quiet zone: at least 6 px, which a phone reads across a room.
    assert.ok(Math.floor(380 / (code.size + 8)) >= 6, `${text}: ${code.size} modules`);
  }
});
