import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadConnections } from './download-connections.js';

test('new and saved TorBox CDN URLs use sixteen connections, including pasted links', () => {
  for (const host of ['tb-cdn.io', 'download.tb-cdn.io', 'download.tb-cdn.st', 'nexus.latm.tb-cdn.cx', 'nexus.erth.tb-cdn.earth', 'cdn.torbox.app'])
    assert.equal(downloadConnections({ url: `https://${host}/file.zip` }), 16);
  assert.equal(downloadConnections({ url: 'https://future-cdn.example/file.zip' }, true), 16);
});

test('other hosts retain their policy and domain suffix spoofing cannot select TorBox', () => {
  for (const host of ['node.real-debrid.com', 'github.com', 'tb-cdn.io.example', 'nottb-cdn.io'])
    assert.equal(downloadConnections({ url: `https://${host}/file.zip` }), 64);
  assert.equal(downloadConnections({}), 64);
});
