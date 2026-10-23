import assert from 'node:assert/strict';
import test from 'node:test';
import { createHookHarness, evaluateModule } from '../test-support/hooks.mjs';

const harness = createHookHarness();
const targets = evaluateModule(new URL('./favoriteFocus.js', import.meta.url), {
  useEffect: harness.hooks.useEffect,
  useState: harness.hooks.useState,
}, ['setFavoriteTarget', 'favoriteTarget', 'useFavoriteTarget']);

test('Square target follows cards, chart rankings, five spotlight suggestions and the hero buttons', () => {
  assert.equal(targets.favoriteTarget('genre:action'), null);
  assert.equal(targets.favoriteTarget('homebrew-kind:app'), null);
  assert.equal(targets.favoriteTarget('cdn:card'), null);
  assert.equal(targets.favoriteTarget('card:homebrew-app'), 'homebrew-app');
  const ids = [
    ['popular:one', 'one'],
    ['recent:two', 'two'],
    ['continue:job', 'download-game'],
    ['chart:rating:three', 'three'],
    ['chart:relevance:four', 'four'],
    ['chart:newest:five', 'five'],
    ['spotlight:0', 'hero-0'],
    ['spotlight:1', 'hero-1'],
    ['spotlight:2', 'hero-2'],
    ['spotlight:3', 'hero-3'],
    ['spotlight:4', 'hero-4'],
    ['spotlight:cta', 'hero-0'],
    ['spotlight:wish', 'hero-0'],
  ];
  for (const [key, id] of ids) {
    targets.setFavoriteTarget(key, id);
    assert.equal(targets.favoriteTarget(key), id, key);
  }
  targets.setFavoriteTarget('spotlight:cta', 'hero-1');
  assert.equal(targets.favoriteTarget('spotlight:cta'), 'hero-1', 'slide change retargets Square');
  targets.setFavoriteTarget('spotlight:cta', null);
  assert.equal(targets.favoriteTarget('spotlight:cta'), null, 'unmounted spotlight must not target a previous game');
});

test('legend subscription refreshes when a rotating slide replaces the focused favorite target', () => {
  targets.setFavoriteTarget('spotlight:wish', 'before');
  let renders = 0;
  const render = () => harness.settle(() => {
    renders++;
    return targets.useFavoriteTarget('spotlight:wish');
  });
  assert.equal(render(), 'before');
  targets.setFavoriteTarget('spotlight:wish', 'after');
  assert.equal(render(), 'after');
  assert.ok(renders >= 2, 'changing a spotlight target must trigger a subscribed refresh');
  harness.cleanup();
});

test('favorite action never toggles a stale card when a filter or navigation header has focus', () => {
  let key = 'spotlight:2';
  const toggled = [];
  const { useFavoriteAction } = evaluateModule(new URL('./GameCard.jsx', import.meta.url), {
    useStoreActions: () => ({ toggleWish: (id) => toggled.push(id) }),
    useFocus: () => ({ focusedKey: key }),
    favoriteTarget: targets.favoriteTarget,
    px: (n) => n, EASE_OUT: [],
  }, ['useFavoriteAction']);
  const favorite = () => useFavoriteAction();
  assert.equal(favorite()('square'), true);
  assert.equal(toggled.at(-1), 'hero-2');
  key = 'chart:relevance:four';
  assert.equal(favorite()('square'), true);
  assert.equal(toggled.at(-1), 'four');
  key = 'card:homebrew-app';
  assert.equal(favorite()('square'), true);
  assert.equal(toggled.at(-1), 'homebrew-app');
  const count = toggled.length;
  key = 'catalog:toggle:filters';
  assert.equal(favorite()('square'), false);
  assert.equal(favorite()('circle'), false);
  assert.equal(toggled.length, count);
});
