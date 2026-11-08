import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixerURL, parseStateFrame, ReadOnlyConnection, OUTBOUND } from '../src/protocol.js';

test('only accepts private IPv4 addresses, without URL injection', () => {
  assert.equal(mixerURL(' 192.168.0.60 '), 'ws://192.168.0.60/');
  assert.equal(mixerURL('172.31.0.10'), 'ws://172.31.0.10/');
  for (const invalid of ['8.8.8.8', '127.0.0.1', '192.168.0.256', '192.168.00.60', '192.168.0.60/path', 'ws://192.168.0.60', '172.32.0.1']) {
    assert.throws(() => mixerURL(invalid));
  }
});
test('parses batched channel state and preserves carets in names', () => {
  assert.deepEqual(parseStateFrame('3:::SETS^i.0.name^Lead ^ Vocal\nSETD^i.0.mix^0.5\nSETD^i.0.mute^1'), [
    ['i.0.name', 'Lead ^ Vocal'], ['i.0.mix', 0.5], ['i.0.mute', 1],
  ]);
});
test('rejects invalid values and unrelated mixer data', () => {
  assert.deepEqual(parseStateFrame('3:::SETD^i.0.mix^NaN\nSETD^i.0.mix^\nSETD^i.0.mix^1.1\nSETD^i.0.mute^2\nSETS^i.0.mix^0.2\nSETD^i.24.mix^0.5\nSETD^m.mix^1\nSETS^__proto__^x'), []);
  assert.deepEqual(parseStateFrame(null), []);
});
class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; FakeSocket.instances.push(this); }
  send(value) { this.sent.push(value); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(data) { this.onmessage?.({ data }); }
}
function setup(options = {}) {
  const statuses = [], updates = [];
  const client = new ReadOnlyConnection({ WebSocketClass: FakeSocket, onStatus: s => statuses.push(s), onUpdates: u => updates.push(u), ...options });
  return { client, statuses, updates };
}
test('requests state and sends only permitted connection messages', async () => {
  const { client, statuses, updates } = setup();
  try {
    client.connect('192.168.0.60');
    const socket = FakeSocket.instances.at(-1);
    socket.open(); socket.receive('2::'); socket.receive('3:::SETD^i.0.mix^0.5');
    await new Promise(r => setTimeout(r, 1050));
    assert.deepEqual(statuses, ['connecting', 'connected', 'live']);
    assert.equal(updates.length, 1);
    assert.ok(socket.sent.includes(OUTBOUND.alive));
    assert.ok(socket.sent.every(m => Object.values(OUTBOUND).includes(m)));
    assert.ok(socket.sent.every(m => !m.includes('SETD') && !m.includes('SETS')));
  } finally { client.disconnect(); }
});
test('times out even if socket opens but sends no channel state', async () => {
  const { client, statuses } = setup({ timeoutMs: 10 });
  client.connect('192.168.0.60');
  const socket = FakeSocket.instances.at(-1); socket.open();
  await new Promise(r => setTimeout(r, 25));
  assert.equal(statuses.at(-1), 'timeout'); assert.equal(socket.closed, true);
});
test('disconnect cancels a pending connection and ignores old callbacks', () => {
  const { client, statuses } = setup();
  client.connect('192.168.0.60');
  const first = FakeSocket.instances.at(-1), lateOpen = first.onopen;
  client.disconnect(); lateOpen();
  assert.equal(first.sent.length, 0); assert.equal(first.closed, true);
  assert.deepEqual(statuses, ['connecting']);
});
