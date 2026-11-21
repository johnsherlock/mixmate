import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';

// F09-S11 review: the session classifies "attention" outcomes by state transition
// (a user's active gesture or pending send was stopped), never by wording.
const LINKED = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\n' +
  'SETD^i.0.stereoIndex^-1\nSETD^i.0.aux.0.value^0.35\nSETD^i.0.aux.1.value^0.35\nSETD^i.0.aux.0.pan^0.5\nSETD^i.0.aux.1.pan^0.5\nSETD^f.0.aux.0.value^0.65\nSETD^f.0.aux.1.value^0.65\n' +
  Array.from({ length: 31 }, (_, band) => `SETD^a.0.eq.peak.${band}^0.5\nSETD^a.1.eq.peak.${band}^0.5`).join('\n') + '\nSETD^a.0.eq.bypass^0\nSETD^a.1.eq.bypass^0';
function setup(factory = createAuxControlSession, options = {}) {
  let clock = 0, next = 0; const jobs = new Map(), sockets = [];
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: clock + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval() { return ++next; }, clearInterval() {} };
  class Socket {
    readyState = 0; sent = []; hook = null;
    constructor() { sockets.push(this); }
    send(message) { this.sent.push(message); this.hook?.(message); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
  }
  const session = factory({ WebSocketClass: Socket, timers, now: () => clock, wallNow: () => clock, ...options });
  session.connect('192.168.0.60');
  const [writer, receiver] = sockets;
  if (receiver) receiver.open(); writer.open(); (receiver ?? writer).receive(LINKED);
  const writes = () => writer.sent.filter(message => message.startsWith('3:::SETD'));
  return { session, writer, receiver, writes, jobs,
    advance(ms) { clock += ms; for (const [id, job] of [...jobs].sort((a, b) => a[1].at - b[1].at)) if (job.at <= clock && jobs.has(id)) { jobs.delete(id); job.fn(); } },
    echo(from = 0, round = false) { const lines = writes().slice(from).map(message => { const [, path, raw] = message.split('^'); return `SETD^${path}^${round ? Number(Number(raw).toPrecision(10)) : raw}`; }); if (lines.length) receiver.receive('3:::' + lines.join('\n')); } };
}
const master = { kind: 'master', auxIndex: 0 };
const attention = app => app.session.snapshot().control.attention;

test('cancellations that stopped no user intent never raise attention (plain connect/reconnect topology changes)', () => {
  const app = setup();
  assert.equal(attention(app), '');
  app.receiver.receive('3:::SETS^model^ui24'); // topology receipt with nothing in progress
  assert.match(app.session.snapshot().control.status, /Received topology changed|Select a received control|obsolete/i);
  assert.equal(attention(app), '', 'no gesture or send was active');
  app.session.selectLevelTarget(master); app.session.invalidateLevelContext(); assert.equal(attention(app), '', 'a selection reset stops nothing');
  app.session.disconnect();
});

test('a gesture stopped by a received topology change, a context change or a native edit raises attention until the next gesture', () => {
  for (const [index, stop] of [app => app.receiver.receive('3:::SETD^a.0.stereoIndex^-1'), app => app.session.invalidateLevelContext(), app => app.receiver.receive('3:::SETD^a.0.mix^0.9')].entries()) {
    const app = setup(); app.session.selectLevelTarget(master); const token = app.session.beginLevelGesture();
    app.session.previewLevelGesture(token, 0.41); assert.equal(attention(app), '', 'a running gesture is not an alert');
    stop(app);
    assert.equal(app.session.snapshot().control.gestureActive, false);
    assert.notEqual(attention(app), '', 'the stopped gesture is reported');
    assert.equal(attention(app), app.session.snapshot().control.status);
    // After the topology change the scope is still blocked (metadata conflict), so a selection cannot succeed and the reason stays.
    app.session.selectLevelTarget(master); if (index === 1) assert.equal(attention(app), '', 'a new selection clears it');
    app.session.disconnect();
  }
});

test('a normal release (sent-unverified, desk drops echoes) never raises attention; cancel after live steps does', () => {
  const app = setup(); app.session.selectLevelTarget(master); const token = app.session.beginLevelGesture();
  app.session.previewLevelGesture(token, 0.41); app.session.commitLevelGesture(token, 0.5);
  app.advance(3000);
  assert.equal(attention(app), '', 'routine release outcome stays out of the footer');
  const other = setup(); other.session.selectLevelTarget(master); const again = other.session.beginLevelGesture();
  other.session.previewLevelGesture(again, 0.45); other.session.cancelLevelGesture();
  assert.match(attention(other), /stay applied/); app.session.disconnect(); other.session.disconnect();
});

test('a refused deliberate action says why; disconnect clears attention', () => {
  const app = setup(); app.session.selectLevelTarget(master); const token = app.session.beginLevelGesture();
  app.session.previewLevelGesture(token, 0.41); app.receiver.receive('3:::SETD^a.0.mix^0.9');
  assert.notEqual(attention(app), ''); app.session.disconnect(); assert.equal(attention(app), '');
});
