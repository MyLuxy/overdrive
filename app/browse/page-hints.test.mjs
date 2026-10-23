import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateModule } from '../test-support/hooks.mjs';

const hint = (label) => ({ button: label === 'delete' || label === 'favorite' ? 'square' : 'cross',
  label: 'hints.' + label });
const HINT = Object.fromEntries(['select', 'favorite', 'delete', 'top', 'sections']
  .map((name) => [name, hint(name)]));
const { hintsFor, PageHints } = evaluateModule(new URL('./PageHints.jsx', import.meta.url), {
  HINT,
  useFocus: () => ({ focusedKey: 'card:one' }),
  useNavState: () => ({ top: { name: 'browse' } }),
  useStore: () => ({ browsePanel: 'search' }),
  useHints: (value) => { captured = value; },
}, ['hintsFor', 'PageHints']);
let captured;

test('search tools delete and result cards favorite', () => {
  for (const focus of ['catalog:keyboard:0', 'catalog:toggle:search', 'chip:genre']) {
    const hints = hintsFor(focus, true);
    assert.equal(hints.filter((h) => h.button === 'square').length, 1);
    assert.equal(hints.find((h) => h.button === 'square').label, 'hints.delete');
  }
  assert.equal(hintsFor('card:game', true).find((h) => h.button === 'square').label, 'hints.favorite');
  PageHints();
  assert.equal(captured.find((h) => h.button === 'square').label, 'hints.favorite');
});

test('Library cards keep Square Favorite outside search, Discover hints stay unchanged', () => {
  assert.equal(hintsFor('card:game', false).find((h) => h.button === 'square').label, 'hints.favorite');
  assert.equal(hintsFor('spotlight:cta', true).find((h) => h.button === 'square').label, 'hints.favorite');
});

test('non-game genre filters and CDN collection do not advertise Square Favorite', () => {
  for (const focus of ['genre:action', 'cdn:card', 'cdn:all']) {
    assert.equal(hintsFor(focus, false).some((hint) => hint.button === 'square'), false);
  }
  for (const focus of ['popular:game', 'recent:game', 'chart:newest:game', 'spotlight:cta', 'spotlight:2']) {
    assert.equal(hintsFor(focus, false).find((hint) => hint.button === 'square')?.label,
      'hints.favorite', focus);
  }
});
