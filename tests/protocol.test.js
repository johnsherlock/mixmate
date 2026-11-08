import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixerURL, parseStateFrame, MixerConnection, OUTBOUND } from '../src/protocol.js';

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
  const client = new MixerConnection({ WebSocketClass: FakeSocket, onStatus: s => statuses.push(s), onUpdates: u => updates.push(u), ...options });
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

test('fader writes require live level and stereo metadata and use the exact input path', () => {
  const { client } = setup();
  assert.equal(client.setInputFader(1, 0.5), false);
  client.connect('192.168.0.60');
  const socket = FakeSocket.instances.at(-1);
  socket.open();
  try {
    assert.equal(client.setInputFader(1, 0.5), false);
    socket.receive('3:::SETD^i.0.mix^0.3');
    assert.equal(client.setInputFader(1, 0.5), false);
    socket.receive('3:::SETD^i.0.stereoIndex^-1');
    assert.equal(client.setInputFader(1, 0.5), true);
    assert.equal(socket.sent.at(-1), '3:::SETD^i.0.mix^0.5');
    for (const value of [NaN, Infinity, -0.1, 1.1, '0.5']) assert.throws(() => client.setInputFader(1, value));
    for (const channel of [0, 25, 1.5, '1', NaN]) assert.equal(client.setInputFader(channel, 0.5), false);
    assert.equal(client.setInputFader(1, 0), true);
    assert.equal(client.setInputFader(1, 1), true);
    client.disconnect();
    assert.equal(client.setInputFader(1, 0.2), false);
    client.connect('192.168.0.60'); FakeSocket.instances.at(-1).open();
    assert.equal(client.setInputFader(1, 0.2), false);
  } finally { client.disconnect(); }
});
test('stereo-linked input faders move together, only with reciprocal link state', () => {
  const { client } = setup(); client.connect('192.168.0.60');
  const socket = FakeSocket.instances.at(-1); socket.open();
  try {
    socket.receive('3:::SETD^i.0.mix^0.3\nSETD^i.0.stereoIndex^0\nSETD^i.1.mix^0.3');
    assert.equal(client.setInputFader(1, 0.5), false);
    socket.receive('3:::SETD^i.1.stereoIndex^1');
    assert.equal(client.setInputFader(1, 0.5), true);
    assert.deepEqual(socket.sent.slice(-2), ['3:::SETD^i.0.mix^0.5', '3:::SETD^i.1.mix^0.5']);
    assert.equal(client.setInputFader(2, 0.4), true);
    assert.deepEqual(socket.sent.slice(-2), ['3:::SETD^i.1.mix^0.4', '3:::SETD^i.0.mix^0.4']);
    const before = socket.sent.length;
    socket.receive('3:::SETD^i.0.mix^0.8');
    assert.equal(socket.sent.length, before); // Incoming state never echoes a write.
  } finally { client.disconnect(); }
});
