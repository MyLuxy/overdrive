// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import test from 'node:test';
import {DownloadFormats} from './download-formats.js';

test('all catalog formats route to the correct consumer', () => {
  for (const format of DownloadFormats.images) {
    const result = DownloadFormats.artifact({format, filename: `game.${format}`}, '/data');
    assert.equal(result.destination, `/data/homebrew/game.${format}`);
    assert.equal(result.nextAction, 'shadowmount');
  }
  for (const format of ['pkg', 'fpkg']) {
    const result = DownloadFormats.artifact({format, filename: 'game.pkg'}, '/mnt/usb0');
    assert.equal(result.destination, '/mnt/usb0/downloads/packages/game.pkg');
    assert.equal(result.nextAction, 'installer-required');
  }
  for (const format of DownloadFormats.archives) {
    assert.equal(DownloadFormats.artifact({format, filename: `game.${format}`}, '/data').nextAction, 'extraction-required');
  }
  assert.equal(DownloadFormats.artifact({filename: 'file.bin'}, '/data').nextAction, 'downloaded');
  assert.throws(() => DownloadFormats.artifact({format: 'fpkg', filename: 'game.ffpkg'}, '/data'), /disagree/);
  for (const filename of ['../game.pkg', 'game/eboot.bin', 'game\u0000.pkg', 'game.ffpfsc.part0', 'game.001']) {
    assert.throws(() => DownloadFormats.artifact({filename}, '/data'));
  }
  assert.throws(() => DownloadFormats.artifact({filename: 'game.pkg'}, '/data/../user'));
});

test('a file of unknown format routes by the kind its bytes revealed', () => {
  const file = {filename: 'PPSA12345-game-1.00-pegasus-0-1-0.binary'};
  assert.deepEqual(DownloadFormats.detected(file, '/data', 'rar'), {format: 'rar', nextAction: 'extraction-required',
    directory: '/data/downloads/archives', destination: '/data/downloads/archives/PPSA12345-game-1.00-pegasus-0-1-0.rar'});
  assert.equal(DownloadFormats.detected(file, '/data', 'tar.zst').destination, '/data/downloads/archives/PPSA12345-game-1.00-pegasus-0-1-0.tar.zst');
  assert.equal(DownloadFormats.detected(file, '/data', 'pkg').nextAction, 'installer-required');
  assert.equal(DownloadFormats.detected(file, '/mnt/usb0', 'exfat').destination, '/mnt/usb0/homebrew/PPSA12345-game-1.00-pegasus-0-1-0.exfat');
  assert.throws(() => DownloadFormats.detected(file, '/data', 'exe'), /unknown detected kind/);
});

test('split manifests normalize out-of-order offsets and preserve exact bytes and hashes', () => {
  const manifest = {originalFileSize: 6, numberOfSplitFiles: 2, packageDigest: 'A'.repeat(64), pieces: [
    {url: 'https://example.com/b', fileOffset: 2, fileSize: 4, hashValue: 'B'.repeat(40)},
    {url: 'https://example.com/a', fileOffset: 0, fileSize: 2, hashValue: 'C'.repeat(40)},
  ]};
  const result = DownloadFormats.manifest(manifest);
  assert.equal(result.expectedBytes, 6);
  assert.equal(result.sha256, 'a'.repeat(64));
  assert.deepEqual(result.pieces.map(piece => piece.offset), [0, 2]);
  assert.equal(result.pieces[0].sha1, 'c'.repeat(40));
  assert.equal(manifest.pieces[0].fileOffset, 2);
  for (const invalid of [
    {...manifest, numberOfSplitFiles: 3}, {...manifest, originalFileSize: 7},
    {...manifest, packageDigest: 'invalid'},
    {...manifest, pieces: manifest.pieces.map(piece => ({...piece, fileOffset: 0}))},
    {...manifest, pieces: manifest.pieces.map(piece => ({...piece, fileSize: Number.MAX_SAFE_INTEGER}))},
    {...manifest, pieces: manifest.pieces.map(piece => ({...piece, url: 'file:///data/file'}))},
  ]) assert.throws(() => DownloadFormats.manifest(invalid));
});
