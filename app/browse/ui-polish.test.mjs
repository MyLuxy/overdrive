import assert from 'node:assert/strict';
import test from 'node:test';
import { createHookHarness, evaluateModule } from '../test-support/hooks.mjs';
const jsx = (type, props, key) => ({ type, props, key });

test('Discover chart ranks are white numbers without circles or colored backgrounds', () => {
  const { RankBadge } = evaluateModule(new URL('./TopCharts.jsx', import.meta.url), {
    jsx, jsxs: jsx, games: [], sortGames: () => [], shuffle: (x) => x,
    View: 'View', Text: 'Text'
  }, ['RankBadge']);
  for (const chart of ['newest', 'relevance', 'rating']) {
    for (const rank of [1, 2, 3, 4, 5]) {
      const item = RankBadge({ rank, chart });
      assert.equal(item.type, 'Text');
      assert.equal(item.props.children, String(rank));
      assert.equal(item.props.style.color, '#ffffff');
      assert.equal(item.props.style.width, 38);
      assert.equal(item.props.style.backgroundColor, undefined);
      assert.equal(item.props.style.borderRadius, undefined);
    }
  }
});

test('compact platform, download, release and size tiles end at the second Sort button edge', () => {
  for (const key of ['platform', 'access', 'release', 'size']) {
    const harness = createHookHarness();
    const options = key === 'access' ? [{ value: 'direct' }]
      : key === 'platform' ? [{ value: 'ps4' }, { value: 'ps5' }]
        : [{ value: 'one' }, { value: 'two' }, { value: 'three' }];
    const facet = { key, options };
    const store = { filters: { [key]: [], wishlist: false }, wishlist: [], query: '', favoriteKind: 'all' };
    const { Facet } = evaluateModule(new URL('./FilterDrawer.jsx', import.meta.url), {
      ...harness.hooks, jsx, jsxs: jsx, memo: (component) => component, EASE_OUT: [], useT: () => (id) => id,
      useNavActions: () => ({ focusLater() {} }),
      facetCounts: () => Object.fromEntries(options.map((o) => [o.value, 10])),
      facetTitle: (k) => k, optionLabel: (o) => o.value, View: 'View', Text: 'Text'
    }, ['Facet']);
    const tree = harness.settle(() => Facet({ facet, store, compact: true }));
    const row = tree.props.children[1];
    assert.equal(row.props.style.width, 462, key);
    assert.equal(row.props.style.marginLeft, 8, key);
    assert.equal(row.props.style.width + row.props.style.marginLeft, 470, key);
    harness.cleanup();
  }
});

test('Homebrew title excludes PS4/PS5 badges while game cards retain them', () => {
  const { TitleWithPlatform } = evaluateModule(new URL('../ui/GameCard.jsx', import.meta.url), {
    jsx, jsxs: jsx, px: (n) => n, EASE_OUT: [],
    useLocale: () => ({ rtl: false }), latin: (_rtl, text) => text,
    View: 'View', Text: 'Text', PlatformBadge: 'PlatformBadge'
  }, ['TitleWithPlatform']);
  const props = { focused: false, rtl: false, box: { text: { width: 200 } }, detailed: true };
  const brew = TitleWithPlatform({ ...props, game: { homebrew: { kind: 'app' }, platforms: ['ps5'], title: 'Example app' } });
  assert.equal(brew.props.children[0], null);
  assert.equal(brew.props.children[1].props.children, 'Example app');
  const game = TitleWithPlatform({ ...props, game: { platforms: ['ps5'], title: 'Example game' } });
  assert.equal(game.props.children[0].props.children.type, 'PlatformBadge');
});

test('focused Popular Genres tile gets a persistent visible border, selected filters stay marked', () => {
  function card(focused, active) {
    const { GenreCard } = evaluateModule(new URL('./GenreCard.jsx', import.meta.url), {
      jsx, jsxs: jsx, memo: (component) => component, POSTER_WIDTH: 210, px: (n) => n,
      useT: () => (k) => k, useFocus: () => ({ focusedKey: focused ? 'genre:action' : null }),
      GENRE_ART: { action: 'pixel-art' }, genreLabel: (x) => x,
      View: 'View', Text: 'Text', Image: 'Image', FocusFrame: 'FocusFrame',
      Icon: 'Icon', colors: { canvas: '#000' }
    }, ['GenreCard']);
    return GenreCard({ genre: 'action', count: 120, covers: [], index: 0, active });
  }
  const focus = card(true, false);
  const outline = focus.props.children[0].props.children.find((x) => x?.props?.style?.borderWidth === 4);
  assert.ok(outline, 'focused tile must have a white overlay outline');
  assert.equal(outline.props.style.borderColor, '#ffffff');
  const selected = card(false, true);
  const selectedOutline = selected.props.children[0].props.children.find((x) => x?.props?.style?.borderWidth === 2);
  assert.ok(selectedOutline, 'selected genre stays outlined even without focus');
});

test('Spotlight and all three chart rows place compact favorite stars at their right-center, not on covers', () => {
  const { WishBadge } = evaluateModule(new URL('../ui/GameCard.jsx', import.meta.url), {
    jsx, jsxs: jsx, EASE_OUT: [], px: (n) => n, useWishlist: () => ['sample'], useRef: (value) => ({ current: value }),
    View: 'View', motion: { View: 'motion.View' }, transitions: { pop: {} }, Icon: 'Icon'
  }, ['WishBadge']);
  const star = WishBadge({ id: 'sample', focused: false, compact: true, placement: 'row-end' });
  assert.equal(star.props.style.right, 10);
  assert.equal(star.props.style.top, '50%');
  assert.equal(star.props.style.left, undefined);
  assert.equal(star.props.style.height, 36);

  const { Row3 } = evaluateModule(new URL('./TopCharts.jsx', import.meta.url), {
    jsx, jsxs: jsx, Fragment: 'Fragment', games: [], sortGames: () => [], shuffle: (x) => x, useLocale: () => ({ rtl: false }), useIsFocused: () => true,
    Cover: 'Cover', FocusFrame: 'FocusFrame', RankBadge: 'RankBadge', Detail: 'Detail',
    WishBadge: 'WishBadge', View: 'View', Text: 'Text', latin: (_rtl, text) => text,
  }, ['Row3']);
  for (const chart of ['relevance', 'newest', 'rating']) {
    const tree = Row3({ rank: 1, game: { id: 'sample', title: 'Sample' }, chart });
    const children = tree.props.children;
    assert.equal(children.at(-1).type, 'WishBadge');
    assert.equal(children.at(-1).props.placement, 'row-end');
    assert.equal(children.at(-1).props.focused, true);
    assert.equal(children[2].type, 'Cover');
  }

  const { Item } = evaluateModule(new URL('./SpotlightList.jsx', import.meta.url), {
    jsx, jsxs: jsx, memo: (fn) => fn, useLocale: () => ({ rtl: false }),
    useIsFocused: () => true, useFocus: () => ({ focusedKey: "spotlight:0" }), focusStart: () => ({}), focusEnd: () => ({}),
    View: 'View', Cover: 'Cover', WishBadge: 'WishBadge',
    FocusFrame: 'FocusFrame', Shine: 'Shine', Title2: 'Title2',
    setFavoriteTarget: () => {}, lightGame: () => {}, unlight: () => {},
  }, ['Item']);
  const row = Item({ game: { id: 'sample', title: 'Sample' }, index: 0, active: true,
    progress: null, select: () => {}, hold: () => {} });
  const rowChildren = row.props.children;
  assert.equal(rowChildren[2].type, 'Cover');
  assert.equal(rowChildren[4].type, 'WishBadge');
  assert.equal(rowChildren[4].props.placement, 'row-end');
});

test('Download status panel is compact and its Activity, Storage and Installing blocks have no focus targets', () => {
  const { SummaryPanel, Activity, Drive, Block } = evaluateModule(
    new URL('../downloads/SummaryPanel.jsx', import.meta.url), {
      jsx, jsxs: jsx, View: 'View', Text: 'Text', ScrollView: 'ScrollView',
      useT: () => (key) => key, storageRoots: () => ['first', 'second'],
      useActivity: () => ({ active: 0, speed: 0, left: 0, connections: 0,
        peak: 0, low: 0, mean: 0, extracting: false, extractedFiles: 0 }),
      useSpeedLimit: () => 0, downloadQueue: () => ({ awake: false }),
      FileSystem: { diskUsage: () => ({ total: 100, free: 50 }) },
      driveName: (value) => value, formatBytes: (value) => String(value),
      formatNumber2: String, ProgressBar: 'ProgressBar',
    }, ['SummaryPanel', 'Activity', 'Drive', 'Block']);
  const panel = SummaryPanel({ error: '' });
  assert.equal(panel.type, 'View', 'sidebar should not be a ScrollView');
  assert.equal(panel.props.style.width, 420);
  const blocks = panel.props.children.props.children;
  const activity = Activity({});
  const storage = blocks[1];
  const installing = blocks[2];
  const activityBody = Block({ title: 'Activity', children: activity.props.children });
  assert.equal(activity.props.children.props.focusable, undefined);
  assert.equal(activity.props.children.props.focusKey, undefined);
  assert.equal(storage.type, Block);
  assert.equal(installing.props.focusable, undefined);
  for (const root of ['first', 'second']) {
    const drive = Drive({ root });
    assert.equal(drive.props.focusable, undefined);
    assert.equal(drive.props.focusKey, undefined);
  }
  assert.equal(activityBody.props.style.gap, 6);
  assert.equal(activityBody.props.style.paddingBottom, 8);
  assert.equal(panel.props.children.props.style.gap, 8);
});


test('Star markers in Discover rows anchor at the center of the right edge, not on covers', () => {
  const { WishBadge } = evaluateModule(new URL('../ui/GameCard.jsx', import.meta.url), {
    jsx, jsxs: jsx, px: (n) => n, EASE_OUT: [],
    useWishlist: () => ['featured-game'],
    useRef: (initial) => ({ current: initial }),
    View: 'View', Icon: 'Icon', motion: { View: 'MotionView' },
    transitions: { pop: {} },
  }, ['WishBadge']);
  const badge = WishBadge({ id: 'featured-game', focused: false, compact: true, placement: 'row-end' });
  assert.equal(badge.props.style.right, 10);
  assert.equal(badge.props.style.top, '50%');
  assert.equal(badge.props.style.marginTop, -18);
  assert.equal(badge.props.style.left, undefined);
  assert.equal(badge.props.style.width, 36);
  assert.equal(badge.props.style.height, 36);
});


