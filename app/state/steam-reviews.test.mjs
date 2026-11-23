import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const { normalizeResponse, normalizeReview, steamAppId, steamLanguage } = await import('./steam-reviews.js');

test('normalizeReview keeps the text, the verdict, the hours and the votes, junk out', () => {
  assert.deepEqual(normalizeReview({ review: ' Good game ', voted_up: true, author: { playtime_at_review: 1623 }, votes_up: 6 }), { text: 'Good game', positive: true, hours: 27, votes: 6 });
  assert.deepEqual(normalizeReview({ review: 'meh', voted_up: false, author: {} }), { text: 'meh', positive: false, hours: null, votes: 0 });
  assert.equal(normalizeReview(null), null);
  assert.equal(normalizeReview(42), null);
  assert.equal(normalizeReview({ review: '   ' }), null);
  assert.equal(normalizeReview({ review: 7 }), null);
  assert.equal(normalizeReview({ review: 'x'.repeat(1000) }).text.length, 600);
});

test('normalizeResponse reads the summary and caps the list', () => {
  const subject = normalizeResponse({ response: { query_summary: { review_score: 8, total_positive: 8697, total_negative: 878, total_reviews: 9575 }, reviews: [{ review: 'a', voted_up: true, author: {} }] } });
  assert.equal(subject.score, 8);
  assert.equal(subject.percent, 91);
  assert.deepEqual(subject.reviews, [{ text: 'a', positive: true, hours: null, votes: 0 }]);
  assert.equal(normalizeResponse(null), null);
  assert.equal(normalizeResponse({}), null);
  assert.equal(normalizeResponse({ response: {} }), null);
  assert.equal(normalizeResponse({ response: { reviews: [] } }), null);
  assert.equal(normalizeResponse({ response: { reviews: [{ review: '' }] } }), null);
});

test('the steam appid comes from art urls, the language from the locale', () => {
  assert.equal(steamAppId({ art: { cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/780310/library.jpg' } }), '780310');
  assert.equal(steamAppId({ art: {} }), null);
  assert.equal(steamAppId({ art: 'nope' }), null);
  assert.equal(steamLanguage('ru-RU'), 'russian');
  assert.equal(steamLanguage('en-US'), 'english');
  assert.equal(steamLanguage(undefined), 'english');
});
