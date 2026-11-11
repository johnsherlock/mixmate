import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createAuxLevelSession } from '../src/iem/aux-level-session.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { parseIemStateFrame } from '../src/iem/protocol.js';
const target = { sourceId: 'i.0', auxIndex: 0 }, level = { kind: 'send', sourceId: 'i.0', auxIndex: 0 };
const LIVE = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.5\nSETD^a.1.mix^0.6\nSETD^i.0.stereoIndex^-1\nSETD^i.0.aux.0.value^0.3\nSETD^i.0.aux.1.value^0.3\nSETD^i.0.aux.0.pan^0.4\nSETD^i.0.aux.1.pan^0.4';
function fixture(factory = createAuxControlSession, frame = LIVE) {
  let mono = 0, wall = 0, next = 0; const jobs = new Map(), sockets = [];
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: mono + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval() { return ++next; }, clearInterval() {} };
  class FakeSocket {
    readyState = 0; sent = []; hook = null; throws = false; attempts = 0;
    constructor(url) { this.url = url; sockets.push(this); }
    send(message) {
      const updates = parseIemStateFrame(message), item = updates[0];
      assert.ok(['3:::INIT', '3:::ALIVE', '2::'].includes(message) || updates.length === 1 && (item.field === 'level' && ['aux', 'send'].includes(item.kind) || item.kind === 'send' && item.field === 'pan' && /^[ilp]\./.test(item.sourceId)), message);
      if (message.startsWith('3:::SETD')) this.attempts++;
      if (this.throws) throw Error('Unknown delivery'); this.sent.push(message); this.hook?.(message);
    }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
  }
  const session = factory({ WebSocketClass: FakeSocket, timers, now: () => mono, wallNow: () => wall, panEnabled: true, controlEnabled: true, enablePan: true });
  const connect = () => { session.connect('192.168.0.60'); const socket = sockets.at(-1); socket.open(); socket.receive(frame); return socket; };
  return { session, sockets, connect, move(amount, wallAmount = amount) { mono += amount; wall += wallAmount; }, flush() { for (const [id, job] of [...jobs]) if (job.at <= mono) { jobs.delete(id); job.fn(); } },
    begin() { assert.equal(session.selectPanTarget(target), true); assert.equal(session.armPan(), true); return session.beginPanGesture(); } };
}
const writes = socket => socket.sent.filter(message => message.startsWith('3:::SETD'));
test('literal factories preserve read-only and level-only capabilities despite malicious upgrade options', () => {
  const read = fixture(createReadOnlySession); read.connect(); assert.deepEqual(Object.keys(read.session).sort(), ['connect', 'disconnect', 'snapshot', 'subscribe']);
  const levels = fixture(createAuxLevelSession); levels.connect(); assert.equal(levels.session.selectPanTarget, undefined); assert.equal(levels.session.armPan, undefined); assert.equal(levels.session.snapshot().control.panCapable, undefined);
  assert.equal(levels.session.selectLevelTarget({ kind: 'pan', ...target }), false); assert.equal(writes(levels.sockets[0]).length, 0);
  const control = fixture(); control.connect(); assert.equal(control.session.snapshot().control.panCapable, true); assert.equal(control.session.socket, undefined); assert.equal(control.session.send, undefined);
});
test('pan selection/arm/preview never write; only current cached normalized pan gesture releases two rounded commands', () => {
  const app = fixture(), socket = app.connect(); app.session.selectPanTarget(target); assert.equal(app.session.beginPanGesture(), null); assert.equal(writes(socket).length, 0);
  app.session.armPan(); const token = app.session.beginPanGesture(); assert.ok(token); assert.equal(app.session.previewPanGesture(token, 0.1235), 0.124); assert.equal(writes(socket).length, 0);
  assert.equal(app.session.snapshot().observations.get('i.0.aux.0.pan'), 0.4); assert.equal(app.session.commitPanGesture({}), false);
  assert.equal(app.session.commitPanGesture(token), true); assert.deepEqual(writes(socket), ['3:::SETD^i.0.aux.0.pan^0.124', '3:::SETD^i.0.aux.1.pan^0.124']);
  assert.equal(app.session.snapshot().control.expectedPan, 0.124); assert.equal(app.session.snapshot().control.pending, true); assert.equal(app.session.beginPanGesture(), null);
  socket.receive(writes(socket)[0]); assert.equal(app.session.snapshot().control.pending, true);
  socket.receive(writes(socket)[1]); assert.equal(app.session.snapshot().control.pending, false); assert.match(app.session.snapshot().control.status, /matching pan/); assert.equal(app.session.snapshot().control.armed, true);
});
test('level/group and pan permissions/tokens exclude each other and wrong-kind entry points cannot act', () => {
  const app = fixture(), socket = app.connect(); app.session.selectLevelTarget(level); app.session.armLevel(); const old = app.session.beginLevelGesture();
  app.session.selectPanTarget(target); assert.equal(app.session.snapshot().control.armed, false); assert.equal(app.session.commitLevelGesture(old, 0.7), false);
  assert.equal(app.session.armLevel(), false); app.session.armPan(); const token = app.session.beginPanGesture(); assert.equal(app.session.beginLevelGesture(), null); assert.equal(app.session.previewLevelGesture(token, 0.7), null);
  app.session.cancelLevelGesture(); assert.equal(app.session.snapshot().control.gestureActive, true); app.session.previewPanGesture(token, 0.6);
  app.session.selectLevelTarget(level); assert.equal(app.session.snapshot().control.armed, false); assert.equal(app.session.commitPanGesture(token), false); assert.equal(app.session.armPan(), false);
  assert.equal(writes(socket).length, 0);
});
test('pan-only observed sources can control without levels; linked/FX/mono-AUX/missing/unequal cases remain unavailable', () => {
  const app = fixture(), socket = app.connect(); socket.receive('3:::SETD^i.5.stereoIndex^-1\nSETD^i.5.aux.0.pan^0.25\nSETD^i.5.aux.1.pan^0.25');
  assert.equal(app.session.selectPanTarget({ sourceId: 'i.5', auxIndex: 0 }), true); assert.equal(app.session.armPan(), true); assert.equal(app.session.snapshot().observations.has('i.5.aux.0.value'), false);
  for (const change of ['3:::SETD^a.0.stereoIndex^-1', '3:::SETD^i.0.stereoIndex^0\nSETD^i.1.stereoIndex^1', '3:::SETD^i.0.aux.0.pan^0.2504\nSETD^i.0.aux.1.pan^0.25049']) {
    const item = fixture(), desk = item.connect(); desk.receive(change); assert.equal(item.session.selectPanTarget(target), false); assert.equal(item.session.armPan(), false); assert.equal(writes(desk).length, 0);
  }
  socket.receive('3:::SETD^f.0.aux.0.pan^0.25\nSETD^f.0.aux.1.pan^0.25'); assert.equal(app.session.selectPanTarget({ sourceId: 'f.0', auxIndex: 0 }), false); assert.equal(app.session.armPan(), false);
  assert.equal(app.session.selectPanTarget({ sourceId: 'i.20', auxIndex: 0 }), false); assert.equal(writes(socket).length, 0);
});
test('native pan away/back, level or topology edits invalidate pan baseline; identical receipts/names do not', () => {
  for (const frame of ['3:::SETD^i.0.aux.0.pan^0.7\nSETD^i.0.aux.0.pan^0.4', '3:::SETD^i.0.aux.0.value^0.7', '3:::SETD^a.1.matrix^1']) {
    const app = fixture(), socket = app.connect(), token = app.begin(); app.session.previewPanGesture(token, 0.6); socket.receive(frame); assert.equal(app.session.commitPanGesture(token), false); assert.equal(app.session.snapshot().control.armed, false); assert.equal(writes(socket).length, 0);
  }
  const app = fixture(), socket = app.connect(), token = app.begin(); socket.receive('3:::SETD^i.0.aux.0.pan^0.4\nSETS^i.0.name^Synthetic <svg>'); assert.equal(app.session.previewPanGesture(token, 0.6), 0.6); assert.equal(app.session.commitPanGesture(token), true);
});
test('actual pan edits also cancel level permission in combined factory while old level-only semantics stay intact', () => {
  for (const factory of [createAuxControlSession, createAuxLevelSession]) {
    const app = fixture(factory), socket = app.connect(); app.session.selectLevelTarget(level); app.session.armLevel(); const token = app.session.beginLevelGesture(); socket.receive('3:::SETD^i.0.aux.0.pan^0.5');
    assert.equal(app.session.snapshot().control.armed, factory === createAuxLevelSession); assert.equal(app.session.commitLevelGesture(token, 0.5), factory === createAuxLevelSession);
  }
});
test('same-value and rounded expected pan needs fresh post-authorization receipt on every path', () => {
  const app = fixture(), socket = app.connect(), token = app.begin(); app.session.previewPanGesture(token, 0.40049); socket.receive('3:::SETD^i.0.aux.0.pan^0.4\nSETD^i.0.aux.1.pan^0.4');
  app.session.commitPanGesture(token); assert.equal(app.session.snapshot().control.pending, true); socket.receive(writes(socket)[0]); assert.equal(app.session.snapshot().control.pending, true); socket.receive(writes(socket)[1]); assert.equal(app.session.snapshot().control.pending, false);
});
test('held confirmation timers, late echo and backwards clocks never confirm expired pan or rearm', () => {
  for (const mode of ['snapshot', 'late', 'backward']) {
    const app = fixture(), socket = app.connect(), token = app.begin(); app.session.previewPanGesture(token, 0.6); app.session.commitPanGesture(token); app.move(mode === 'backward' ? -1 : 2600);
    if (mode === 'late') for (const message of writes(socket)) socket.receive(message);
    const state = app.session.snapshot(); assert.equal(state.control.pending, false); assert.equal(state.control.armed, false); assert.doesNotMatch(state.control.status, /matching pan/);
    app.flush(); assert.equal(writes(socket).length, 2);
  }
});
test('fresh conflict is labelled pan; invalidation/close/reconnect never replays old tokens', () => {
  const app = fixture(), socket = app.connect(), token = app.begin(); app.session.previewPanGesture(token, 0.6); app.session.commitPanGesture(token); socket.receive('3:::SETD^i.0.aux.0.pan^0.4'); assert.match(app.session.snapshot().control.status, /Conflicting pan/);
  app.session.closePan(); app.connect(); assert.equal(app.session.commitPanGesture(token), false); assert.equal(writes(app.sockets[1]).length, 0); assert.equal(app.session.snapshot().control.armed, false);
});
test('partial/reentrant cancellation, selection or reconnect stops remaining pan ordinals without overwriting new context counts', () => {
  for (const mode of ['close', 'level', 'reconnect', 'native']) {
    const app = fixture(), socket = app.connect(), token = app.begin(); app.session.previewPanGesture(token, 0.6);
    socket.hook = message => { if (!message.startsWith('3:::SETD')) return; if (mode === 'close') app.session.closePan(); if (mode === 'level') app.session.selectLevelTarget(level); if (mode === 'reconnect') app.connect(); if (mode === 'native') socket.receive('3:::SETD^i.0.aux.0.pan^0.6'); };
    assert.equal(app.session.commitPanGesture(token), false); assert.equal(writes(socket).length, 1); assert.equal(app.session.snapshot().control.armed, false); assert.equal(app.session.snapshot().control.dispatched, mode === 'reconnect' ? 0 : 1);
    app.move(3000); app.flush(); assert.equal(writes(socket).length, 1);
  }
});
test('throwing second pan send records unknown partial, clears state and never retries/rolls back', () => {
  const app = fixture(), socket = app.connect(), token = app.begin(); app.session.previewPanGesture(token, 0.6); socket.hook = message => { if (message.startsWith('3:::SETD')) socket.throws = true; };
  assert.equal(app.session.commitPanGesture(token), false); const snapshot = app.session.snapshot(); assert.equal(snapshot.phase, 'error'); assert.equal(snapshot.control.authorized, 2); assert.equal(snapshot.control.dispatched, 1); assert.equal(snapshot.observations.size, 0); assert.match(snapshot.detail, /some pan positions may have changed/);
  app.move(3000); app.flush(); assert.equal(socket.attempts, 2);
});
test('reentrant arm/gesture observers cannot retain permission or an old pan token', () => {
  const app = fixture(); app.connect(); app.session.selectPanTarget(target); const off = app.session.subscribe(snapshot => { if (snapshot.control?.armed) app.session.disarmPan(); }); assert.equal(app.session.armPan(), false); off();
  app.session.armPan(); const stop = app.session.subscribe(snapshot => { if (snapshot.control?.gestureActive) app.session.closePan(); }); assert.equal(app.session.beginPanGesture(), null); stop();
});
