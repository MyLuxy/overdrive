import assert from 'node:assert/strict';
import test from 'node:test';
import { createHookHarness, evaluateModule } from '../test-support/hooks.mjs';

const jsx = (type, props, key) => ({ type, props, key });

test('Downloads and Files render without a legend or JavaScript exception', () => {
  const renderer = createHookHarness();
  let screen = 'browse', browsePanel = null, focusedKey = null, wishlist = [];
  const module = evaluateModule(new URL('./Legend.jsx', import.meta.url), {
    ...renderer.hooks,
    jsx,
    memo: (component) => component,
    ButtonHints: 'button-hints',
    View: 'view',
    useFocus: () => ({ focusedKey }),
    useNavState: () => ({ top: { name: screen } }),
    useWishlist: () => wishlist,
    useStore: () => ({ browsePanel }),
    listedId: (id) => id,
    useFavoriteTarget: (key) => key === 'spotlight:0' ? 'hero-game'
      : key?.startsWith('card:') ? key.slice(5) : null,
  }, ['Legend']);

  const render = () => renderer.settle(() => module.Legend({ screen }));
  for (const page of ['browse', 'game', 'homebrew', 'search']) {
    screen = page;
    const tree = render();
    assert.equal(tree.type, 'view', page);
    assert.ok(tree.props.children.props.hints.length > 0, page);
  }
  for (const page of ['downloads', 'files', 'settings']) {
    screen = page;
    assert.equal(render(), null, page + ' has no bottom hints');
  }
  screen = 'browse';
  assert.equal(render().type, 'view', 'the legend returns after leaving Downloads');
  browsePanel = 'search';
  assert.equal(render().props.children.props.hints.find((h) => h.button === 'square').label, 'hints.delete');
  browsePanel = null;
  assert.equal(render().props.children.props.hints.find((h) => h.button === 'square').label, 'hints.favorite');
  focusedKey = 'spotlight:0';
  wishlist = ['hero-game'];
  assert.equal(render().props.children.props.hints.find((h) => h.button === 'square')?.label,
    'hints.unfavorite', 'Discover hints must react to a previously favorited spotlight item');
  wishlist = [];
  assert.equal(render().props.children.props.hints.find((h) => h.button === 'square')?.label,
    'hints.favorite', 'Discover hints must switch back after unfavoriting');
  screen = 'homebrew';
  focusedKey = 'homebrew-kind:all';
  assert.equal(render().props.children.props.hints.find((h) => h.button === 'square'), undefined,
    'Homebrew filter chips must not advertise Favorite');
  focusedKey = 'card:brew-app';
  wishlist = ['brew-app'];
  assert.equal(render().props.children.props.hints.find((h) => h.button === 'square')?.label,
    'hints.unfavorite', 'Homebrew games have contextual Square/Unfavorite');
  wishlist = [];
  assert.equal(render().props.children.props.hints.find((h) => h.button === 'square')?.label,
    'hints.favorite');
  renderer.cleanup();
});
