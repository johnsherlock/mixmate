import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
const MASTER = { kind: 'master', auxIndex: 0 };
const BASE = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4';
function fixture(factory = createAuxControlSession, failConstructor = 0, constructorHook = () => {}) {
  const sockets = [], jobs = new Map(); let time = 0, next = 0, constructors = 0;
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval(fn) { const id = ++next; jobs.set(id, { fn, at: Infinity }); return id; }, clearInterval(id) { jobs.delete(id); } };
  class Socket {
    readyState = 0; sent = []; hook = null;
    constructor() { if (++constructors === failConstructor) throw Error('Blocked'); sockets.push(this); constructorHook(constructors); }
    send(message) { this.sent.push(message); this.hook?.(message); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
    close() { this.readyState = 3; }
  }
  const session = factory({ WebSocketClass: Socket, timers, now: () => time, wallNow: () => time });
  return { session, sockets, jobs, advance(ms) { time += ms; for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); job.fn(); } }, get time() { return time; } };
}
const writes = socket => socket.sent.filter(x => x.startsWith('3:::SETD'));
for (const order of ['writer-first', 'receiver-first']) test(`peer connections ${order}: only authoritative receiver state qualifies, direct begin writes only writer`, () => {
  const a = fixture(); assert.equal(a.sockets.length, 0); a.session.connect('192.168.0.60');
  const [writer, receiver] = a.sockets; assert.equal(a.sockets.length, 2);
  if (order === 'writer-first') writer.open(); else receiver.open();
  writer.receive(BASE); assert.equal(a.session.snapshot().observations.size, 0);
  if (order === 'writer-first') receiver.open();
  receiver.receive(BASE);
  assert.equal(a.session.canEditLevelTarget(MASTER), order === 'writer-first');
  if (order === 'receiver-first') writer.open();
  assert.equal(a.session.canEditLevelTarget(MASTER), true);
  a.session.selectLevelTarget(MASTER); const token = a.session.beginLevelGesture(); assert.ok(token);
  assert.equal(a.session.commitLevelGesture(token, 0.5), true);
  assert.deepEqual(writes(writer), ['3:::SETD^a.0.mix^0.5', '3:::SETD^a.1.mix^0.5']); assert.deepEqual(writes(receiver), []);
  receiver.receive('3:::SETD^a.0.mix^0.5'); assert.equal(a.session.canEditLevelTarget(MASTER), false);
  receiver.receive('3:::SETD^a.1.mix^0.5'); assert.equal(a.session.canEditLevelTarget(MASTER), true);
  writer.receive(BASE); assert.equal(a.session.snapshot().observations.get('a.0.mix'), 0.5); // late writer INIT never rolls actual back
  assert.ok(a.session.beginLevelGesture());
  a.session.disconnect(); assert.ok(a.sockets.every(s => s.readyState === 3)); assert.equal(a.session.snapshot().observations.size, 0);
});
for (const failed of ['writer', 'receiver']) for (const event of ['close', 'error']) test(`${failed} ${event} revokes both connections and queued old-generation callbacks`, () => {
  const a = fixture(); a.session.connect('192.168.0.60'); const [writer, receiver] = a.sockets;
  writer.open(); receiver.open(); receiver.receive(BASE); a.session.selectLevelTarget(MASTER); const token = a.session.beginLevelGesture();
  const oldMessage = receiver.onmessage, oldWriter = writer.onmessage, target = failed === 'writer' ? writer : receiver;
  target[`on${event}`](); assert.ok(a.sockets.every(s => s.readyState === 3)); assert.equal(a.session.snapshot().observations.size, 0);
  assert.equal(a.session.commitLevelGesture(token, 0.9), false);
  a.advance(60000); assert.equal(a.sockets.length, 2); // no automatic healing
  a.session.connect('192.168.0.60'); a.sockets[2].open(); a.sockets[3].open(); a.sockets[3].receive(BASE);
  oldMessage({ data: BASE.replaceAll('^0.4', '^0.9') }); oldWriter({ data: BASE });
  assert.equal(a.session.snapshot().observations.get('a.0.mix'), 0.4); assert.deepEqual(writes(a.sockets[2]), []);
  a.session.disconnect();
});
test('receiver constructor failure, missing qualification and silent receiver close writer without new writes or reconnect', () => {
  const blocked = fixture(createAuxControlSession, 2); assert.equal(blocked.session.connect('192.168.0.60'), false); assert.equal(blocked.sockets[0].readyState, 3);
  for (const qualify of [false, true]) {
    const a = fixture(); a.session.connect('192.168.0.60'); const [writer, receiver] = a.sockets;
    writer.open(); receiver.open(); if (qualify) receiver.receive(BASE);
    a.advance(qualify ? 29000 : 14000); writer.receive('2::');
    a.advance(2000); assert.ok(a.sockets.every(s => s.readyState === 3)); assert.equal(a.session.snapshot().observations.size, 0);
    assert.equal(a.sockets.length, 2); assert.deepEqual(writes(writer), []); assert.deepEqual(writes(receiver), []);
  }
});
test('literal read-only factory remains one socket and only three connection forms', () => {
  const a = fixture(createReadOnlySession); a.session.connect('192.168.0.60'); const socket = a.sockets[0]; socket.open(); socket.receive(BASE); socket.receive('2::');
  assert.equal(a.sockets.length, 1); assert.deepEqual(Object.keys(a.session).sort(), ['connect', 'disconnect', 'snapshot', 'subscribe']);
  for (const { fn, at } of a.jobs.values()) if (at === Infinity) fn();
  assert.ok(socket.sent.every(message => ['3:::INIT', '3:::ALIVE', '2::'].includes(message))); a.session.disconnect();
});
test('own echoes rounded to 10 decimals stay raw actual, are own-echo matches (F09-S05) and need no Enable; foreign edits cancel old gesture only', () => {
  const a = fixture(); a.session.connect('192.168.0.60'); const [writer, receiver] = a.sockets; writer.open(); receiver.open(); receiver.receive(BASE);
  a.session.selectLevelTarget(MASTER); a.session.commitLevelGesture(a.session.beginLevelGesture(), 0.39619533446252725);
  receiver.receive('3:::SETD^a.0.mix^0.3961953345\nSETD^a.1.mix^0.3961953345');
  assert.equal(a.session.snapshot().observations.get('a.0.mix'), 0.3961953345); assert.match(a.session.snapshot().control.status, /Observed matching values \(desk-rounded to 10 significant digits\)/);
  assert.equal(a.session.snapshot().control.armed, true);
  assert.doesNotMatch(a.session.snapshot().control.status, /enable|controls off|acknowledged/i);
  const old = a.session.beginLevelGesture(); assert.ok(old); receiver.receive('3:::SETD^a.0.mix^0.42\nSETD^a.1.mix^0.42');
  assert.equal(a.session.commitLevelGesture(old, 0.8), false); assert.ok(a.session.beginLevelGesture()); assert.equal(writes(writer).length, 2); a.session.disconnect();
});
test('new absolute intent supersedes observation wait; late old observations cannot match newer expectation', () => {
  const a = fixture(); a.session.connect('192.168.0.60'); const [writer, receiver] = a.sockets; writer.open(); receiver.open(); receiver.receive(BASE);
  a.session.selectLevelTarget(MASTER); a.session.commitLevelGesture(a.session.beginLevelGesture(), 0.5);
  assert.equal(a.session.commitLevelGesture(a.session.beginLevelGesture(), 0.6), true); assert.equal(a.time, 0);
  receiver.receive('3:::SETD^a.0.mix^0.5\nSETD^a.1.mix^0.5');
  assert.notEqual(a.session.snapshot().control.outcome, 'observed-match'); assert.equal(a.session.snapshot().observations.get('a.0.mix'), 0.5);
  assert.ok(a.session.beginLevelGesture()); assert.equal(writes(writer).length, 4); a.session.disconnect();
});

test('receiver-first qualification cannot hide a stalled writer beyond initial connection deadline', () => {
  const a = fixture(); a.session.connect('192.168.0.60'); const [writer, receiver] = a.sockets;
  receiver.open(); receiver.receive(BASE); a.advance(14000); receiver.receive('2::');
  assert.equal(a.session.canEditLevelTarget(MASTER), false); a.advance(1000);
  assert.equal(writer.readyState, 3); assert.equal(receiver.readyState, 3); assert.equal(a.session.snapshot().observations.size, 0);
  assert.equal(a.sockets.length, 2); assert.deepEqual(writes(writer), []);
});
test('same-value post-floor receipts publish automatic recovery immediately without relying on meter/timer changes', () => {
  const a = fixture(); a.session.connect('192.168.0.60'); const [writer, receiver] = a.sockets; writer.open(); receiver.open(); receiver.receive(BASE);
  a.session.selectLevelTarget(MASTER); const token = a.session.beginLevelGesture();
  writer.hook = message => { if (message.startsWith('3:::SETD')) a.session.disarmLevel(); };
  assert.equal(a.session.commitLevelGesture(token, 0.5), false); writer.hook = null;
  assert.equal(a.session.snapshot().control.eligible, false);
  const published = []; const unsubscribe = a.session.subscribe(snapshot => published.push(snapshot.control.eligible));
  receiver.receive('3:::SETD^a.0.mix^0.4'); assert.equal(published.at(-1), false);
  const before = published.length; receiver.receive('3:::SETD^a.1.mix^0.4');
  assert.ok(published.length > before); assert.equal(published.at(-1), true); assert.equal(a.time, 0);
  assert.ok(a.session.beginLevelGesture()); assert.equal(writes(writer).length, 1); unsubscribe(); a.session.disconnect();
});


test('read-only target eligibility rejects accessors before reading them', () => {
  const a = fixture(); a.session.connect('192.168.0.60'); const [writer, receiver] = a.sockets; writer.open(); receiver.open(); receiver.receive(BASE);
  let invoked = 0;
  for (const field of ['kind', 'groupId', 'auxIndex']) {
    const descriptor = { kind: 'group', groupId: 'band', auxIndex: 0 };
    Object.defineProperty(descriptor, field, { enumerable: true, get() { invoked++; return field === 'kind' ? 'group' : 0; } });
    assert.equal(a.session.canEditLevelTarget(descriptor), false);
  }
  assert.equal(invoked, 0); assert.deepEqual(writes(writer), []); a.session.disconnect();
});
for (const ordinal of [1, 2]) test(`reentrant constructor invalidation closes orphan socket ${ordinal} without assigning stale ownership`, () => {
  let a;
  a = fixture(createAuxControlSession, 0, index => { if (index === ordinal) a.session.disconnect(); });
  assert.equal(a.session.connect('192.168.0.60'), false);
  assert.ok(a.sockets.every(socket => socket.readyState === 3)); assert.equal(a.session.snapshot().observations.size, 0);
  assert.equal(a.session.canEditLevelTarget(MASTER), false); assert.ok(a.sockets.every(socket => socket.sent.length === 0));
  a.advance(60000); assert.equal(a.sockets.length, ordinal);
});


for (const terminal of ['closed', 'timeout']) test(`partial ${terminal} retains exact send-return/planned diagnostics after dual-socket state clearing`, () => {
  const a = fixture(); a.session.connect('192.168.0.60'); const [writer, receiver] = a.sockets; writer.open(); receiver.open(); receiver.receive(BASE);
  a.session.selectLevelTarget(MASTER); const token = a.session.beginLevelGesture();
  writer.hook = message => { if (message.startsWith('3:::SETD')) { if (terminal === 'closed') writer.close(); else a.advance(30000); } };
  assert.equal(a.session.commitLevelGesture(token, 0.5), false);
  const snapshot = a.session.snapshot(); assert.equal(snapshot.phase, terminal);
  assert.equal(snapshot.observations.size, 0); assert.ok(a.sockets.every(socket => socket.readyState === 3));
  assert.equal(snapshot.control.authorized, 1); assert.equal(snapshot.control.dispatched, 1); assert.equal(snapshot.control.unknownDelivery, false);
  assert.match(snapshot.control.status, /Returned 1\/1 authorized of 2 planned/);
  assert.match(snapshot.control.status, /some values may have changed/);
  assert.deepEqual(writes(writer), ['3:::SETD^a.0.mix^0.5']); assert.deepEqual(writes(receiver), []);
  assert.equal(a.session.commitLevelGesture(token, 0.6), false); a.advance(60000); assert.equal(a.sockets.length, 2);
});
