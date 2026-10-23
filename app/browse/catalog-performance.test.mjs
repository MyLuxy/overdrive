import assert from 'node:assert/strict';
import test from 'node:test';
import { createHookHarness, evaluateModule } from '../test-support/hooks.mjs';

const jsx = (type, props, key) => ({ type, props, key });
const children = (node) => [node, ...[node?.props?.children].flat().filter(Boolean).flatMap(children)];
const games = [{ id: 'a', art: { cover: 'a.jpg' } }, { id: 'b', art: { cover: 'b.jpg' } }];
const homebrewApps = [];
function catalogFixture() {
  const harness = createHookHarness();
  let store = { filters: { wishlist: false }, query: '', wishlist: [], sort: 'newest', browsePanel: null };
  let filters = 0, sorts = 0;
  const timers = new Map(), prefetched = [];
  let timerId = 0;
  const bindings = {
    ...harness.hooks, jsx, jsxs: jsx,
    memo: (component, compare) => Object.assign(component, { compare }),
    POSTER_WIDTH: 249, POSTER_ROW_GAP: 20, DETAILS_HEIGHT: 74,
    px: (value) => value, logical: (value) => value,
    useStore: () => store, useHomebrew: () => ({ apps: homebrewApps }), browseFullLibrary: () => {},
    useNavActions: () => ({ openGame() {}, focusLater() {} }),
    useT: () => (key) => key, fitBytes: (text) => text, SPAN_MAX: 100,
    activeCount: () => 0, sortLabel: (sort) => sort,
    filterGames: (state) => { filters++; return state.filters.wishlist ? games.filter((g) => state.wishlist.includes(g.id)) : games; },
    sortGames: (list) => { sorts++; return [...list]; },
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    Image: { prefetch: (url) => { prefetched.push(url); return Promise.resolve(); } },
    rememberSearch() {},
    ...Object.fromEntries(['FocusScope', 'View', 'Text', 'Icon', 'ScrollView', 'BrowseTools',
      'EmptyState', 'VirtualList', 'GameCard', 'ReleaseImages'].map((name) => [name, name]))
  };
  const module = evaluateModule(new URL('./Catalog.jsx', import.meta.url), bindings, ['Catalog', 'Grid', 'PanelButton']);
  return { harness, ...module, timers, prefetched,
    setStore: (next) => { store = { ...store, ...next }; },
    work: () => ({ filters, sorts }),
    render: () => harness.settle(module.Catalog),
    grid: (tree) => children(tree).find((node) => node.type === module.Grid && node.props.interactive)
  };
}

test('Favorites filter and search toggles move Up to the active header tab', () => {
  const f = catalogFixture();
  const toggles = (tree) => children(tree).filter((node) => node.type === f.PanelButton);
  const regular = toggles(f.render());
  assert.equal(regular.length, 2);
  assert.ok(regular.every((item) => item.props.upFocusKey === undefined));

  f.setStore({ filters: { wishlist: true }, wishlist: ['a'] });
  const favorites = toggles(f.render());
  assert.equal(favorites.length, 2);
  assert.ok(favorites.every((item) => item.props.upFocusKey === 'nav:current'));

  f.setStore({ filters: { wishlist: false } });
  assert.ok(toggles(f.render()).every((item) => item.props.upFocusKey === undefined));
});

test('ordinary favorite toggles reuse the catalog results; Favorites still updates', () => {
  const f = catalogFixture();
  const first = f.grid(f.render()).props.games;
  f.setStore({ wishlist: ['a'] });
  assert.equal(f.grid(f.render()).props.games, first);
  assert.deepEqual(f.work(), { filters: 1, sorts: 1 });
  f.setStore({ filters: { wishlist: true } });
  assert.deepEqual(f.grid(f.render()).props.games.map((g) => g.id), ['a']);
  f.setStore({ wishlist: ['b'] });
  assert.deepEqual(f.grid(f.render()).props.games.map((g) => g.id), ['b']);
  assert.deepEqual(f.work(), { filters: 3, sorts: 3 });
});

test('panel toggles reuse results while query and sort changes recompute them', () => {
  const f = catalogFixture();
  const first = f.grid(f.render()).props.games;
  f.setStore({ browsePanel: 'search' });
  assert.equal(f.grid(f.render()).props.games, first);
  f.setStore({ query: 'new query' }); f.render();
  f.setStore({ sort: 'rating' }); f.render();
  assert.deepEqual(f.work(), { filters: 3, sorts: 3 });
});

test('grid memoization keeps the reference fast path and observes changed search handlers', () => {
  const { Grid } = catalogFixture();
  const props = { games, signature: 'same', columns: 5, searchQuery: '' };
  assert.equal(Grid.compare(props, { ...props }), true);
  assert.equal(Grid.compare(props, { ...props, games: [...games] }), true);
  assert.equal(Grid.compare(props, { ...props, searchQuery: 'query' }), false);
  assert.equal(Grid.compare(props, { ...props, games: [{ ...games[0] }, games[1]] }), false);
  assert.equal(Grid.compare(props, { ...props, columns: 7 }), false);
  assert.equal(Grid.compare(props, { ...props, interactive: false }), false,
    'a grid must switch its focus keys when it becomes inactive');
});

test('replacing or unmounting a grid cancels its delayed cover prefetch', () => {
  const f = catalogFixture();
  let props = { games: [...games, ...games, ...games, ...games, ...games], columns: 5, searchQuery: null };
  let tree = f.harness.settle(() => f.Grid(props));
  tree.props.renderItem({ item: games[0], index: 0 }).props.children.props.onFocus();
  assert.equal(f.timers.size, 2, 'mount pacing and cover prefetch are pending');
  props = { ...props, games: [...props.games] };
  tree = f.harness.settle();
  assert.equal(f.timers.size, 1, 'replaced results cancel the old cover prefetch');
  tree.props.renderItem({ item: games[0], index: 0 }).props.children.props.onFocus();
  f.harness.cleanup();
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.prefetched, []);
});

test('Search and Favorites keep both poster layouts mounted and release hidden image pins', () => {
  const f = catalogFixture();
  f.setStore({ filters: { wishlist: true }, wishlist: ['a'] });
  const favorites = f.render();
  const visibleWide = f.grid(favorites);
  assert.deepEqual(visibleWide.props.games.map((g) => g.id), ['a']);
  assert.equal(visibleWide.props.columns, 7);
  assert.equal(visibleWide.props.interactive, true);

  f.setStore({ filters: { wishlist: false }, browsePanel: 'search', query: '' });
  const search = f.render();
  const both = children(search).filter((node) => node.type === f.Grid);
  assert.equal(both.length, 2, 'returning to Favorites must not create a fresh seven-column grid');
  const cachedWide = both.find((grid) => grid.props.columns === 7);
  const activeNarrow = both.find((grid) => grid.props.columns === 5);
  assert.equal(cachedWide.props.interactive, false);
  assert.equal(cachedWide.props.games, visibleWide.props.games, 'hidden Favorites results retain their loaded card data');
  assert.equal(activeNarrow.props.interactive, true);

  const hiddenScopes = children(search).filter((node) => node.type === 'FocusScope' && node.props.inert);
  const released = children(search).filter((node) => node.type === 'ReleaseImages' && node.props.when);
  assert.equal(hiddenScopes.length, 1, 'only the hidden grid must be excluded from focus');
  assert.equal(released.length, 1, 'hidden posters release their image cache pins');

  f.setStore({ filters: { wishlist: true }, wishlist: ['a'], browsePanel: null });
  const back = f.render();
  const backGrids = children(back).filter((node) => node.type === f.Grid);
  assert.equal(backGrids.length, 2);
  assert.equal(f.grid(back).props.columns, 7);
  assert.equal(backGrids.find((grid) => grid.props.columns === 5).props.games, activeNarrow.props.games,
    'Search covers remain mounted when returning to Favorites');
});

test('inactive poster cards never reuse visible card focus keys', () => {
  const f = catalogFixture();
  const props = { games, columns: 7, searchQuery: null };
  let tree = f.harness.settle(() => f.Grid({ ...props, interactive: true }));
  const active = tree.props.renderItem({ item: games[0], index: 0 }).props.children;
  assert.equal(active.props.focusKey, 'card:a');
  tree = f.harness.settle(() => f.Grid({ ...props, interactive: false }));
  const hidden = tree.props.renderItem({ item: games[0], index: 0 }).props.children;
  assert.equal(hidden.props.focusKey, 'cached:7:a');
  f.harness.cleanup();
});

test('facet counts ignore sort, panel and irrelevant stars but refresh their matching inputs', () => {
  const harness = createHookHarness();
  let calls = 0;
  const facet = { key: 'platform', options: [{ value: 'ps5', name: 'PS5' }] };
  let store = { filters: { wishlist: false, platform: [] }, wishlist: [], query: '', sort: 'newest' };
  const { Facet } = evaluateModule(new URL('./FilterDrawer.jsx', import.meta.url), {
    ...harness.hooks, jsx, jsxs: jsx, memo: (component) => component, EASE_OUT: [],
    useT: () => (key) => key, useNavActions: () => ({ focusLater() {} }),
    facetCounts: () => { calls++; return { ps5: 1 }; }, facetTitle: (key) => key,
    optionLabel: (option) => option.name, View: 'View', Text: 'Text'
  }, ['Facet']);
  const render = () => harness.settle(() => Facet({ facet, store }));
  render();
  store = { ...store, sort: 'rating', browsePanel: 'filters', wishlist: ['a'] }; render();
  assert.equal(calls, 1);
  store = { ...store, query: 'a' }; render();
  store = { ...store, filters: { ...store.filters, wishlist: true } }; render();
  store = { ...store, wishlist: ['b'] }; render();
  assert.equal(calls, 4);
});
