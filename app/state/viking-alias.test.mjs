import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {sourceKind} from './download-sources.js';
import {describeVikingCapture, validateVikingCapture} from './viking-capture.js';
import {pausedSource} from './paused-hosts.js';

const release = JSON.parse(readFileSync(new URL('../data/releases/PPSA38500.json', import.meta.url)))[0];
const filename = 'Grand Theft Auto VI [PPSA38500] [v01.002].pkg';

test('the added GTA VI source uses Vikingfile verification and stays visible', () => {
  assert.equal(sourceKind(release), 'vikingfile');
  assert.equal(pausedSource(release), false);
  assert.equal(release.requiresBrowser, true);
  assert.equal(release.format, 'pkg');
  assert.equal(release.sizeBytes, null, 'the unverified byte size must not be copied from the other catalog');
  assert.equal(release.archivePassword, undefined, 'no archive password is published for this PKG');
});

test('the new alias exposes its filename and displayed size through the normal metadata flow', async () => {
  const metadata = await describeVikingCapture({request: async url => {
    assert.equal(url, release.url);
    return {ok: true, text: async () => `<span id="filename">${filename}</span><span id="size">205.85 GB</span>`};
  }}, release);
  assert.equal(metadata.filename, filename);
  assert.deepEqual(metadata.displaySize, {value: 205.85, precision: 2, unit: 'GB'});
});

test('a filename-bound download on the alias still requires a verified one-byte range', async () => {
  const url = `https://vik1ngf1le.online/d/JbQIQC9EMm/${encodeURIComponent(filename)}`;
  const http = {request: async (asked, options) => {
    assert.equal(asked, url);
    assert.equal(options.headers.Range, 'bytes=0-0');
    return {ok: true, status: 206, headers: {
      'content-range': 'bytes 0-0/1024', 'content-length': '1',
      'content-type': 'application/octet-stream', etag: '"same-file"',
    }, text: async () => 'x'};
  }};
  assert.deepEqual(await validateVikingCapture(http, url, {filename, expectedBytes: 1024}), {url, expectedBytes: 1024});
});

test('lookalike aliases cannot be used as metadata pages or captured downloads', async () => {
  const http = {request: async () => {throw new Error('Unexpected network request');}};
  await assert.rejects(describeVikingCapture(http, {...release, browserUrl: release.url.replace('.online', '.online.evil.test')}), /Unsupported Vikingfile page/);
  await assert.rejects(validateVikingCapture(http,
    `https://vik1ngf1le.online.evil.test/d/JbQIQC9EMm/${encodeURIComponent(filename)}`, {filename}), /does not match/);
});
