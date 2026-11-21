import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {storageIndex} = await import('./download-root.js');

// Issue #103: the drive picked last time is proposed again, but only when it is still there and has
// room for the release; otherwise the app falls back to its own pick (the first drive that fits).
const ROOTS = ['/data', '/mnt/usb0', '/mnt/ext1'];
const fitsAll = () => true;
const fitsOnly = (...roots) => root => roots.includes(root);

test('the remembered drive is preselected', () => {
  assert.equal(storageIndex(ROOTS, '/mnt/ext1', fitsAll), 2);
  assert.equal(storageIndex(ROOTS, '/mnt/usb0', fitsAll), 1);
});

test('nothing remembered keeps the app`s own pick', () => {
  assert.equal(storageIndex(ROOTS, null, fitsAll), 0);
  assert.equal(storageIndex(ROOTS, null, fitsOnly('/mnt/usb0')), 1);
});

test('a remembered drive that is gone falls back', () => {
  assert.equal(storageIndex(ROOTS, '/mnt/usb9', fitsAll), 0);
  assert.equal(storageIndex(ROOTS, '/mnt/usb9', fitsOnly('/mnt/ext1')), 2);
});

test('a remembered drive without room falls back', () => {
  assert.equal(storageIndex(ROOTS, '/mnt/ext1', fitsOnly('/data', '/mnt/usb0')), 0);
  assert.equal(storageIndex(ROOTS, '/mnt/ext1', fitsOnly('/mnt/usb0')), 1);
});

test('no drive fits, so the first one is proposed', () => {
  assert.equal(storageIndex(ROOTS, '/mnt/ext1', () => false), 0);
});
