import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const {clientOf} = await import('../downloads/labels.js');

// The game page and the queue's row say "Via TorBox" / "Via Real-Debrid" from this one answer, so a
// download that a service fetched is never shown as coming from the host it was offered as.

test('a converted job names the service that fetched it', () => {
  assert.equal(clientOf({viaTorbox: true}), 'TorBox');
  assert.equal(clientOf({viaRealDebrid: true}), 'Real-Debrid');
  assert.equal(clientOf({id: 'CUSA00000', state: 'downloading'}), '', 'an ordinary download names no service');
  assert.equal(clientOf(undefined), '', 'no job, nothing to say');
});

test('a multi-part set names the part in flight, not the job', () => {
  const job = {parts: [{viaTorbox: true}, {viaRealDebrid: true}], partIndex: 1};
  assert.equal(clientOf(job), 'Real-Debrid');
  assert.equal(clientOf({...job, partIndex: 0}), 'TorBox');
});
