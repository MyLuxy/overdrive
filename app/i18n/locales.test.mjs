import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const {configure, setLocale, t} = await import('./core.js');
const {compile} = await import('./icu.js');

const read = (code) => JSON.parse(readFileSync(new URL(`./locales/${code}.json`, import.meta.url), 'utf8'));
const en = read('en');
const pl = read('pl');

// Polish arrived for issue #121: a language is only added when the file carries every string, and
// Polish counts in one, few and many, which the interface's plurals have to follow.

test('Polish carries every English string', () => {
  assert.deepEqual(Object.keys(en).filter((key) => !(key in pl)), []);
});

test('every Polish string is a valid message', () => {
  for (const [key, text] of Object.entries(pl)) {
    assert.doesNotThrow(() => compile(text), key);
  }
});

test('Polish plurals say one, few and many', () => {
  configure((code) => (code === 'pl' ? pl : en), en);
  setLocale('pl');
  assert.equal(t('catalog.gameCount', {count: 1}), '1 gra');
  assert.equal(t('catalog.gameCount', {count: 3}), '3 gry');
  assert.equal(t('catalog.gameCount', {count: 22}), '22 gry', 'a 2 at the end wins over the teens rule');
  assert.equal(t('catalog.gameCount', {count: 5}), '5 gier');
  assert.equal(t('catalog.gameCount', {count: 12}), '12 gier');
  assert.equal(t('catalog.gameCount', {count: 0}), '0 gier');
});
