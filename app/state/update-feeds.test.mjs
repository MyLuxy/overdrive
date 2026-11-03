import assert from 'node:assert/strict';
import test from 'node:test';

const {createUpdater} = await import('./updater.js');

// The update check asks every feed at once and keeps the newest release: GitHub's release API while
// the account answers, and the project's own feed on GitLab. One host going quiet must not leave an
// installed Overdrive unable to update (update.js holds the two addresses).

const FEEDS = [{name: 'github', url: 'https://github.test/latest'}, {name: 'gitlab', url: 'https://gitlab.test/feed.json'}];

function release(tag, {asset = 'update.zip', digest = `sha256:${'a'.repeat(64)}`} = {}) {
  return {
    tag_name: tag,
    body: `notes of ${tag}`,
    assets: [{name: asset, size: 32_827_690, digest, browser_download_url: `https://gitlab.test/${tag}/${asset}`}],
  };
}

function updater(answers, version = '1.0.9') {
  const http = {
    request: async (url) => {
      const answer = answers[url];
      if (answer === undefined) throw new Error('unexpected feed');
      if (answer instanceof Error) throw answer;
      return {ok: true, json: async () => answer};
    },
  };
  return createUpdater({
    http,
    downloads: {},
    archives: {},
    fs: {exists: () => false},
    version,
    feeds: FEEDS,
    asset: 'update.zip',
    installDir: '/apps/PPSA99058',
    workDir: '/update',
    marker: '/data/overdrive/pending-image.json',
  });
}

test('a feed that fails does not hide the other one', async () => {
  const update = await updater({
    [FEEDS[0].url]: new Error('Update feed https://github.test/latest answered HTTP 404'),
    [FEEDS[1].url]: release('v1.1.0'),
  }).check();
  assert.equal(update.version, '1.1.0');
  assert.equal(update.url, 'https://gitlab.test/v1.1.0/update.zip');
  assert.equal(update.size, 32_827_690);
  assert.equal(update.notes, 'notes of v1.1.0');
});

test('the newest release of the two wins, whichever host carries it', async () => {
  const both = await updater({
    [FEEDS[0].url]: release('v1.1.0'),
    [FEEDS[1].url]: release('v1.2.0'),
  }).check();
  assert.equal(both.version, '1.2.0', 'GitLab ahead of a working GitHub still updates');
  const other = await updater({
    [FEEDS[0].url]: release('v1.2.0'),
    [FEEDS[1].url]: release('v1.1.0'),
  }).check();
  assert.equal(other.version, '1.2.0');
});

test('nothing newer than the running version is no update', async () => {
  const update = await updater({
    [FEEDS[0].url]: release('v1.0.9'),
    [FEEDS[1].url]: release('v1.0.8'),
  }).check();
  assert.equal(update, null);
});

test('a release without a sha256 digest is refused, on any feed', async () => {
  const update = await updater({
    [FEEDS[0].url]: release('v1.1.0', {digest: null}),
    [FEEDS[1].url]: release('v1.2.0', {digest: 'sha256:short'}),
  }).check();
  assert.equal(update, null);
});

test('an asset called otherwise is not the update', async () => {
  const update = await updater({
    [FEEDS[0].url]: release('v1.1.0', {asset: 'Overdrive.exfat'}),
    [FEEDS[1].url]: new Error('offline'),
  }).check();
  assert.equal(update, null);
});
