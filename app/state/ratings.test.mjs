import assert from 'node:assert/strict';
import test from 'node:test';

import { ratingFor } from './ratings.js';

test('no bundled ratings means no rating, for any shape of id', () => {
  assert.equal(ratingFor('PPSA03753'), null);
  assert.equal(ratingFor(''), null);
  assert.equal(ratingFor(undefined), null);
  assert.equal(ratingFor(42), null);
});
