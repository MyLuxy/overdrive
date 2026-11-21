import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {addLink, base32Hex, fileName, fileNameOf, formatOf, linkId, linkInput, linkRelease, magnetInfo, linkGame} = await import('./link-download.js');
const {DownloadFormats} = await import('../../ps5-react/runtime/js/download-formats.js');

// Issue #107: a pasted link becomes a release the queue accepts. The format this module derives has
// to be the one download-formats.js routes by, or the queue refuses the file before downloading it.
const NAMES = ['game.pkg', 'game.PKG', 'game.fpkg', 'game.zip', 'game.rar', 'game.7z', 'game.tar',
  'game.tar.gz', 'game.exfat', 'game.ffpkg', 'game.ffpfsc', 'movie.mp4', 'notes.txt', 'README', 'a.b.c.bin'];

test('every name the app can meet routes through download-formats', () => {
  for (const name of NAMES) {
    const release = linkRelease({url: 'https://example.com/f/' + name, filename: name});
    const artifact = DownloadFormats.artifact(release, '/data');
    assert.equal(artifact.destination, `${artifact.directory}/${name}`, name);
    assert.ok(artifact.destination.startsWith('/data/'), name);
  }
});

test('a package goes to downloads/packages, an archive to archives, anything else to files', () => {
  const where = name => DownloadFormats.artifact(linkRelease({url: 'https://example.com/x/' + name, filename: name}), '/data').directory;
  assert.equal(where('game.pkg'), '/data/downloads/packages');
  assert.equal(where('game.fpkg'), '/data/downloads/packages');
  assert.equal(where('game.zip'), '/data/downloads/archives');
  assert.equal(where('movie.mp4'), '/data/downloads/files');
  assert.equal(where('game.exfat'), '/data/homebrew');
  assert.equal(formatOf('movie.mp4'), 'binary');
});

test('a file name from a link loses what a file system will not take', () => {
  assert.equal(fileName('a/b'), 'a_b');
  assert.equal(fileName('a\\b'), 'a_b');
  assert.equal(fileName('game\u0000.pkg'), 'game_.pkg');
  assert.equal(fileName('..'), '');
  assert.equal(fileName('.pkg'), '.pkg'.length > 1 ? '.pkg' : '.pkg');
  const long = 'x'.repeat(400) + '.pkg';
  assert.equal(fileName(long).length, 200);
  assert.ok(fileName(long).endsWith('.pkg'));
});

test('the name a URL gives its file, query included', () => {
  assert.equal(fileNameOf('https://host/files/Game.PKG'), 'Game.PKG');
  assert.equal(fileNameOf('https://host/files/game%20one.zip?token=1'), 'game one.zip');
  assert.equal(fileNameOf('https://host/dld/536f032d?token=abc'), '536f032d');
  assert.equal(fileNameOf('https://host/download?file=game.rar'), 'game.rar');
  assert.equal(fileNameOf('https://host/'), '');
});

test('a magnet names its hash, hex or base32, and its file', () => {
  const hex = magnetInfo('magnet:?xt=urn:btih:7ACF8FB590B2060DD9C3146EF770169D593433B0&dn=Debian.ISO');
  assert.equal(hex.hash, '7acf8fb590b2060dd9c3146ef770169d593433b0');
  assert.equal(hex.name, 'Debian.ISO');
  const base = magnetInfo('magnet:?xt=urn:btih:PLHY7NMQWIDA3WODCRXPO4AWTVMTIM5Q');
  assert.equal(base.hash, '7acf8fb590b2060dd9c3146ef770169d593433b0');
  assert.equal(magnetInfo('https://host/file.pkg'), null);
  assert.equal(base32Hex('PLHY7NMQWIDA3WODCRXPO4AWTVMTIM5Q'), '7acf8fb590b2060dd9c3146ef770169d593433b0');
});

test('what the user pasted is checked before anything is queued', () => {
  assert.equal(linkInput('  https://host/a/b/game.pkg  ').kind, 'link');
  assert.equal(linkInput('magnet:?xt=urn:btih:7acf8fb590b2060dd9c3146ef770169d593433b0').kind, 'magnet');
  assert.throws(() => linkInput(''), /link or a magnet/);
  assert.throws(() => linkInput('ftp://host/file.pkg'), /Invalid HTTP URL/);
  assert.throws(() => linkInput('host/file.pkg'), /Invalid HTTP URL/);
});

test('the same link is the same job, another link is another', () => {
  assert.equal(linkId('https://host/a.pkg'), linkId('https://host/a.pkg'));
  assert.notEqual(linkId('https://host/a.pkg'), linkId('https://host/b.pkg'));
});

test('a release carries the service headers and nothing it does not need', () => {
  const plain = linkRelease({url: 'https://host/game.pkg', filename: 'game.pkg'});
  assert.equal(plain.format, 'pkg');
  assert.equal(plain.link, true);
  assert.equal('headers' in plain, false);
  const guarded = linkRelease({url: 'http://192.168.1.10:8080/api/v2/torrents/downloadFile?hash=a&file=b.pkg', filename: 'game.pkg', headers: {Authorization: 'Basic x'}, sizeBytes: 12});
  assert.deepEqual(guarded.headers, {Authorization: 'Basic x'});
  assert.equal(guarded.sizeBytes, 12);
});

test('queueing a link calls the queue it is given, on the drive it is given', () => {
  const seen = [];
  const queue = {
    enqueue(game, release, root) {
      seen.push({game, release, root});
      return `${game.id}/${release.id}`;
    }
  };
  const id = addLink(queue, {url: 'https://host/x/game.pkg', root: '/mnt/usb0'});
  assert.equal(id, 'link/link-' + linkId('https://host/x/game.pkg'));
  assert.equal(seen[0].root, '/mnt/usb0');
  assert.equal(seen[0].game.title, 'game.pkg');
  assert.equal(seen[0].release.filename, 'game.pkg');
  assert.equal(seen[0].release.link, true);
  assert.deepEqual(linkGame('x').releases, []);
});
