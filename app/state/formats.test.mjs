import assert from 'node:assert/strict';
import test from 'node:test';

const {GROUPS, UNKNOWN, formatsOf, groupOf} = await import('./formats.js');
const {formats: index} = await import('../data/formats.js');

// Browse's format filter counts the whole catalog at once, while a release's format is read only
// when its game opens: data/formats.js carries the groups (tools/formats-index.mjs).

test('the console formats land in the groups the drawer shows', () => {
  assert.equal(groupOf('pkg'), 'pkg');
  assert.equal(groupOf('ffpkg'), 'pkg', "one game's PS5 package installs like the rest");
  assert.equal(groupOf('EXFAT'), 'exfat', 'the catalogue mixes cases');
  assert.equal(groupOf('ffpfsc'), 'ffpfs');
  assert.equal(groupOf('ffpfs'), 'ffpfs');
  for (const archive of ['rar', 'zip', '7z']) assert.equal(groupOf(archive), 'archive');
  assert.equal(groupOf('binary'), '', 'a .binary is whatever its first bytes say');
  assert.equal(groupOf(undefined), '');
});

test('a game matches every format its sources offer, in the drawer order', () => {
  assert.deepEqual(formatsOf([{format: 'exfat'}, {format: 'pkg'}, {format: 'pkg'}]), ['pkg', 'exfat']);
  assert.deepEqual(formatsOf([{format: 'binary'}, {format: 'zip'}]), ['archive']);
});

test('a game whose sources never say a format is unknown', () => {
  assert.deepEqual(formatsOf([]), [UNKNOWN]);
  assert.deepEqual(formatsOf([{format: 'binary'}]), [UNKNOWN]);
  assert.deepEqual(formatsOf(undefined), [UNKNOWN]);
});

test('the generated index only names groups the drawer has', () => {
  const known = new Set(GROUPS.map((group) => group.value));
  for (const [id, formats] of Object.entries(index)) {
    assert.match(id, /^[A-Z]{4}\d{5}$/, `${id} is a title ID`);
    assert.ok(formats.length, `${id} lists a format`);
    for (const format of formats) assert.ok(known.has(format), `${id} has ${format}`);
    assert.deepEqual(formats, GROUPS.map((group) => group.value).filter((value) => formats.includes(value)), `${id} keeps the drawer's order`);
  }
});
