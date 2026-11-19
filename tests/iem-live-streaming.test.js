import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createAuxLevelSession } from '../src/iem/aux-level-session.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { parseIemStateFrame } from '../src/iem/protocol.js';
import { LIVE_STREAM_INTERVAL_MS, OBSERVATION_WINDOW_MS, createControlScope, createPeerControlState, transitionControl } from '../src/iem/control-state-model.js';
import { continuousFaderDB, continuousDBToFader, GROUP_FLOOR_DB, GROUP_MAX_DB, groupTravel, groupReferenceDelta, groupReferencePosition } from '../src/iem/relative-groups.js';
import { auxEqPositionToDb } from '../src/iem/aux-eq-protocol.js';
import { requestedDrawSamples } from '../src/iem/aux-eq-curve.js';
import { SettingsRepository, emptySettings } from '../src/settings.js';

// F09-S05 live throttled writes. Fake transports and fake timers only.
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
    echo(from = 0, round = false) { const lines = writes().slice(from).map(message => { const [, path, raw] = message.split('^'); return `SETD^${path}^${round ? Number(Number(raw).toFixed(10)) : raw}`; }); if (lines.length) receiver.receive('3:::' + lines.join('\n')); } };
}
const master = { kind: 'master', auxIndex: 0 };
const values = list => list.map(message => Number(message.split('^')[2]));

test('throttle: leading step immediately, then at most one latest-value step per 50 ms; release sends the final exact value only if different', () => {
  const app = setup(); app.session.selectLevelTarget(master); const token = app.session.beginLevelGesture();
  assert.equal(LIVE_STREAM_INTERVAL_MS.level, 50);
  app.session.previewLevelGesture(token, 0.41); assert.deepEqual(values(app.writes()), [0.41, 0.41], 'leading step to both linked sides');
  app.session.previewLevelGesture(token, 0.42); app.session.previewLevelGesture(token, 0.43); app.session.previewLevelGesture(token, 0.44);
  assert.equal(app.writes().length, 2, 'intermediate moves coalesce');
  app.advance(49); assert.equal(app.writes().length, 2);
  app.advance(1); assert.deepEqual(values(app.writes()), [0.41, 0.41, 0.44, 0.44], 'latest value wins; no stale queue');
  app.advance(500); assert.equal(app.writes().length, 4, 'no step without a new preview');
  app.session.previewLevelGesture(token, 0.45); assert.equal(app.writes().length, 6, 'interval elapsed: immediate step');
  app.session.previewLevelGesture(token, 0.46);
  assert.equal(app.session.commitLevelGesture(token, 0.47), true);
  assert.deepEqual(values(app.writes()).slice(6), [0.47, 0.47], 'release cancels the pending step and sends the final exact value');
  app.advance(1000); assert.equal(app.writes().length, 8);
  const again = app.session.beginLevelGesture(); app.session.previewLevelGesture(again, 0.47); assert.equal(app.writes().length, 8, 'unchanged value is not sent (desk would not echo it)');
  assert.equal(app.session.commitLevelGesture(again, 0.47), false); assert.equal(app.writes().length, 8);
  app.session.disconnect();
});

test('own echoes (exact and 10-decimal rounded) never cancel; a foreign value stops the stream immediately with no replay', () => {
  for (const round of [false, true]) {
    const app = setup(); app.session.selectLevelTarget(master); const token = app.session.beginLevelGesture();
    app.session.previewLevelGesture(token, 0.41123456789012345); app.session.previewLevelGesture(token, 0.52987654321098765);
    app.echo(0, round); // first step echoes while the second is still coalesced
    assert.equal(app.session.snapshot().control.gestureActive, true, `own echo keeps the gesture (rounded: ${round})`);
    assert.equal(app.session.snapshot().observations.get('a.0.mix'), round ? 0.4112345679 : 0.41123456789012345, 'actual follows the raw echo');
    app.advance(50); assert.equal(app.writes().length, 4);
    app.echo(2, round); assert.equal(app.session.snapshot().control.gestureActive, true);
    assert.equal(app.session.commitLevelGesture(token, 0.52987654321098765), true); assert.equal(app.writes().length, 4);
    assert.equal(app.session.snapshot().control.outcome, 'observed-match');
    app.session.disconnect();
  }
  const app = setup(); app.session.selectLevelTarget(master); const token = app.session.beginLevelGesture();
  app.session.previewLevelGesture(token, 0.41); app.session.previewLevelGesture(token, 0.6);
  app.receiver.receive('3:::SETD^a.0.mix^0.3'); // native edit, not a value this owner sent
  assert.equal(app.session.snapshot().control.gestureActive, false); assert.match(app.session.snapshot().control.status, /changed|differs/);
  app.advance(1000); assert.equal(app.writes().length, 2, 'the coalesced step never fires');
  assert.equal(app.session.commitLevelGesture(token, 0.6), false); assert.equal(app.writes().length, 2, 'no rollback or replay');
  const next = app.session.beginLevelGesture(); assert.equal(next, null, 'native unequal linked actual stays read-only');
  app.receiver.receive('3:::SETD^a.1.mix^0.3'); assert.ok(app.session.beginLevelGesture(), 'next deliberate gesture uses current actual');
  app.session.disconnect();
});

test('an old own value already superseded by a later echo, or older than the observation window, is classified native', () => {
  const app = setup(); app.session.selectLevelTarget(master); let token = app.session.beginLevelGesture();
  app.session.previewLevelGesture(token, 0.41); app.advance(50); app.session.previewLevelGesture(token, 0.42);
  app.echo(0); assert.equal(app.session.snapshot().control.gestureActive, true);
  app.receiver.receive('3:::SETD^a.0.mix^0.41'); assert.equal(app.session.snapshot().control.gestureActive, false, 'consumed echo cannot be replayed to hide a native edit');
  app.receiver.receive('3:::SETD^a.0.mix^0.42'); app.session.selectLevelTarget(master); token = app.session.beginLevelGesture();
  app.session.previewLevelGesture(token, 0.5); app.advance(50); app.session.previewLevelGesture(token, 0.55); app.advance(OBSERVATION_WINDOW_MS);
  app.receiver.receive('3:::SETD^a.0.mix^0.5'); assert.equal(app.session.snapshot().control.gestureActive, false, 'expired own value no longer counts');
  app.session.disconnect();
});

test('incoming receipts, selection and begin alone never write; only an owned preview schedules steps', () => {
  const app = setup(); app.session.selectLevelTarget(master); app.receiver.receive('3:::SETD^a.0.mix^0.4\nSETD^a.1.mix^0.4');
  const token = app.session.beginLevelGesture(); app.advance(500); app.receiver.receive('3:::SETS^a.0.name^Mix'); app.advance(500);
  assert.equal(app.writes().length, 0);
  assert.equal(app.session.previewLevelGesture({}, 0.6), null); assert.equal(app.writes().length, 0);
  app.session.cancelLevelGesture(); assert.equal(app.session.previewLevelGesture(token, 0.6), null); app.advance(500); assert.equal(app.writes().length, 0);
  app.session.disconnect();
});

test('mid-stream socket failure stops immediately, keeps diagnostics and never retries or replays', () => {
  const app = setup(); app.session.selectLevelTarget(master); const token = app.session.beginLevelGesture();
  app.session.previewLevelGesture(token, 0.41); app.session.previewLevelGesture(token, 0.6);
  app.receiver.onclose(); assert.equal(app.session.snapshot().phase, 'closed'); assert.equal(app.session.snapshot().observations.size, 0);
  app.advance(1000); assert.equal(app.writes().length, 2, 'last applied step may remain; nothing more sent');
  assert.equal(app.session.commitLevelGesture(token, 0.6), false); assert.equal(app.writes().length, 2);
  const thrower = setup(); thrower.session.selectLevelTarget(master); const t = thrower.session.beginLevelGesture();
  thrower.session.previewLevelGesture(t, 0.41); thrower.writer.hook = () => { thrower.writer.send = () => { throw Error('socket'); }; };
  thrower.advance(50); thrower.session.previewLevelGesture(t, 0.5);
  assert.equal(thrower.session.snapshot().phase, 'error'); assert.match(thrower.session.snapshot().detail, /may have changed/);
  thrower.advance(1000); assert.equal(thrower.writes().length, 3);
});

test('pan streams within its guard (normalized, both linked outputs); EQ streams sparse changed bands at a lower rate; reset is a one-shot', () => {
  const app = setup(); app.session.selectPanTarget({ sourceId: 'i.0', auxIndex: 0 }); let token = app.session.beginPanGesture();
  app.session.previewPanGesture(token, 0.61234); app.session.previewPanGesture(token, 0.7); app.session.previewPanGesture(token, 0.7004);
  assert.deepEqual(app.writes(), ['3:::SETD^i.0.aux.0.pan^0.612', '3:::SETD^i.0.aux.1.pan^0.612']);
  app.advance(50); assert.deepEqual(app.writes().slice(2), ['3:::SETD^i.0.aux.0.pan^0.7', '3:::SETD^i.0.aux.1.pan^0.7']);
  app.echo(); assert.equal(app.session.commitPanGesture(token), true); assert.equal(app.writes().length, 4);
  app.session.closePan();
  assert.equal(LIVE_STREAM_INTERVAL_MS.geq, 120);
  app.session.selectEqTarget(0); token = app.session.beginEqGesture();
  const draw = change => { const bands = app.session.snapshot().control.eqCoordinate.map(auxEqPositionToDb); change(bands); return requestedDrawSamples(bands); };
  app.session.previewEqGesture(token, draw(bands => { bands[4] = 3; }));
  assert.deepEqual(app.writes().slice(4).map(message => message.split('^')[1]), ['a.0.eq.peak.4', 'a.1.eq.peak.4']);
  app.session.previewEqGesture(token, draw(bands => { bands[4] = 3; bands[5] = 2; }));
  app.advance(60); assert.equal(app.writes().length, 6, 'EQ waits for its longer interval');
  app.advance(60); assert.deepEqual(app.writes().slice(6).map(message => message.split('^')[1]), ['a.0.eq.peak.5', 'a.1.eq.peak.5'], 'sparse versus the last step actually sent');
  app.echo(4, true); assert.equal(app.session.snapshot().control.gestureActive, true, 'rounded own GEQ echoes keep the gesture');
  assert.equal(app.session.commitEqGesture(token), true); assert.equal(app.writes().length, 8);
  const before = app.writes().length; assert.equal(app.session.resetEqBands(), true);
  assert.equal(app.writes().length - before, 4, 'reset sends only non-flat bands once'); app.advance(1000); assert.equal(app.writes().length - before, 4);
  app.session.disconnect();
});

async function groups(members = ['i.0', 'f.0']) {
  const repository = new SettingsRepository({ indexedDB: undefined }), settings = emptySettings();
  settings.profiles = [{ id: 'rig', name: 'rig', address: '192.168.0.60', groups: [{ id: 'band', name: 'Band', members }], navigation: { mixId: null, view: 'groups', expandedGroupId: null } }];
  await repository.replace(settings);
  const app = setup(createAuxControlSession, { settingsRepository: repository }); app.session.bindGroupProfile('rig');
  return { ...app, repository };
}
const db = message => continuousFaderDB(parseIemStateFrame(message)[0].value);

test('full-range group travel: top puts the loudest member at max, bottom the quietest at the floor, one even delta; never position 0', async () => {
  const app = await groups();
  try {
    const anchor = { members: [0.35, 0.65].map(value => ({ db: continuousFaderDB(value) })) }, travel = groupTravel(anchor);
    assert.equal(travel.referenceDb, continuousFaderDB(0.65)); assert.equal(travel.upper, GROUP_MAX_DB - continuousFaderDB(0.65)); assert.equal(travel.lower, GROUP_FLOOR_DB - continuousFaderDB(0.35));
    assert.equal(groupReferenceDelta(anchor, 0.65), 0); assert.equal(groupReferenceDelta(anchor, 0), travel.lower); assert.equal(groupReferenceDelta(anchor, 1), travel.upper);
    assert.equal(groupReferencePosition(anchor, travel.upper), 1);
    assert.equal(groupTravel({ members: [{ db: -150 }, { db: -10 }] }).lower, 0, 'quietest already below the floor: no downward travel, never forced up');
    assert.equal(app.session.selectGroupTarget('band', 0), true);
    let token = app.session.beginLevelGesture(); assert.equal(app.session.snapshot().control.groupReference, groupReferencePosition(anchor, 0), 'cap starts at the loudest member');
    assert.ok(app.session.previewLevelGesture(token, 1) > 1 - 1e-9);
    const control = app.session.snapshot().control;
    assert.equal(control.groupRequested.length, 4, 'live member preview for both linked sides'); assert.ok(control.groupRequested.every(item => item.value > 0 && item.value <= 1));
    let top = app.writes(); assert.equal(top.length, 4);
    const deltas = top.map((message, index) => db(message) - continuousFaderDB(index < 2 ? 0.35 : 0.65));
    assert.ok(deltas.every(delta => Math.abs(delta - deltas[0]) < 1e-9), 'even delta'); assert.ok(Math.abs(Math.max(...top.map(db)) - GROUP_MAX_DB) < 1e-9, 'loudest at max');
    app.session.commitLevelGesture(token, 1); app.echo();
    token = app.session.beginLevelGesture(); assert.ok(token, 'echoed basis re-anchors without Enable');
    app.session.previewLevelGesture(token, 0); top = app.writes().slice(4);
    assert.ok(Math.abs(Math.min(...top.map(db)) - GROUP_FLOOR_DB) < 1e-9, 'quietest at the floor'); assert.ok(top.every(message => parseIemStateFrame(message)[0].value > 0), 'never silent');
    const down = top.map((message, index) => db(message) - db(app.writes()[index]));
    assert.ok(down.every(delta => Math.abs(delta - down[0]) < 1e-9 && delta < 0));
    app.session.previewLevelGesture(token, 0); app.advance(100); assert.equal(app.writes().length, 8, 'clamped further travel sends nothing');
    app.session.commitLevelGesture(token, 0); app.echo(4);
    assert.ok(app.session.beginLevelGesture(), 'floor values stay finite anchors for the next gesture');
  } finally { app.session.disconnect(); await app.repository.close(); }
});

test('group streaming keeps its frozen anchor while own echoes land; members preview requested values; a native member edit stops it', async () => {
  const app = await groups(); app.session.selectGroupTarget('band', 0);
  try {
    const token = app.session.beginLevelGesture(), ref = delta => continuousDBToFader(continuousFaderDB(0.65) + delta);
    app.session.previewLevelGesture(token, ref(2)); app.echo(); app.advance(50);
    app.session.previewLevelGesture(token, ref(4)); assert.equal(app.writes().length, 8);
    const second = app.writes().slice(4).map((message, index) => db(message) - continuousFaderDB(index < 2 ? 0.35 : 0.65));
    assert.ok(second.every(delta => Math.abs(delta - 4) < 1e-9), 'deltas stay relative to the gesture anchor, not the echoes');
    assert.ok(app.session.snapshot().control.eligible, 'own echoes keep the active group editable');
    assert.ok(Math.abs(app.session.snapshot().control.previewDelta - 4) < 1e-9);
    app.receiver.receive('3:::SETD^f.0.aux.0.value^0.2');
    assert.equal(app.session.snapshot().control.gestureActive, false); assert.equal(app.session.snapshot().control.groupRequested, null);
    app.advance(500); assert.equal(app.writes().length, 8);
  } finally { app.session.disconnect(); await app.repository.close(); }
});

test('read-only and level-only factories keep their literal capabilities; level-only streams only level forms', () => {
  const read = setup(createReadOnlySession); assert.deepEqual(Object.keys(read.session).sort(), ['connect', 'disconnect', 'snapshot', 'subscribe']);
  assert.ok(read.writer.sent.every(message => ['3:::INIT', '3:::ALIVE', '2::'].includes(message)));
  const level = setup(createAuxLevelSession); assert.equal(level.session.selectPanTarget, undefined); assert.equal(level.session.selectEqTarget, undefined);
  level.session.selectLevelTarget(master); const token = level.session.beginLevelGesture(); level.session.previewLevelGesture(token, 0.5); level.advance(50); level.session.previewLevelGesture(token, 0.55);
  assert.ok(level.writes().every(message => /^3:::SETD\^a\.[01]\.mix\^/.test(message))); assert.equal(level.writes().length, 4);
  level.session.disconnect();
});

test('pure reducer: stream steps keep the gesture, are sparse, and own-echo matching is bounded and consumed', () => {
  const received = new Map([['model', 'ui24'], ['a.0.stereoIndex', -1], ['a.0.matrix', false], ['a.0.mix', 0.4]]), receipts = new Map([...received.keys()].map(path => [path, 1]));
  let time = 0, state = createPeerControlState({ scope: createControlScope({ kind: 'level', received, receipts, target: master, group: null }), generation: 1, revision: 1, now: { mono: 0, wall: 0 } });
  const step = (type, fields = {}) => { time++; state = transitionControl(state, { type, now: { mono: time, wall: time }, ...fields }); };
  step('arm'); step('begin'); const token = state.gesture.token;
  assert.throws(() => step('stream', { token }), 'no cached preview: nothing to stream');
  assert.throws(() => step('stream', { token: {} }));
  step('preview', { token, value: 0.5 }); step('stream', { token }); assert.equal(state.operation.live, true); assert.ok(state.gesture);
  step('authorize', { id: state.operation.id, ordinal: 0 }); step('returned', { id: state.operation.id, ordinal: 0 });
  step('stream', { token }); assert.equal(state.operation.status, 'pending', 'unchanged preview creates no step');
  step('preview', { token, value: 0.6 }); step('stream', { token }); const id = state.operation.id; step('authorize', { id, ordinal: 0 }); step('returned', { id, ordinal: 0 });
  step('receive', { generation: 1, path: 'a.0.mix', value: 0.5, receipt: 2 }); assert.ok(state.gesture, 'older own echo');
  step('receive', { generation: 1, path: 'a.0.mix', value: 0.6, receipt: 3 }); assert.equal(state.status, 'observed-match'); assert.equal(state.echoes.length, 0, 'consumed');
  step('commit', { token }); assert.equal(state.gesture, null); assert.equal(state.status, 'observed-match', 'unchanged streamed release keeps the last step outcome');
});
