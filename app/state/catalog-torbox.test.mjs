import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogTorboxResolver, matchingHost } from './catalog-torbox.js';

const PAGE = 'https://datanodes.to/abc/game';
const CDN = 'https://download.tb-cdn.st/game.zip';
const release = () => ({ id: 'catalog-release', url: PAGE, browserUrl: PAGE,
  filename: 'catalog-game.binary', format: 'binary', archivePassword: 'example', sizeBytes: 999 });
const rows = status => [{ name: 'Data Nodes', domains: ['datanodes.to'], status }];

function harness({ entries = rows(true), hostError = false, key = 'test-key', prepareError, now = () => 1000 } = {}) {
  const calls = [], originals = [], prepared = [], logs = [];
  let currentKey = key;
  const http = { async request(url, options) {
    calls.push({ url, options });
    if (hostError) throw new Error('offline');
    return { status: 200, text: async () => JSON.stringify({ success: true, data: entries }) };
  } };
  const fallback = { async resolve(value, context) {
    originals.push({ value, context });
    return { url: value.url, original: true };
  } };
  const resolver = createCatalogTorboxResolver({ http, fallback, now,
    getKey: () => currentKey, log: message => logs.push(message),
    createClient: token => ({ async prepare(url, context) {
      prepared.push({ token, url, context });
      if (prepareError) throw prepareError;
      context.onProgress({ progress: 0.5 });
      return { url: CDN, sizeBytes: 1234, filename: 'actual-game.zip' };
    } }),
  });
  return { ...resolver, calls, originals, prepared, logs, setKey: value => { currentKey = value; } };
}

test('online supported catalog links convert with actual file size and intact release metadata', async () => {
  const h = harness(), entry = release(), before = structuredClone(entry), progress = [];
  const result = await h.resolve(entry, { catalog: true, onProgress: value => progress.push(value) });
  assert.deepEqual(result, { url: CDN, rejectHtml: true, expectedBytes: 1234, viaTorbox: true });
  assert.deepEqual(entry, before);
  assert.equal(h.originals.length, 0);
  assert.equal(h.prepared[0].url, PAGE);
  assert.equal(h.prepared[0].token, 'test-key');
  assert.deepEqual(progress, [{ service: 'TorBox', progress: 0 }, { service: 'TorBox', progress: 0.5 }, null]);
  assert.equal(h.calls[0].options.headers, undefined, 'the public host list never receives credentials');
});

test('a saved key enables conversion dynamically without restarting the resolver', async () => {
  const h = harness({ key: '' });
  assert.equal((await h.resolve(release(), { catalog: true })).original, true);
  assert.equal(h.calls.length, 0);
  h.setKey('new-key');
  assert.equal((await h.resolve(release(), { catalog: true })).url, CDN);
  assert.equal(h.prepared[0].token, 'new-key');
});

test('offline and unsupported hosts retain the original download flow', async () => {
  for (const entries of [rows(false), [], rows('true')]) {
    const h = harness({ entries });
    assert.equal((await h.resolve(release(), { catalog: true })).original, true);
    assert.equal(h.prepared.length, 0);
  }
});

test('host matching accepts subdomains and rejects domain suffix spoofing', () => {
  assert.ok(matchingHost(rows(true), 'files.datanodes.to'));
  assert.equal(matchingHost(rows(true), 'datanodes.to.evil.example'), undefined);
  assert.equal(matchingHost(rows(true), 'notdatanodes.to'), undefined);
  assert.equal(matchingHost([{ domains: ['.*'] }], 'datanodes.to'), undefined);
});

test('manual/captured links, authenticated links and manifests never auto-convert', async () => {
  for (const [entry, context] of [
    [release(), {}], [release(), { catalog: false }],
    [release(), { catalog: true, directURL: 'https://final.example/file.pkg' }],
    [{ ...release(), manifestUrl: 'https://manifest.example/set.json' }, { catalog: true }],
    [{ ...release(), headers: { Authorization: 'private' } }, { catalog: true }],
  ]) {
    const h = harness();
    assert.equal((await h.resolve(entry, context)).original, true);
    assert.equal(h.calls.length, 0);
    assert.equal(h.prepared.length, 0);
  }
});

test('host list caches refresh and outages back off before retrying', async () => {
  let clock = 1000;
  const h = harness({ now: () => clock });
  await h.resolve(release(), { catalog: true });
  await h.resolve(release(), { catalog: true });
  assert.equal(h.calls.length, 1);
  clock += 5 * 60e3;
  await h.resolve(release(), { catalog: true });
  assert.equal(h.calls.length, 2);
  const broken = harness({ hostError: true, now: () => clock });
  await broken.resolve(release(), { catalog: true });
  await broken.resolve(release(), { catalog: true });
  assert.equal(broken.calls.length, 1);
  assert.equal(broken.prepared.length, 0);
  clock += 30000;
  await broken.resolve(release(), { catalog: true });
  assert.equal(broken.calls.length, 2);
});

test('conversion errors fall back without logging keys or resetting the original release', async () => {
  const h = harness({ prepareError: new Error('denied https://host/?token=test-key') });
  const entry = release();
  assert.equal((await h.resolve(entry, { catalog: true })).original, true);
  assert.equal(h.originals[0].value, entry);
  assert.ok(!h.logs.join('\n').includes('test-key'));
});

test('cancellation never falls through to another download attempt', async () => {
  const signal = { aborted: true };
  const h = harness({ prepareError: new Error('Cancelled') });
  await assert.rejects(h.resolve(release(), { catalog: true, signal }), /Cancelled/);
  assert.equal(h.originals.length, 0);
  assert.equal(h.prepared[0].context.signal, signal);
});

test('the real TorBox client submits the original catalog URL and resolves its web download', async () => {
  const calls = [];
  const ok = data => ({ success: true, data });
  const http = { async request(url, options = {}) {
    calls.push({ url, options });
    const body = url.endsWith('/hosters') ? ok(rows(true))
      : url.endsWith('/createwebdownload') ? ok({ web_id: 7 })
      : url.includes('/mylist?') ? ok({ id: 7, download_finished: true,
        files: [{ id: 3, name: 'game.zip', size: 1234 }] })
      : ok(CDN);
    return { status: 200, text: async () => JSON.stringify(body) };
  } };
  const resolver = createCatalogTorboxResolver({ http, getKey: () => 'test-key',
    fallback: { resolve: () => assert.fail('unexpected original download') }, log() {} });
  assert.equal((await resolver.resolve(release(), { catalog: true })).url, CDN);
  const create = calls.find(call => call.url.endsWith('/createwebdownload'));
  assert.equal(new URLSearchParams(create.options.body).get('link'), PAGE);
  assert.equal(create.options.headers.Authorization, 'Bearer test-key');
  assert.match(calls.at(-1).url, /web_id=7&file_id=3$/);
});
