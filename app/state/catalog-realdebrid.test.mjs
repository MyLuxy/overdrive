import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogRealDebridResolver } from './catalog-realdebrid.js';
import { createCatalogTorboxResolver } from './catalog-torbox.js';

const URL = 'https://1fichier.com/?example';
const CDN = 'https://node.real-debrid.com/d/example/file.zip';
const release = () => ({ url: URL, filename: 'game.zip', sha256: 'keep-hash', archivePassword: 'keep-password' });
const hosts = { '1fichier.com': { supported: 1, status: 'up' } };

function fixture({ rows = hosts, fail = false } = {}) {
  let settings = { realdebrid: 'test-token' }, clock = 1000;
  const calls = [], originals = [], logs = [];
  const resolver = createCatalogRealDebridResolver({ http: {}, getSettings: () => settings,
    saveSettings() {}, now: () => clock, log: line => logs.push(line),
    createClient: value => ({
      async hosts(context) { calls.push({ kind: 'hosts', value, context }); return rows; },
      async prepare(url, context) {
        calls.push({ kind: 'prepare', url, context, value });
        if (fail) throw new Error('private https://host/?token=test-token');
        return { url: CDN, sizeBytes: 1234 };
      },
    }),
    fallback: { async resolve(entry, context) { originals.push({ entry, context }); return { url: entry.url }; } },
  });
  return { ...resolver, calls, originals, logs, setSettings: value => { settings = value; }, tick: ms => { clock += ms; } };
}

test('supported online Real-Debrid hosts convert without changing release metadata', async () => {
  const f = fixture(), entry = release(), before = structuredClone(entry), progress = [];
  assert.deepEqual(await f.resolve(entry, { catalog: true, onProgress: p => progress.push(p) }),
    { url: CDN, expectedBytes: 1234, rejectHtml: true, viaRealDebrid: true });
  assert.deepEqual(entry, before);
  assert.equal(f.calls[1].url, URL);
  assert.deepEqual(progress, [{ service: 'Real-Debrid', progress: 0 }, null]);
});

test('unsupported, offline, and competitor-only hosts never convert', async () => {
  for (const rows of [{}, { '1fichier.com': { supported: 0, status: 'up' } },
    { '1fichier.com': { supported: 1, status: 'down', competitors_status: { other: { status: 'up' } } } }]) {
    const f = fixture({ rows });
    await f.resolve(release(), { catalog: true });
    assert.equal(f.calls.filter(c => c.kind === 'prepare').length, 0);
    assert.equal(f.originals.length, 1);
  }
});

test('manual, authenticated, captured and manifest routes are preserved', async () => {
  for (const [entry, context] of [[release(), {}], [release(), { catalog: true, directURL: CDN }],
    [{ ...release(), headers: { Authorization: 'private' } }, { catalog: true }],
    [{ ...release(), manifestUrl: 'https://manifest.example/list' }, { catalog: true }]]) {
    const f = fixture(); await f.resolve(entry, context);
    assert.equal(f.calls.length, 0); assert.equal(f.originals.length, 1);
  }
  const f = fixture(); f.setSettings({ realdebrid: '' });
  await f.resolve(release(), { catalog: true }); assert.equal(f.calls.length, 0);
});

test('host cache refreshes after expiry or changing accounts; domain matching is bounded', async () => {
  const f = fixture();
  await f.resolve(release(), { catalog: true });
  await f.resolve({ url: 'https://1fichier.com.evil.example/x' }, { catalog: true });
  assert.equal(f.calls.filter(c => c.kind === 'prepare').length, 1);
  assert.equal(f.calls.filter(c => c.kind === 'hosts').length, 1);
  f.tick(5 * 60e3); await f.resolve(release(), { catalog: true });
  f.setSettings({ realdebrid: 'other-token' }); await f.resolve(release(), { catalog: true });
  assert.equal(f.calls.filter(c => c.kind === 'hosts').length, 3);
  assert.equal(f.calls.at(-1).value.realdebrid, 'other-token');
});

test('failures fall back without logging tokens, while cancellation never falls back', async () => {
  const f = fixture({ fail: true });
  await f.resolve(release(), { catalog: true });
  assert.equal(f.originals.length, 1);
  assert.ok(!f.logs.join().includes('test-token'));
  const cancelled = fixture({ fail: true });
  await assert.rejects(cancelled.resolve(release(), { catalog: true, signal: { aborted: true } }));
  assert.equal(cancelled.originals.length, 0);
});

test('Real-Debrid succeeds before TorBox is contacted', async () => {
  let contacted = false;
  const rd = createCatalogRealDebridResolver({ http: {}, getSettings: () => ({ realdebrid: 'rd-key' }),
    saveSettings() {}, log() {}, createClient: () => ({ hosts: async () => hosts,
      prepare: async () => ({ url: CDN, sizeBytes: 1234 }) }),
    fallback: { resolve: () => { contacted = true; throw new Error('TorBox should not be called'); } },
  });
  assert.equal((await rd.resolve(release(), { catalog: true })).viaRealDebrid, true);
  assert.equal(contacted, false);
});

test('Real-Debrid conversion failure tries TorBox before the original source', async () => {
  let original = false;
  const tb = createCatalogTorboxResolver({ getKey: () => 'tb-key',
    fallback: { resolve: () => { original = true; return {}; } }, log() {},
    http: { request: async () => ({ status: 200, text: async () => JSON.stringify({ success: true,
      data: [{ domains: ['1fichier.com'], status: true }] }) }) },
    createClient: () => ({ prepare: async () => ({ url: 'https://node.tb-cdn.st/file.zip' }) }),
  });
  const rd = createCatalogRealDebridResolver({ http: {}, getSettings: () => ({ realdebrid: 'rd-key' }),
    saveSettings() {}, log() {}, createClient: () => ({ hosts: async () => hosts,
      prepare: async () => { throw new Error('server unavailable'); } }), fallback: tb,
  });
  assert.equal((await rd.resolve(release(), { catalog: true })).viaTorbox, true);
  assert.equal(original, false);
});

test('phone login renewal is saved and used for both host status and unrestriction', async () => {
  let saved, settings = { realdebrid: 'old', realdebridRefresh: 'refresh',
    realdebridClient: 'client', realdebridSecret: 'secret', realdebridExpires: '1' };
  const requests = [];
  const resolver = createCatalogRealDebridResolver({ getSettings: () => settings,
    saveSettings: value => { saved = value; settings = { ...settings, ...value }; },
    fallback: { resolve: () => assert.fail('unexpected fallback') }, log() {},
    http: { async request(url, options) {
      requests.push({ url, options });
      const data = url.endsWith('/token') ? { access_token: 'new', refresh_token: 'next', expires_in: 3600 }
        : url.endsWith('/hosts/status') ? hosts
        : { download: CDN, filesize: 1234, filename: 'file.zip' };
      return { status: 200, text: async () => JSON.stringify(data) };
    } },
  });
  assert.equal((await resolver.resolve(release(), { catalog: true })).url, CDN);
  assert.equal(saved.realdebrid, 'new');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer new');
  assert.equal(requests[2].options.headers.Authorization, 'Bearer new');
  assert.equal(new URLSearchParams(requests[2].options.body).get('link'), URL);
});
