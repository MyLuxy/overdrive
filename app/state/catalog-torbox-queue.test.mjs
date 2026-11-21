import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const { createDownloadQueue } = await import('./download-queue.js');
const { createCatalogTorboxResolver } = await import('./catalog-torbox.js');

function fixture({ gameId = 'PPSA99900', parts = false, waitParts = true, expireFirst = false, realdebrid = false } = {}) {
  const files = new Map(), directories = new Set(['/data']);
  const contexts = [], transport = [], reports = [];
  const fs = {
    exists: path => files.has(path) || directories.has(path),
    stat: path => directories.has(path) ? { isDirectory: true, device: 1, inode: 1, modified: 0 }
      : files.has(path) ? { isFile: true, size: 1234, modified: 0 } : null,
    diskUsage: () => ({ free: 1024 ** 4 }), mkdir: path => directories.add(path),
    writeFile: (path, data) => files.set(path, data), readFile: path => files.get(path) ?? '',
    rename: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    readDir: () => [], removeAsync: async path => files.delete(path),
  };
  const auto = createCatalogTorboxResolver({
    http: { request: async () => ({ status: 200, text: async () => JSON.stringify({ success: true,
      data: [{ domains: ['datanodes.to'], status: true }] }) }) },
    getKey: () => 'test-key', log() {},
    fallback: { resolve: async entry => ({ url: entry.url }) },
    createClient: () => ({ prepare: async (_, { onProgress }) => {
      onProgress({ progress: 0.5 });
      return { url: 'https://download.tb-cdn.st/demo.exfat', sizeBytes: 1234 };
    } }),
  });
  const sources = { async resolve(entry, context) {
    contexts.push({ entry, context });
    if (parts && waitParts) return new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(new Error('Cancelled'))));
    if (realdebrid) return { url: 'https://node.real-debrid.com/file.zip', viaRealDebrid: true, expectedBytes: 1234 };
    return auto.resolve(entry, context);
  } };
  const queue = createDownloadQueue({ fs, dataDir: '/data', platform: 'desktop', sources,
    downloads: { enqueue(options) {
      transport.push(options);
      if (expireFirst && transport.length === 1) return {
        done: Promise.reject(new Error('HTTP 403; browser verification required')),
        subscribe: () => () => {}, cancel() {},
      };
      files.set(options.destination, 'file');
      return { done: Promise.resolve({ written: 1234 }), subscribe: () => () => {}, cancel() {} };
    } },
    formats: { artifact: (entry, root) => ({ directory: root + '/homebrew',
      destination: root + '/homebrew/' + entry.filename, nextAction: 'shadowmount' }) },
    notifications: { show() {} }, power: { keepAwake() {} },
  });
  queue.subscribe(jobs => { if (jobs[0]?.message) reports.push(jobs[0].message); });
  const release = { id: 'source', filename: 'demo.exfat', format: 'exfat',
    url: 'https://datanodes.to/abc/demo.exfat', sizeBytes: 999, archivePassword: 'keep-me',
    ...(gameId === 'link' ? { link: true } : {}),
    ...(parts ? { parts: [{ number: 1, sources: [{ url: 'https://datanodes.to/abc/part1' }] }] } : {}),
  };
  const id = queue.enqueue({ id: gameId, title: 'Demo' }, release, '/data');
  return { queue, id, contexts, transport, reports };
}

async function until(predicate) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Queue did not reach the expected state');
}

test('a direct catalog URL passes through automatic TorBox resolution before transport', async () => {
  const f = fixture();
  await until(() => f.transport.length);
  assert.equal(f.contexts[0].context.catalog, true);
  assert.equal(f.transport[0].url, 'https://download.tb-cdn.st/demo.exfat');
  assert.equal(f.transport[0].expectedBytes, 1234);
  assert.equal(f.transport[0].connections, 16);
  assert.equal(f.transport[0].destination, '/data/homebrew/demo.exfat');
  const job = f.queue.snapshot()[0];
  assert.equal(job.release.archivePassword, 'keep-me');
  assert.equal(job.release.url, 'https://datanodes.to/abc/demo.exfat');
  assert.equal(job.viaTorbox, true);
  assert.equal(f.transport[0].viaTorbox, undefined, 'service metadata stays outside transport options');
  assert.ok(f.reports.some(message => message.endsWith('50%')));
  assert.equal(job.message, undefined, 'preparation message clears after conversion');
});

test('an expired TorBox link is prepared again even for browser-only catalog hosts', async () => {
  const f = fixture({ expireFirst: true });
  await until(() => f.queue.snapshot()[0]?.state === 'downloaded');
  assert.equal(f.transport.length, 2);
  assert.equal(f.contexts.length, 2);
  assert.equal(f.queue.snapshot()[0].error, '');
});

test('a pasted link retains its original route instead of automatic conversion', async () => {
  const f = fixture({ gameId: 'link' });
  await until(() => f.transport.length);
  assert.equal(f.contexts[0].context.catalog, false);
  assert.equal(f.transport[0].url, 'https://datanodes.to/abc/demo.exfat');
});

test('catalog multipart sources receive the same automatic-conversion context', async () => {
  const f = fixture({ parts: true });
  await until(() => f.contexts.length);
  assert.equal(f.contexts[0].context.catalog, true);
  assert.equal(f.contexts[0].entry.url, 'https://datanodes.to/abc/part1');
  f.queue.pause(f.id);
  await until(() => f.queue.snapshot()[0].state === 'paused');
});

test('multipart TorBox downloads also use sixteen connections', async () => {
  const f = fixture({ parts: true, waitParts: false });
  await until(() => f.transport.length);
  assert.equal(f.transport[0].connections, 16);
});

test('Real-Debrid conversion can refresh an expired catalog URL without leaking metadata to transport', async () => {
  const f = fixture({ realdebrid: true, expireFirst: true });
  await until(() => f.queue.snapshot()[0]?.state === 'downloaded');
  assert.equal(f.transport.length, 2);
  assert.equal(f.queue.snapshot()[0].viaRealDebrid, true);
  assert.equal(f.transport[0].viaRealDebrid, undefined);
  assert.equal(f.transport[0].connections, 64, 'the native Real-Debrid policy still applies separately');
});
