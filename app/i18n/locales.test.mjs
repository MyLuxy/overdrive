import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const localeDir = join(dirname(fileURLToPath(import.meta.url)), 'locales');
const files = readdirSync(localeDir).filter((name) => name.endsWith('.json'));
const strings = [
  'catalog.library', 'catalog.favorites', 'catalog.gameCount',
  'catalog.empty.browseAll', 'filters.clearAll', 'filters.clearAllFilters',
  'filters.title', 'hints.favorite', 'hints.unfavorite',
  'nav.browse', 'nav.search', 'search.placeholder', 'search.recent',
  'sort.label', 'sort.title', 'sort.titleDesc'
];
const read = (file) => JSON.parse(readFileSync(join(localeDir, file), 'utf8'));

test('all supported languages translate the Library, Favorites and Search UI', () => {
  assert.equal(files.length, 18);
  for (const file of files) {
    const translations = read(file);
    for (const key of strings) {
      assert.equal(typeof translations[key], 'string', file + ': ' + key);
      assert.ok(translations[key].trim(), file + ': ' + key + ' must not be empty');
      assert.doesNotMatch(translations[key], /\?{2,}/,
        file + ': ' + key + ' contains text corrupted by character encoding');
    }
    assert.equal(translations['nav.browse'], translations['catalog.library'],
      file + ': the Browse tab and Library heading must agree');
  }
});

test('new labels use actual localized text instead of English fallbacks', () => {
  const english = read('en.json');
  for (const file of files.filter((file) => file !== 'en.json')) {
    const t = read(file);
    for (const key of ['catalog.library', 'filters.clearAllFilters', 'hints.unfavorite', 'search.placeholder']) {
      assert.notEqual(t[key], english[key], file + ': ' + key + ' needs a translation');
    }
  }
});

test('English Library labels and descending sort labels are coherent', () => {
  const en = read('en.json');
  assert.equal(en['nav.browse'], 'Library');
  assert.equal(en['sort.titleDesc'], 'Z–A');
  assert.match(en['search.placeholder'], /library/i);
});
