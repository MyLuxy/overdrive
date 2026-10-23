import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluateModule } from '../test-support/hooks.mjs';
import { matchesFavoriteKind } from '../state/favorite-kinds.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const data = evaluateModule(new URL('../data/catalog.js', import.meta.url), {}, ['games', 'twins', 'features']);
const { pausedFilter } = evaluateModule(new URL('../state/paused-hosts.js', import.meta.url), {}, ['pausedFilter']);
const catalog = evaluateModule(new URL('../state/catalog.js', import.meta.url), {
  ...data, pausedFilter, FileSystem: {}, homebrewApps: () => [], matchesFavoriteKind,
  createPageCache: () => () => ({}), createReleaseCache: () => () => []
}, ['NO_FILTERS', 'filterGames', 'sortGames']);

const source = read('./BrowseTools.jsx');
const callback = source.match(/  const onSearch = \(term\) => \{[\s\S]*?\n  \};/);
assert.ok(callback, 'SearchControls history callback exists');
function historyAction(store, resultsFocusKey, overrides = {}) {
  const changed = [], remembered = [], focused = [];
  const bindings = {
    store, query: store.query, resultsFocusKey,
    filterGames: catalog.filterGames, sortGames: catalog.sortGames,
    setQuery: (term) => changed.push(term),
    rememberSearch: (term) => remembered.push(term),
    focusLater: (key) => focused.push(key),
    ...overrides
  };
  const onSearch = new Function(...Object.keys(bindings), `${callback[0]}\nreturn onSearch;`)
    (...Object.values(bindings));
  return { onSearch, changed, remembered, focused };
}
const results = (store) => catalog.sortGames(catalog.filterGames(store), store.sort);
const initial = () => ({ filters: catalog.NO_FILTERS, query: 'witcher', wishlist: [], sort: 'newest' });

test('history selection focuses the newly selected query instead of an absent old result', () => {
  const store = initial();
  const oldFirst = results(store)[0];
  const nextResults = results({ ...store, query: 'resident evil' });
  assert.ok(oldFirst && nextResults.length);
  assert.equal(nextResults.some((game) => game.id === oldFirst.id), false);
  const action = historyAction(store, 'card:' + oldFirst.id);
  action.onSearch('resident evil');
  assert.deepEqual(action.focused, ['card:' + nextResults[0].id]);
  assert.deepEqual(action.changed, ['resident evil']);
  assert.deepEqual(action.remembered, ['resident evil']);
});

test('history selection preserves the active filters, wishlist and sort order', () => {
  const filters = { ...catalog.NO_FILTERS, platform: ['ps5'], wishlist: true };
  const candidates = results({ ...initial(), query: 'resident evil', filters: { ...filters, wishlist: false } });
  assert.ok(candidates.length > 1);
  const store = { ...initial(), filters, sort: 'rating', wishlist: candidates.map((game) => game.id) };
  const expected = results({ ...store, query: 'resident evil' });
  const action = historyAction(store, 'card:old-query');
  action.onSearch('resident evil');
  assert.deepEqual(action.focused, ['card:' + expected[0].id]);
  assert.equal(store.query, 'witcher', 'calculating a new target does not mutate the current store');
});

test('selecting the current query reuses its mounted target without filtering again', () => {
  const store = initial();
  const action = historyAction(store, 'card:mounted', {
    filterGames: () => assert.fail('same-query selection must reuse the current results')
  });
  action.onSearch(store.query);
  assert.deepEqual(action.focused, ['card:mounted']);
});

test('a history term without matches does not request a missing card or move keyboard focus', () => {
  const action = historyAction(initial(), 'card:old-query');
  action.onSearch('__overdrive_no_such_game__');
  assert.deepEqual(action.focused, []);
  assert.deepEqual(action.changed, ['__overdrive_no_such_game__']);
});

test('a query selected from empty results can focus its newly available first card', () => {
  const store = { ...initial(), query: '__overdrive_no_such_game__' };
  const expected = results({ ...store, query: 'resident evil' });
  const action = historyAction(store, 'catalog:keyboard');
  action.onSearch('resident evil');
  assert.deepEqual(action.focused, ['card:' + expected[0].id]);
});
