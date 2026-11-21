import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {serviceAddress} = await import('./download-services.js');

// The setup the Downloads page offers (issues #20, #89): each user's own key and client address.
// An address is saved as a URL the clients can call, and refused before it is if it is not one.
test('an address is saved with a scheme and no trailing slash', () => {
  assert.equal(serviceAddress('192.168.1.10:8080'), 'http://192.168.1.10:8080');
  assert.equal(serviceAddress('http://192.168.1.10:8080/'), 'http://192.168.1.10:8080');
  assert.equal(serviceAddress('https://nas.local/qbittorrent/'), 'https://nas.local/qbittorrent');
  assert.equal(serviceAddress('  http://10.0.0.2:8080  '), 'http://10.0.0.2:8080');
});

test('an empty address clears the setup instead of failing', () => {
  assert.equal(serviceAddress(''), '');
  assert.equal(serviceAddress(null), '');
});

test('what is not an address is refused', () => {
  assert.throws(() => serviceAddress('two words'), /host:port/);
  assert.throws(() => serviceAddress('ftp://host:21'), /host:port/);
  assert.throws(() => serviceAddress('http://'), /host:port/);
});
