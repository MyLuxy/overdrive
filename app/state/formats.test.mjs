import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_FORMAT_GAMES, formatOptions, hasFormat } from './formats.js';

const game = (...formats) => ({ formats });

test('a game matches the group its format belongs to', () => {
  assert.equal(hasFormat(game('pkg'), 'pkg'), true);
  assert.equal(hasFormat(game('exfat'), 'pkg'), false);
  assert.equal(hasFormat(game('ffpfsc'), 'ffpfs'), true);
  assert.equal(hasFormat(game('ffpfs'), 'ffpfs'), true);
  assert.equal(hasFormat(game('zip'), 'archive'), true);
  assert.equal(hasFormat(game('7z'), 'archive'), true);
});

test('a game offering several formats matches each of them', () => {
  const both = game('exfat', 'pkg');
  assert.equal(hasFormat(both, 'exfat'), true);
  assert.equal(hasFormat(both, 'pkg'), true);
  assert.equal(hasFormat(both, 'archive'), false);
});

test('a game with no known format matches only Unknown', () => {
  for (const none of [{}, game()]) {
    assert.equal(hasFormat(none, 'unknown'), true);
    assert.equal(hasFormat(none, 'pkg'), false);
    assert.equal(hasFormat(none, 'archive'), false);
  }
  assert.equal(hasFormat(game('pkg'), 'unknown'), false);
  assert.equal(hasFormat(game('pkg'), 'nonsense'), false);
});

test('options list the groups with enough games, the most common first', () => {
  const games = [
    ...Array.from({ length: MIN_FORMAT_GAMES + 2 }, () => game('exfat')),
    ...Array.from({ length: MIN_FORMAT_GAMES + 5 }, () => game('pkg')),
    ...Array.from({ length: MIN_FORMAT_GAMES - 1 }, () => game('rar')),
    game('ffpkg'),
  ];
  assert.deepEqual(formatOptions(games).map((option) => option.value), ['pkg', 'exfat']);
});

test('an option carries its display name, and a label only when it is translated', () => {
  const games = Array.from({ length: MIN_FORMAT_GAMES }, () => game('pkg', 'zip'));
  const [pkg, archive] = formatOptions(games);
  assert.deepEqual(pkg, { value: 'pkg', name: 'PKG' });
  assert.deepEqual(archive, { value: 'archive', name: 'Archive', label: 'filters.format.archive' });
});

test('Unknown comes last however many games it holds, and only with enough games', () => {
  const known = Array.from({ length: MIN_FORMAT_GAMES }, () => game('exfat'));
  const many = [...known, ...Array.from({ length: MIN_FORMAT_GAMES * 5 }, () => game())];
  assert.deepEqual(formatOptions(many).map((option) => option.value), ['exfat', 'unknown']);
  const few = [...known, ...Array.from({ length: MIN_FORMAT_GAMES - 1 }, () => game())];
  assert.deepEqual(formatOptions(few).map((option) => option.value), ['exfat']);
});

test('the Unknown option is translated', () => {
  const games = Array.from({ length: MIN_FORMAT_GAMES }, () => game());
  assert.deepEqual(formatOptions(games), [{ value: 'unknown', name: 'Unknown', label: 'filters.format.unknown' }]);
});

test('no games gives no options', () => {
  assert.deepEqual(formatOptions([]), []);
});
