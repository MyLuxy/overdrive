import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_KINDS, matchesFavoriteKind } from './favorite-kinds.js';

const regular = { id: 'ps5-game' };
const app = { id: 'hb-app', homebrew: { kind: 'app', category: 'utilities' } };
const emulator = { id: 'hb-emu', homebrew: { kind: 'tool', category: 'emulators' } };
const game = { id: 'hb-game', homebrew: { kind: 'game', category: 'homebrew-games' } };
const tool = { id: 'hb-tool', homebrew: { kind: 'tool', category: 'utilities' } };

test('Favorites Search exposes exactly the Homebrew categories in the correct order', () => {
  assert.deepEqual(FAVORITE_KINDS.map(({ id }) => id),
    ['all', 'app', 'game', 'emulators', 'tool']);
});
test('Favorites categories include regular games and homebrew in All', () => {
  assert.deepEqual([regular, app, emulator, game, tool].filter(g => matchesFavoriteKind(g, 'all')),
    [regular, app, emulator, game, tool]);
  assert.deepEqual([regular, app, emulator, game, tool].filter(g => matchesFavoriteKind(g, 'app')), [app]);
  assert.deepEqual([regular, app, emulator, game, tool].filter(g => matchesFavoriteKind(g, 'game')), [regular, game]);
  assert.deepEqual([regular, app, emulator, game, tool].filter(g => matchesFavoriteKind(g, 'emulators')), [emulator]);
  assert.deepEqual([regular, app, emulator, game, tool].filter(g => matchesFavoriteKind(g, 'tool')), [emulator, tool]);
});
