import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaderIntent } from '../src/fader-intent.js';

test('keyboard increments accumulate while the mixer still reports the old level', () => {
  const intent = new FaderIntent();
  const sent = [];
  for (let n = 0; n < 3; n++) {
    const value = Number((intent.position(1, 0.5) + 0.001).toFixed(3));
    intent.request(1, value);
    sent.push(value);
  }
  assert.deepEqual(sent, [0.501, 0.502, 0.503]);
  intent.confirm(1, 0.501); // Late response to an earlier request.
  assert.equal(intent.position(1, 0.501), 0.503);
  intent.confirm(2, 0.503); // Another channel cannot clear the request.
  assert.equal(intent.position(1, 0.501), 0.503);
  intent.confirm(1, 0.503);
  assert.equal(intent.pending, null);
  assert.equal(intent.position(1, 0.6), 0.6); // Later external moves follow normally.
});
test('clear and channel changes cannot reuse a pending position for another channel', () => {
  const intent = new FaderIntent();
  intent.request(1, 0.8);
  assert.equal(intent.position(2, 0.2), 0.2);
  intent.clear();
  assert.equal(intent.position(1, 0.5), 0.5);
});
