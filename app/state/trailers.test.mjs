import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const trailers = await import('./trailers.js');

test('normalizeTrailer accepts strings and objects, trims and caps the title', () => {
  assert.deepEqual(trailers.normalizeTrailer('https://cdn.example.com/a.mp4'), {url: 'https://cdn.example.com/a.mp4'});
  assert.deepEqual(trailers.normalizeTrailer({url: ' https://cdn.example.com/b.mp4 ', title: ' Story '}), {url: 'https://cdn.example.com/b.mp4', title: 'Story'});
  assert.deepEqual(trailers.normalizeTrailer({url: 'https://cdn.example.com/c.mp4', title: 'T'.repeat(100)}).title, 'T'.repeat(80));
  assert.deepEqual(trailers.normalizeTrailer({url: 'https://cdn.example.com/d.mp4', title: 42}), {url: 'https://cdn.example.com/d.mp4'});
});

test('normalizeTrailer rejects non-http urls, junk, and overly long urls', () => {
  assert.equal(trailers.normalizeTrailer(null), null);
  assert.equal(trailers.normalizeTrailer(42), null);
  assert.equal(trailers.normalizeTrailer('ftp://example.com/a.mp4'), null);
  assert.equal(trailers.normalizeTrailer({url: 'example.com/a.mp4'}), null);
  assert.equal(trailers.normalizeTrailer({url: ''}), null);
  assert.equal(trailers.normalizeTrailer({url: `https://${'a'.repeat(2100)}.com/x.mp4`}), null);
});

test('bundled trailers start empty and a game without entries gets none', () => {
  assert.deepEqual(trailers.trailersFor('CUSA00000'), []);
  assert.deepEqual(trailers.trailersFor(''), []);
  assert.deepEqual(trailers.trailersFor(undefined), []);
});
