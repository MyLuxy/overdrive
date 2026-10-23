import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateModule } from '../test-support/hooks.mjs';
import { FocusManager } from '../../ps5-react/runtime/js/focus/manager.js';

const jsx = (type, props, key) => ({ type, props, key });
const sectionForFocus = (key) => /^(catalog|card|chip):/.test(key ?? '') ? 'browse'
  : /^spotlight:/.test(key ?? '') ? 'discover' : null;
const tokens = Object.fromEntries([
  'Catalog', 'NearSection', 'FocusedSection', 'Footer', 'Spotlight',
  'PopularRail', 'CdnRail', 'ContinueRow', 'RecentRow', 'TopCharts',
  'GenreRail', 'FolderInstallNotice', 'FocusScope', 'ScrollView', 'View', 'ReleaseImages'
].map((name) => [name, name]));

test('Favorites has an isolated scroll view without Discover sections', () => {
  const store = {
    filters: { wishlist: true },
    browsePanel: null,
    setBrowsePanel(panel) { this.browsePanel = panel; }
  };
  const focusTargets = [];
  const { Sections, DiscoverContent } = evaluateModule(new URL('./BrowsePage.jsx', import.meta.url), {
    jsx, jsxs: jsx, memo: (component) => component, ...tokens,
    useFavoriteAction: () => () => false,
    useStore: () => store,
    useFocus: () => ({ focusedKey: 'catalog:toggle:filters' }),
    headerSectionForFocus: sectionForFocus,
    edit: (query) => query.slice(0, -1),
    useNavActions: () => ({ focusLater: (key) => focusTargets.push(key) }),
  }, ['Sections', 'DiscoverContent']);

  const favorites = Sections().props.children;
  assert.equal(favorites.type, 'ScrollView');
  assert.equal(favorites.key, 'favorites-scroll');
  assert.equal(favorites.props.style.paddingTop, 36);
  const [tracker, hiddenDiscover, persistentCatalog, footer] = favorites.props.children;
  assert.equal(tracker.type, 'FocusedSection');
  assert.equal(hiddenDiscover.type, DiscoverContent);
  assert.equal(hiddenDiscover.props.hidden, true);
  assert.equal(persistentCatalog.type, 'NearSection');
  assert.equal(persistentCatalog.props.index, 7);
  assert.equal(persistentCatalog.props.children.type, 'Catalog');
  assert.equal(footer, null);

  const hidden = DiscoverContent({ hidden: true });
  assert.equal(hidden.props.inert, true);
  assert.equal(hidden.props.children.type, 'ReleaseImages');
  assert.equal(hidden.props.children.props.when, true);
  assert.equal(hidden.props.children.props.children.props.style.display, 'none');

  store.filters = { wishlist: false };
  const regular = Sections().props.children;
  assert.equal(regular.key, 'library-scroll');
  assert.notEqual(regular.key, favorites.key);
  assert.equal(regular.props.children[1].type, hiddenDiscover.type);
  assert.equal(regular.props.children[1].props.hidden, false);
  assert.equal(regular.props.children[2].type, persistentCatalog.type);
  assert.equal(regular.props.children[2].props.children.type, persistentCatalog.props.children.type);
  assert.equal(regular.props.children[3].type.name, 'Footer');
  const visible = DiscoverContent({ hidden: false });
  assert.equal(visible.props.inert, false);
  assert.equal(visible.props.children.props.when, false);
  assert.equal(visible.props.children.props.children.props.style.display, 'flex');
  assert.equal(visible.props.children.props.children.props.children.length, 7);

  store.filters = { wishlist: true };
  assert.equal(Sections().props.children.key, 'favorites-scroll');
});

test('L2/R2 are ignored in Discover and the header but work inside Library', () => {
  let focusedKey = 'spotlight:cta', favorites = 0;
  const store = { filters: { wishlist: false }, browsePanel: null, query: 'cyberpunk',
    setBrowsePanel(value) { this.browsePanel = value; },
    setQuery(fn) { this.query = typeof fn === 'function' ? fn(this.query) : fn; } };
  const targets = [];
  const { Sections } = evaluateModule(new URL('./BrowsePage.jsx', import.meta.url), {
    jsx, jsxs: jsx, memo: (fn) => fn, ...tokens,
    useFavoriteAction: () => () => { favorites++; return true; },
    useStore: () => store,
    useFocus: () => ({ focusedKey }),
    headerSectionForFocus: sectionForFocus,
    edit: (query, value) => value === 'delete' ? query.slice(0, -1) : query,
    useNavActions: () => ({ focusLater: (key) => targets.push(key) }),
  }, ['Sections']);
  for (focusedKey of ['spotlight:cta', 'popular:game', 'nav:discover', 'nav:current']) {
    const action = Sections().props.onAction;
    assert.equal(action('l2'), false, focusedKey);
    assert.equal(action('r2'), false, focusedKey);
  }
  assert.equal(store.browsePanel, null);
  assert.deepEqual(targets, []);
  for (focusedKey of ['spotlight:cta', 'spotlight:2', 'popular:game',
    'recent:game', 'cdn:game', 'continue:job', 'chart:rating:game']) {
    assert.equal(Sections().props.onAction('square'), true, focusedKey);
  }
  assert.equal(favorites, 7, 'all Discover game surfaces forward Square to the favorite handler');
  focusedKey = 'catalog:toggle:filters';
  assert.equal(Sections().props.onAction('r2'), true);
  assert.equal(store.browsePanel, 'search');
  assert.deepEqual(targets, ['catalog:keyboard']);
  focusedKey = 'card:game';
  assert.equal(Sections().props.onAction('square'), true);
  assert.equal(store.query, 'cyberpunk', 'Square does not delete when a game is focused');
  assert.equal(favorites, 8, 'Search result cards support favorites');
  focusedKey = 'catalog:keyboard';
  assert.equal(Sections().props.onAction('square'), true);
  assert.equal(store.query, 'cyberpun', 'Square deletes on the Search keyboard');
  assert.equal(favorites, 8);
  store.browsePanel = 'filters';
  assert.equal(Sections().props.onAction('square'), true);
  assert.equal(favorites, 9);
});

test('Favorites retains the shared search and filter shortcuts', () => {
  const store = { filters: { wishlist: true }, browsePanel: null, query: 'test',
    setBrowsePanel(panel) { this.browsePanel = panel; },
    setQuery(fn) { this.query = typeof fn === 'function' ? fn(this.query) : fn; } };
  const focused = [];
  const { Sections } = evaluateModule(new URL('./BrowsePage.jsx', import.meta.url), {
    jsx, jsxs: jsx, memo: (component) => component, ...tokens,
    useFavoriteAction: () => () => false,
    useStore: () => store,
    useFocus: () => ({ focusedKey: 'catalog:toggle:filters' }),
    headerSectionForFocus: sectionForFocus,
    edit: (query) => query.slice(0, -1),
    useNavActions: () => ({ focusLater: (key) => focused.push(key) }),
  }, ['Sections']);
  const scope = Sections();
  assert.equal(scope.props.onAction('r2'), true);
  assert.equal(store.browsePanel, 'search');
  assert.deepEqual(focused, ['catalog:keyboard']);
  assert.equal(scope.props.onAction('l2'), true);
  assert.equal(store.browsePanel, 'filters');
  assert.deepEqual(focused, ['catalog:keyboard', 'catalog:sort:newest']);
});


test('Discover directly consumes Square at its own focus scope, before the outer Library handler', () => {
  const actions = [];
  let target = 'popular:game';
  const { DiscoverContent } = evaluateModule(new URL('./BrowsePage.jsx', import.meta.url), {
    jsx, jsxs: jsx, memo: (fn) => fn, ...tokens,
    useFavoriteAction: () => (action) => {
      actions.push([target, action]);
      return action === 'square';
    },
  }, ['DiscoverContent']);
  const visible = DiscoverContent({ hidden: false });
  assert.equal(visible.type, 'FocusScope');
  assert.equal(visible.props.inert, false);
  for (target of ['spotlight:cta', 'spotlight:wish', 'spotlight:2',
    'popular:game', 'recent:game', 'cdn:game', 'continue:job',
    'chart:relevance:game', 'chart:newest:game', 'chart:rating:game']) {
    assert.equal(visible.props.onAction('square'), true, target);
  }
  assert.equal(actions.length, 10);
  assert.equal(visible.props.onAction('l1'), false);
  assert.equal(visible.props.onAction('r2'), false);
  assert.equal(actions.length, 10, 'other buttons must be left for normal navigation');
  const hidden = DiscoverContent({ hidden: true });
  assert.equal(hidden.props.inert, true);
  assert.equal(hidden.props.onAction('square'), false, 'hidden Discover never handles Square');
  assert.equal(actions.length, 10);
});


test('nested runtime FocusManager dispatches Discover Square exactly once before its outer Browse scope', () => {
  const manager = new FocusManager();
  const observed = [];
  const outer = manager.createScope(manager.root, {
    onAction: (action) => {
      observed.push('outer:' + action);
      return action === 'square';
    }
  });
  const discover = manager.createScope(outer, {
    onAction: (action) => {
      observed.push('discover:' + action);
      return action === 'square';
    }
  });
  manager.mountScope(outer);
  manager.mountScope(discover);
  const spotlight = manager.createNode(discover, null, { focusKey: 'spotlight:0' });
  manager.register(spotlight);
  assert.equal(manager.focus('spotlight:0'), true);
  assert.equal(manager.action('square'), true);
  assert.deepEqual(observed, ['discover:square'],
    'Discover handles Square in the active nested scope, with no duplicate outer toggle');
  assert.equal(manager.action('r1'), false);
  assert.deepEqual(observed, ['discover:square', 'discover:r1', 'outer:r1'],
    'unrelated actions still bubble to higher scopes');
  manager.unmountScope(discover);
  manager.unmountScope(outer);
});
