import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('../state/download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {describeSource} = await import('./sources.js');
const {archiveAccount} = await import('../state/archive-account.js');

const release = {
  id: 'r1', filename: 'game.pkg', url: 'https://archive.org/download/item/game.pkg',
  format: 'pkg', provider: 'archive.org',
  unavailableReason: 'Source unavailable: HTTP 401. Choose another source.',
};

test('without an account an Archive.org refusal keeps the source unavailable', () => {
  assert.equal(describeSource(release).group, 'unavailable');
  assert.equal(describeSource(release).reason, release.unavailableReason);
});

test('with an account the stored refusal no longer hides the source', () => {
  archiveAccount.setField('user', 'alice@example.com');
  archiveAccount.setField('password', 'secret');
  assert.equal(describeSource(release).group, 'direct');
  assert.equal(describeSource(release).reason, null);
});

test('a source says which console it is for', () => {
  assert.equal(describeSource({...release, platform: 'ps4'}).platform, 'ps4');
  assert.equal(describeSource({...release, platform: 'ps5'}).platform, 'ps5');
  assert.equal(describeSource({...release, platform: 'PS5'}).platform, 'ps5');
  assert.equal(describeSource({...release, titleId: 'CUSA00001'}).platform, 'ps4');
  assert.equal(describeSource({...release, titleId: 'PPSA00001'}).platform, 'ps5');
  assert.equal(describeSource({...release}).platform, null);
});

test('the release cache fills a missing platform from the file title id', async () => {
  const {createReleaseCache} = await import('../state/release-cache.js');
  const read = (file) => JSON.stringify([{
    id: 'r1', filename: 'game.pkg', url: 'https://archive.org/download/item/game.pkg',
    format: 'pkg', provider: 'archive.org', source: 'test',
  }]);
  const cache = createReleaseCache(read);
  assert.equal(cache('data/releases/CUSA00001.json')[0].platform, 'ps4');
  assert.equal(cache('data/releases/PPSA00001.json')[0].platform, 'ps5');
});

