import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {FACETS, NO_FILTERS, facetSummary, filterGames} = await import('./catalog.js');
const {homebrewApps} = await import('./homebrew.js');

const allGames = filterGames({filters: NO_FILTERS, query: '', wishlist: []});
const options = key => FACETS.find(f => f.key === key).options.map(o => o.value);
const state = (filters = {}, query = '', wishlist = []) => ({
  filters: {...NO_FILTERS, ...filters}, query, wishlist,
});

// Independent reference, the old matching rules are implemented in existing filterGames.
// Don't count their selection when determining counts for the facet's that are OR'd.
// For the OR'd facets, don't count their own selection when counting up that facet.
function reference(current) {
  const counts = {};
  for (const facet of FACETS) {
    const scope = facet.any ? {
      ...current,
      filters: {...current.filters, [facet.key]: []},
    } : current;
    const pool = filterGames(scope);
    counts[facet.key] = Object.fromEntries(facet.options.map(({value}) => [
      value, pool.filter(game => facet.has(game, value)).length,
    ]));
  }
  return {total: filterGames(current).length, counts};
}

function compare(current) {
  assert.deepEqual(facetSummary(current), reference(current));
}

test('the complete catalog and every option retain exactly the old counts', () => {
  compare(state());
  assert.equal(facetSummary(state()).total, allGames.length);
});

test('the platform filter finds a game by every edition it has', () => {
  const platform = FACETS.find(facet => facet.key === 'platform');
  // A PS5 listing whose other edition is a PS4 one is a game available on PS4 too (2026-10-25).
  assert.equal(platform.has({platform: 'ps5', platforms: ['ps4', 'ps5']}, 'ps4'), true);
  assert.equal(platform.has({platform: 'ps5', platforms: ['ps4', 'ps5']}, 'ps5'), true);
  // A game with no other edition answers for its own platform only.
  assert.equal(platform.has({platform: 'ps5'}, 'ps4'), false);
  const both = allGames.find(game => game.platform === 'ps5' && game.platforms.includes('ps4'));
  if (both) {
    assert.equal(platform.has(both, 'ps4'), true);
    assert.equal(filterGames(state({platform: ['ps4']})).includes(both), true);
  }
});

test('OR selections ignore their own facet when counting possible options', () => {
  for (const key of ['platform', 'release', 'size', 'provider']) {
    const values = options(key);
    compare(state({[key]: [values[0]]}));
    if (values.length > 1) compare(state({[key]: values.slice(0, 2)}));
  }
});

test('AND selections continue to require every chosen genre and feature', () => {
  for (const key of ['genre', 'feature']) {
    const values = options(key);
    compare(state({[key]: values.slice(0, 2)}));
    compare(state({[key]: values.slice(0, 3)}));
  }
  compare(state({genre: ['Action', 'Adventure'], feature: ['Single-player', 'Co-op']}));
});

test('search, favorites, empty matches and mixed selections preserve results', () => {
  const wishlist = allGames.slice(0, 35).map(game => game.id);
  for (const query of ['', '  action  ', 'SONIC', 'a string that matches nothing']) {
    compare(state({}, query));
    compare(state({wishlist: true}, query, wishlist));
    compare(state({wishlist: true, platform: ['ps5']}, query, wishlist));
  }
  compare(state({platform: ['ps4'], release: ['recent'], genre: ['Action'], provider: ['1fichier']}));
  compare(state({genre: ['Action', 'Adventure'], feature: ['Single-player'], size: ['large']}));
});

test('wishlist includes homebrew entries, not just the built-in catalog', () => {
  const apps = homebrewApps();
  const game = {
    id: 'hb-filter-test', title: 'Homebrew Filter Test', developer: 'Community',
    publisher: '', platform: 'ps5', genres: [], features: [], providers: ['github'],
    year: 2024, sizeGb: 1, direct: true,
  };
  apps.push(game);
  try {
    compare(state({wishlist: true}, '', [game.id]));
    compare(state({wishlist: true, platform: ['ps4']}, '', [game.id]));
    compare(state({wishlist: true, platform: ['ps5']}, 'homebrew', [game.id]));
    compare(state({wishlist: true, genre: ['Action']}, '', [game.id]));
  } finally {
    assert.equal(apps.pop(), game);
  }
});

test('new OR facets are handled without special-case code (PR #75 compatibility)', () => {
  // A key of its own: "format" is the real facet's now.
  const facet = {
    key: 'sourceKind', any: true,
    options: [{value: 'archive'}, {value: 'direct'}],
    has: (game, value) => value === 'archive'
      ? Boolean(game.providers?.includes('archive.org')) : Boolean(game.direct),
  };
  FACETS.push(facet);
  try {
    compare(state({sourceKind: []}));
    compare(state({sourceKind: ['archive'], genre: ['Action']}));
    compare(state({sourceKind: ['archive', 'direct'], platform: ['ps4']}));
    compare(state({sourceKind: ['direct'], genre: ['Action', 'Adventure']}));
  } finally {
    assert.equal(FACETS.pop(), facet);
  }
});

test('deterministic filter combinations are identical to the previous calculation', () => {
  let seed = 0x345a19;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const queries = ['', 'action', 'SONIC', '  2026  ', 'nonexistent game'];
  const favorites = allGames.slice(0, 47).map(game => game.id);
  for (let attempt = 0; attempt < 150; attempt++) {
    const filters = {};
    for (const facet of FACETS) {
      const selected = facet.options.filter(() => next() < 0.11).map(o => o.value);
      filters[facet.key] = selected.slice(0, 3);
    }
    filters.wishlist = next() < 0.25;
    const query = queries[Math.floor(next() * queries.length)];
    compare(state(filters, query, favorites));
  }
});
