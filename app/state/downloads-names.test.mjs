import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const {configure} = await import('../i18n/core.js');
const {driveName, driveShortName} = await import('./drive-names.js');

// Issue #103: Settings shows one segment per drive, and with two USB drives plus the extended storage
// five of them share 830 px. The long names lose the number that tells the drives apart there, so
// Settings asks this short form; the game page keeps the long one.
configure(() => ({}), JSON.parse(readFileSync(new URL('../i18n/locales/en.json', import.meta.url), 'utf8')));

test('each drive has a short name that keeps its number', () => {
  assert.equal(driveName('/mnt/ext1'), 'Extended storage 2');
  assert.equal(driveShortName('/mnt/ext1'), 'Extended 2');
  assert.equal(driveName('/mnt/usb0'), 'USB drive 1');
  assert.equal(driveShortName('/mnt/usb0'), 'USB 1');
  assert.equal(driveName('/data'), 'Internal storage');
  assert.equal(driveShortName('/data'), 'Internal');
});

test('a mount that is not a drive keeps its plain name', () => {
  assert.equal(driveShortName('/mnt/something'), 'This device');
});
