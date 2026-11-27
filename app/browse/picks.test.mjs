import assert from 'node:assert/strict';
import test from 'node:test';
import {FAMOUS, FIRST_FEATURED, selectFeatured} from './picks.js';
import {games} from '../data/catalog.js';

test('GTA VI opens the real catalog hero across random selections, without duplicates', () => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const slides = selectFeatured(games);
    assert.equal(slides[0].id, 'PPSA38500');
    assert.equal(slides.length, 5);
    assert.equal(new Set(slides.map(game => game.id)).size, slides.length);
    assert(slides.every(game => game.art.hero));
  }
});

test('without the promoted game the existing five-slide selection still works', () => {
  const slides = selectFeatured(games.filter(game => game.id !== FIRST_FEATURED));
  assert.equal(slides.length, 5);
  assert(slides.some(game => FAMOUS.includes(game.id)));
  assert(slides.every(game => game.id !== FIRST_FEATURED));
});

test('a promoted game without hero art is skipped', () => {
  const pool = games.map(game => game.id === FIRST_FEATURED ? {...game, art: {cover: game.art.cover}} : game);
  assert(selectFeatured(pool).every(game => game.id !== FIRST_FEATURED));
});
