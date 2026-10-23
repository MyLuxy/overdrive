import assert from 'node:assert/strict';
import test from 'node:test';
import { createHookHarness, evaluateModule } from '../test-support/hooks.mjs';

const navigationFile = new URL('../state/nav.jsx', import.meta.url);
const sectionsFile = new URL('./useSections.js', import.meta.url);
const jsx = (type, props, key) => ({ type, props, key });

function navigationHarness() {
  const renderer = createHookHarness();
  const timers = new Map();
  let nextTimer = 0;
  const focused = [];
  const module = evaluateModule(navigationFile, {
    ...renderer.hooks, jsx, jsxs: jsx,
    createContext: () => ({ Provider: Symbol('provider') }),
    useContext: () => { throw new Error('Unexpected context lookup'); },
    recordVisit: () => {},
    useFocusActions: () => ({
      focus: (key) => { focused.push(key); return false; },
      blur: () => {},
      focusedRect: () => null,
    }),
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
  }, ['NavProvider', 'FocusRequest']);
  let tree;
  const flush = () => { tree = renderer.settle(() => module.NavProvider({ children: null })); };
  flush();
  return {
    renderer, module, timers, focused, flush,
    get actions() { return tree.props.value; },
    get state() { return tree.props.children.props.value; },
    get request() { return tree.props.children.props.children.props.children[1]; },
  };
}

function sectionsHarness() {
  const nav = navigationHarness();
  const renderer = createHookHarness();
  const NO_FILTERS = { wishlist: false, genre: [] };
  const store = { filters: NO_FILTERS, sort: 'newest', browsePanel: null, query: '' };
  const actions = Object.fromEntries(['Filters', 'Sort', 'BrowsePanel', 'Query'].map((suffix) => [
    'set' + suffix, (value) => { store[suffix[0].toLowerCase() + suffix.slice(1)] = value; }
  ]));
  let focusedKey = 'spotlight:cta';
  let now = 0;
  const module = evaluateModule(sectionsFile, {
    ...renderer.hooks, NO_FILTERS,
    filterGames: ({ filters }) => filters.wishlist ? [] : [
      { id: 'first-newest' }, { id: 'second-game' }
    ],
    sortGames: (games) => games,
    Date: { now: () => now },
    useFocus: () => ({ focusedKey }),
    activateBrowseSection: () => {},
    headerSectionForFocus: (key) => /^(card|catalog|chip):/.test(key) ? 'browse'
      : /^(spotlight|popular|cdn|continue|recent|chart|genre):/.test(key) ? 'discover' : null,
    useNavActions: () => nav.actions,
    useNavState: () => nav.state,
    useQuery: () => store.query,
    useQueryActive: () => Boolean(store.query),
    useStoreActions: () => actions,
    useStoreState: () => store,
  }, ['browseFullLibrary', 'useSections', 'useShowLibrary', 'libraryListeners']);
  let view;
  const render = () => { nav.flush(); view = renderer.render(module.useSections); return view; };
  const flush = () => { nav.flush(); view = renderer.settle(module.useSections); return view; };
  flush();
  return {
    nav, renderer, module, store, actions, NO_FILTERS, render, flush,
    get view() { return view; },
    focus(key) { focusedKey = key; return flush(); },
    advance(ms) { now += ms; },
  };
}

test('manual movement into Library synchronizes the tab and the next shoulder step', () => {
  const h = sectionsHarness();
  assert.equal(h.view.shown, 'discover');
  assert.equal(h.focus('card:game').shown, 'browse');
  h.view.step(true);
  h.flush();
  assert.equal(h.nav.state.top.name, 'homebrew');
  h.renderer.cleanup();
});

test('CDN collection targets the current Library anchor while preserving its sort and panel', () => {
  const focused = [], changed = [];
  const { CdnRail } = evaluateModule(new URL('../browse/CdnRail.jsx', import.meta.url), {
    jsx, jsxs: jsx, memo: (component) => component, px: (value) => value,
    DETAILED_CAPTION: 74, EASE_OUT: [], NO_FILTERS: {}, CDN_HOST: 'cdn',
    games: [{ id: 'game' }], onCdn: () => true, sortGames: (games) => games,
    useNavActions: () => ({ focusLater: (key) => focused.push(key) }),
    useStoreActions: () => ({ setFilters: (filters) => changed.push(filters), setQuery: (query) => changed.push(query) }),
    useRowWindow: () => ({ far: () => false }), useSectionShown() {},
    GameRail: 'rail', View: 'view', RowCard: 'row', GameCard: 'card'
  }, ['CdnRail']);
  CdnRail().props.onSeeAll();
  assert.deepEqual(focused, ['catalog:toggle:filters']);
  assert.deepEqual(changed, [{ provider: ['cdn'] }, '']);
});

test('chart See all selects Library, keeps matching sort and focuses its scroll anchor', () => {
  const h = sectionsHarness();
  const module = evaluateModule(new URL('../browse/TopCharts.jsx', import.meta.url), {
    jsx, jsxs: jsx, games: [], NO_FILTERS: h.NO_FILTERS, sortGames: (games) => games,
    shuffle: (games) => games, activateBrowseSection: () => {},
    useT: () => {}, useNavActions: () => h.nav.actions, useShowLibrary: () => h.view.on.show,
    View: Symbol('View'), SectionHeader: Symbol('SectionHeader'),
    sortLabel: (id) => id,
  }, ['TopCharts']);
  for (const [index, sort] of ['relevance', 'newest', 'rating'].entries()) {
    h.focus('chart:' + sort + ':game');
    module.TopCharts().props.children[index].props.children[0].props.onSeeAll();
    h.flush();
    assert.equal(h.view.shown, 'browse');
    assert.equal(h.store.sort, sort);
    assert.equal(h.store.browsePanel, 'filters');
    assert.equal(h.nav.request.props.target, 'catalog:toggle:filters');
    h.focus('catalog:toggle:filters');
  }
  h.renderer.cleanup();
});

test('explicit Library preserves a retained Search panel without selecting Search', () => {
  const h = sectionsHarness();
  h.view.on.search();
  h.focus('catalog:keyboard:0');
  assert.equal(h.view.shown, 'search');
  h.view.on.homebrew();
  h.flush();
  h.view.on.browse();
  h.flush();
  assert.equal(h.view.shown, 'browse');
  assert.equal(h.store.browsePanel, 'search');
  assert.equal(h.nav.request.props.target, 'catalog:keyboard');
  h.focus('catalog:keyboard:1');
  assert.equal(h.view.shown, 'browse');
  h.renderer.cleanup();
});

test('Favorites and Library retain independent search, sort and filters', () => {
  const h = sectionsHarness();
  h.actions.setFilters({ ...h.NO_FILTERS, genre: ['action'] });
  h.actions.setSort('rating');
  h.actions.setQuery('elden');
  h.actions.setBrowsePanel('search');
  h.flush();

  h.view.on.favorites();
  h.flush();
  assert.equal(h.store.filters.wishlist, true);
  assert.deepEqual(h.store.filters.genre, []);
  assert.equal(h.store.query, '');
  assert.equal(h.store.sort, 'newest');

  h.actions.setFilters({ ...h.NO_FILTERS, wishlist: true, genre: ['rpg'] });
  h.actions.setSort('title');
  h.actions.setQuery('persona');
  h.actions.setBrowsePanel('filters');
  h.flush();

  h.view.on.browse();
  h.flush();
  assert.deepEqual(h.store.filters.genre, ['action']);
  assert.equal(h.store.filters.wishlist, false);
  assert.equal(h.store.query, 'elden');
  assert.equal(h.store.sort, 'rating');
  assert.equal(h.store.browsePanel, 'search');

  h.view.on.favorites();
  h.flush();
  assert.deepEqual(h.store.filters.genre, ['rpg']);
  assert.equal(h.store.filters.wishlist, true);
  assert.equal(h.store.query, 'persona');
  assert.equal(h.store.sort, 'title');
  assert.equal(h.store.browsePanel, 'filters');

  h.view.on.search();
  h.flush();
  assert.equal(h.store.filters.wishlist, false);
  assert.equal(h.store.query, 'elden');
  assert.equal(h.store.browsePanel, 'search');
  h.renderer.cleanup();
});

test('opening Discover from Favorites restores the normal scrollable page', () => {
  const h = sectionsHarness();
  h.actions.setQuery('elden');
  h.actions.setSort('rating');
  h.flush();
  h.view.on.favorites();
  h.flush();
  assert.equal(h.store.filters.wishlist, true);

  h.view.on.discover();
  h.flush();
  assert.equal(h.store.filters.wishlist, false);
  assert.equal(h.store.query, 'elden');
  assert.equal(h.store.sort, 'rating');
  assert.equal(h.view.shown, 'discover');
  assert.equal(h.nav.request.props.target, 'spotlight:cta');
  h.renderer.cleanup();
});

test('Favorites L1 goes to Search, including during focus recovery of the remounted Library', () => {
  const h = sectionsHarness();
  h.view.on.favorites();
  h.focus('catalog:toggle:filters');
  assert.equal(h.view.shown, 'favorites');
  h.view.step(false);
  h.flush();
  assert.equal(h.store.filters.wishlist, false);
  assert.equal(h.store.browsePanel, 'search');
  assert.equal(h.nav.request.props.target, 'catalog:keyboard');
  assert.equal(h.view.shown, 'search');
  h.focus('spotlight:cta');
  assert.equal(h.view.shown, 'search', 'temporary Discover focus cannot override the Search destination');
  h.focus('catalog:keyboard:0');
  assert.equal(h.view.shown, 'search');
  h.renderer.cleanup();
});

test('empty Favorites Browse Full Library focuses first cover, not just header', () => {
  const h = sectionsHarness();
  h.view.on.favorites();
  h.focus('catalog:empty');
  assert.equal(h.store.filters.wishlist, true);
  h.module.browseFullLibrary({ focusFirstGame: true });
  h.flush();
  assert.equal(h.view.shown, 'browse');
  assert.equal(h.store.filters.wishlist, false);
  assert.equal(h.nav.request.props.target, 'card:first-newest');
  h.focus('card:first-newest');
  assert.equal(h.view.shown, 'browse');
  h.renderer.cleanup();
});

test('Browse Full Library from empty Favorites restores the independent Library view', () => {
  const h = sectionsHarness();
  h.actions.setQuery('elden');
  h.actions.setSort('rating');
  h.flush();
  h.view.on.favorites();
  h.flush();
  assert.equal(h.store.filters.wishlist, true);
  h.module.browseFullLibrary();
  h.flush();
  assert.equal(h.view.shown, 'browse');
  assert.equal(h.store.filters.wishlist, false);
  assert.equal(h.store.query, 'elden');
  assert.equal(h.store.sort, 'rating');
  assert.equal(h.nav.request.props.target, 'catalog:toggle:filters');
  h.renderer.cleanup();
});

test('stable Library callback reads the latest Filters panel and sort', () => {
  const h = sectionsHarness();
  const original = h.view.on.browse;
  h.actions.setBrowsePanel('filters');
  h.actions.setSort('rating');
  h.flush();
  assert.equal(h.view.on.browse, original);
  original();
  h.flush();
  assert.equal(h.nav.request.props.target, 'catalog:sort:rating');
  h.renderer.cleanup();
});

test('clearing Favorites filters synchronizes Library selection and the next shoulder tab', () => {
  const h = sectionsHarness();
  h.view.on.favorites();
  h.focus('catalog:toggle:filters');
  assert.equal(h.view.shown, 'favorites');
  h.actions.setFilters(h.NO_FILTERS);
  h.flush();
  assert.equal(h.view.shown, 'browse');
  h.view.step(true);
  h.flush();
  assert.equal(h.nav.state.top.name, 'homebrew');
  h.renderer.cleanup();
});

test('selecting an already focused Library target does not suppress subsequent Discover focus', () => {
  const h = sectionsHarness();
  h.focus('catalog:toggle:filters');
  h.view.on.browse();
  h.flush();
  assert.equal(h.view.shown, 'browse');
  h.focus('genre:action');
  assert.equal(h.view.shown, 'discover');
  h.renderer.cleanup();
});

test('same-frame Homebrew L1/R1 roundtrip retains Homebrew and cancels Library focus', () => {
  const h = sectionsHarness();
  h.view.on.homebrew();
  h.flush();
  h.view.step(false);
  h.view.step(true);
  h.flush();
  assert.equal(h.nav.state.top.name, 'homebrew');
  assert.equal(h.nav.state.stack.length, 2);
  assert.equal(h.nav.request, null);
  h.renderer.cleanup();
});

test('a newly opened Search panel is the Library focus target within the same input batch', () => {
  const h = sectionsHarness();
  h.view.on.homebrew();
  h.flush();
  for (const forward of [true, false, false]) h.view.step(forward);
  h.flush();
  assert.equal(h.view.shown, 'browse');
  assert.equal(h.store.browsePanel, 'search');
  assert.equal(h.nav.request.props.target, 'catalog:keyboard');
  h.renderer.cleanup();
});

test('Header Files/Settings L1-R1 navigation opens a real tab, never a sheet', () => {
  const h = sectionsHarness();
  h.view.on.files();
  h.flush();
  const renderer = createHookHarness();
  const hostNames = ['DownloadToast', 'DownloadsBadge', 'FocusRing', 'Logo', 'NavItem',
    'NavPill', 'FocusScope', 'Text', 'View'];
  const module = evaluateModule(new URL('./Header.jsx', import.meta.url), {
    ...renderer.hooks, jsx, jsxs: jsx, VERSION: 'test',
    ...Object.fromEntries(hostNames.map((name) => [name, Symbol(name)])),
    focusEnd: () => ({}), useLocale: () => ({ rtl: false }), useT: () => (key) => key,
    useFocus: () => ({ focusedKey: null }),
    getGame: () => true, useIsImmersive: () => false, useWishlist: () => [], useHomebrew: () => ({ apps: [] }),
    useNavActions: () => h.nav.actions, useNavState: () => h.nav.state,
    useSections: () => h.view, useNavLayouts: () => [{}, () => () => {}],
  }, ['Header']);
  const render = () => renderer.settle(() => module.Header({ children: null }));
  let tree = render();
  const staleOnAction = tree.props.onAction;
  staleOnAction('l1');
  staleOnAction('r1');
  h.flush();
  tree = render();
  assert.equal(h.nav.state.top.name, 'files');
  assert.equal(tree.props.children.length, 3, 'no popout settings element exists');
  assert.equal(tree.props.onAction('r1'), true);
  h.flush();
  assert.equal(h.nav.state.top.name, 'settings');
  assert.equal(h.view.shown, 'settings');
  tree = render();
  assert.equal(tree.props.children.length, 3);
  assert.equal(tree.props.onAction('r1'), true, 'at final tab R1 is a no-op');
  h.flush();
  assert.equal(h.nav.state.top.name, 'settings');
  tree.props.onAction('l1');
  h.flush();
  assert.equal(h.nav.state.top.name, 'files');
  h.renderer.cleanup();
  renderer.cleanup();
});

test('Header keeps the original text navigation and right-aligned utility group with icons', () => {
  const h = sectionsHarness();
  const renderer = createHookHarness();
  const NavItem = Symbol('NavItem');
  const hostNames = ['DownloadToast', 'DownloadsBadge', 'FocusRing', 'Logo',
    'NavPill', 'FocusScope', 'Text', 'View'];
  const module = evaluateModule(new URL('./Header.jsx', import.meta.url), {
    ...renderer.hooks, jsx, jsxs: jsx, VERSION: 'test', NavItem,
    ...Object.fromEntries(hostNames.map((name) => [name, Symbol(name)])),
    focusEnd: () => ({}), useLocale: () => ({ rtl: false }), useT: () => (key) => key,
    useFocus: () => ({ focusedKey: null }), getGame: () => true,
    useIsImmersive: () => false, useWishlist: () => [], useHomebrew: () => ({ apps: [] }),
    useNavActions: () => h.nav.actions, useNavState: () => h.nav.state,
    useSections: () => h.view, useNavLayouts: () => [{}, () => () => {}],
  }, ['Header']);
  const tree = renderer.settle(() => module.Header({ children: null }));
  const header = tree.props.children[2].props.children.props.children;
  assert.equal(header.props.style.justifyContent, 'space-between');
  const left = header.props.children[1];
  assert.equal(left.props.style.gap, 0);
  const leftTabs = left.props.children.filter((node) => node.type === NavItem);
  assert.deepEqual(leftTabs.map((node) => node.props.icon),
    ['compass', 'controller', 'homebrew', 'search']);
  assert.ok(leftTabs.every((node) => node.props.label && !node.props.focusLabel));
  assert.ok(leftTabs.slice(0, 3).every((node) => !node.props.iconAfterLabel));
  const right = header.props.children[2];
  assert.equal(right.props.style.width, 232);
  assert.equal(right.props.style.justifyContent, 'flex-end');
  const utilities = right.props.children.props.children;
  assert.deepEqual(utilities.map((node) => node.props.icon),
    ['star', 'download', 'folder', 'settings']);
  assert.ok(utilities.every((node) => node.props.compact && !node.props.focusLabel && !node.props.label));
  h.renderer.cleanup();
  renderer.cleanup();
});

test('a shoulder burst follows intended tabs before render and preserves Search on return', () => {
  const h = sectionsHarness();
  h.view.on.search();
  h.focus('catalog:keyboard:0');
  for (const forward of [true, true, true, false, false, false]) h.view.step(forward);
  h.flush();
  assert.equal(h.nav.state.top.name, 'browse');
  assert.equal(h.view.shown, 'search');
  assert.equal(h.nav.request.props.target, 'catalog:keyboard');
  h.view.on.browse();
  h.focus('catalog:keyboard:1');
  h.view.on.downloads();
  h.flush();
  h.nav.actions.pop();
  h.focus('nav:downloads');
  assert.equal(h.view.shown, 'browse');
  assert.equal(h.store.browsePanel, 'search');
  h.renderer.cleanup();
});

test('delayed previous-region effect cannot replace the newest Search destination', () => {
  const h = sectionsHarness();
  h.focus('card:game');
  h.focus('popular:game');
  h.view.on.discover();
  h.render();
  h.view.on.search();
  h.renderer.flushEffects();
  h.flush();
  assert.equal(h.view.shown, 'search');
  h.focus('catalog:keyboard:0');
  assert.equal(h.view.shown, 'search');
  h.renderer.cleanup();
});

test('failed focus intent expires and the shared library subscription is cleaned up', () => {
  const h = sectionsHarness();
  h.view.on.search();
  h.flush();
  h.advance(1601);
  h.focus('genre:action');
  assert.equal(h.view.shown, 'discover');
  assert.equal(h.module.libraryListeners.size, 1);
  h.renderer.cleanup();
  assert.equal(h.module.libraryListeners.size, 0);
});

test('screen transitions clear stale focus requests and request identities never repeat', () => {
  const h = navigationHarness();
  h.actions.focusLater('catalog:keyboard');
  h.flush();
  const first = h.request.key;
  h.actions.openTab('files', 'nav:files');
  h.actions.home('spotlight:cta');
  h.flush();
  assert.notEqual(h.request.key, first);
  assert.equal(h.request.props.target, 'spotlight:cta');
  h.actions.push({ name: 'game', id: 'test' }, 'card:test');
  h.flush();
  assert.equal(h.request, null);
  h.actions.focusLater('missing');
  h.flush();
  h.actions.home();
  h.flush();
  assert.equal(h.request, null);
});

test('FocusRequest reveals Search after late layout even if early focus succeeded', () => {
  const renderer = createHookHarness();
  const timers = new Map();
  const calls = [];
  let nextTimer = 0, ready = false;
  const { FocusRequest } = evaluateModule(navigationFile, {
    ...renderer.hooks, jsx, jsxs: jsx,
    createContext: () => ({ Provider: Symbol('provider') }),
    useContext: () => { throw new Error('Unexpected context lookup'); },
    recordVisit: () => {},
    useFocusActions: () => ({
      focus: (target) => { calls.push('focus:' + target); return true; },
      blur: () => calls.push('blur'),
      focusedRect: () => ready ? { x: 0, y: 2000, width: 30, height: 30 } : null,
    }),
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
  }, ['FocusRequest']);
  renderer.render(() => FocusRequest({ target: 'catalog:keyboard' }));
  renderer.flushEffects();
  let [id, run] = [...timers][0]; timers.delete(id); run();
  assert.deepEqual(calls, ['focus:catalog:keyboard']);
  assert.equal(timers.size, 1, 'focus before layout must keep the request pending');
  ready = true;
  [id, run] = [...timers][0]; timers.delete(id); run();
  assert.deepEqual(calls, ['focus:catalog:keyboard', 'focus:catalog:keyboard', 'blur', 'focus:catalog:keyboard']);
  assert.equal(timers.size, 0);
  renderer.cleanup();
});

test('FocusRequest uses imperative focus, retries once per timer and cancels on unmount', () => {
  const h = navigationHarness();
  h.renderer.cleanup();
  h.renderer.render(() => h.module.FocusRequest({ target: 'missing' }));
  h.renderer.flushEffects();
  assert.equal(h.timers.size, 1);
  const [id, attempt] = [...h.timers][0];
  h.timers.delete(id);
  attempt();
  assert.deepEqual(h.focused, ['missing']);
  assert.equal(h.timers.size, 1);
  h.renderer.cleanup();
  assert.equal(h.timers.size, 0);
});
