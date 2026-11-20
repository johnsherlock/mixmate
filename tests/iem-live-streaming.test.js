import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createAuxLevelSession } from '../src/iem/aux-level-session.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { parseIemStateFrame } from '../src/iem/protocol.js';
import { LIVE_STREAM_INTERVAL_MS, OBSERVATION_WINDOW_MS, deskFormat, createControlScope, createPeerControlState, transitionControl } from '../src/iem/control-state-model.js';
import { continuousFaderDB, continuousDBToFader, GROUP_FLOOR_SCALE, GROUP_TOP_SCALE, GROUP_MAX_DB, groupTravel, groupReferenceDelta, groupReferencePosition } from '../src/iem/relative-groups.js';
import { positionToScale } from '../src/iem/fader-scale.js';
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
    echo(from = 0, round = false) { const lines = writes().slice(from).map(message => { const [, path, raw] = message.split('^'); return `SETD^${path}^${round ? Number(Number(raw).toPrecision(10)) : raw}`; }); if (lines.length) receiver.receive('3:::' + lines.join('\n')); } };
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

test('own echoes (exact and 10-significant-digit desk formatted) never cancel; a foreign value stops the stream immediately with no replay', () => {
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

test('full-range group travel: top puts the loudest member at max, bottom the quietest at -inf (F09-S08), one even scale delta', async () => {
  const app = await groups();
  try {
    const anchor = { members: [0.35, 0.65].map(value => ({ scale: positionToScale(value) })) }, travel = groupTravel(anchor);
    assert.equal(travel.referenceScale, positionToScale(0.65)); assert.equal(travel.upper, GROUP_TOP_SCALE - positionToScale(0.65)); assert.equal(travel.lower, GROUP_FLOOR_SCALE - positionToScale(0.35));
    assert.equal(groupReferenceDelta(anchor, 0.65), 0); assert.equal(groupReferenceDelta(anchor, 0), travel.lower); assert.equal(groupReferenceDelta(anchor, 1), travel.upper);
    assert.equal(groupReferencePosition(anchor, travel.upper), 1);
    assert.equal(groupTravel({ members: [{ scale: GROUP_FLOOR_SCALE }, { scale: -10 }] }).lower, 0, 'quietest already at -inf: no downward travel, never forced up');
    assert.equal(groupTravel({ members: [{ scale: GROUP_FLOOR_SCALE }, { scale: -10 }] }).upper, 20, 'it can still rise');
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
    const value = message => parseIemStateFrame(message)[0].value, scale = message => positionToScale(value(message));
    assert.equal(Math.min(...top.map(value)), 0, 'quietest at -inf (position 0)'); assert.ok(top.some(message => value(message) > 0), 'the louder member keeps its on-screen gap');
    const down = top.map((message, index) => scale(message) - scale(app.writes()[index]));
    assert.ok(down.every(delta => Math.abs(delta - down[0]) < 1e-9 && delta < 0));
    app.session.previewLevelGesture(token, 0); app.advance(100); assert.equal(app.writes().length, 8, 'clamped further travel sends nothing');
    app.session.commitLevelGesture(token, 0); app.echo(4);
    const next = app.session.beginLevelGesture(); assert.ok(next, 'a silent member stays a finite anchor for the next gesture');
    assert.equal(app.session.previewLevelGesture(next, 0), app.session.snapshot().control.groupReference, 'no further downward travel');
    app.advance(100); assert.equal(app.writes().length, 8);
    app.session.previewLevelGesture(next, 1); app.advance(100); assert.equal(app.writes().length, 12, 'the group can rise from -inf');
    assert.ok(app.writes().slice(8).every(message => value(message) > 0)); app.session.commitLevelGesture(next, 1);
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

test('P1 regression: per-step reducer work stays bounded after hundreds of live GEQ steps (no retired growth, shared frozen subtrees)', () => {
  const received = new Map([['model', 'ui24'], ['a.0.stereoIndex', 0], ['a.1.stereoIndex', 1], ['a.0.matrix', false], ['a.1.matrix', false], ['a.0.eq.bypass', false], ['a.1.eq.bypass', false]]);
  for (let band = 0; band < 31; band++) for (const aux of [0, 1]) received.set(`a.${aux}.eq.peak.${band}`, 0.5);
  const receipts = new Map([...received.keys()].map(path => [path, 1]));
  let time = 0, receipt = 1, state = createPeerControlState({ scope: createControlScope({ kind: 'geq', received, receipts, target: { auxIndex: 0 }, group: null }), generation: 1, revision: 1, now: { mono: 0, wall: 0 } });
  const step = (type, fields = {}) => { time += 1; state = transitionControl(state, { type, now: { mono: time, wall: time }, ...fields }); };
  step('arm'); step('begin'); const token = state.gesture.token;
  const original = Object.freeze; let freezes = 0;
  const liveStep = n => {
    step('preview', { token, value: Array(31).fill(n % 2 ? 0.6 : 0.4) }); step('stream', { token });
    const op = state.operation; assert.equal(op.expected.length, 62);
    for (let ordinal = 0; ordinal < 62; ordinal++) { step('authorize', { id: op.id, ordinal }); step('returned', { id: op.id, ordinal }); }
    for (const item of op.expected) step('receive', { generation: 1, path: item.path, value: Number(item.value.toFixed(10)), receipt: ++receipt });
    time += 200;
  };
  const measure = n => { freezes = 0; Object.freeze = value => { freezes++; return original(value); }; try { liveStep(n); } finally { Object.freeze = original; } return freezes; };
  const first = measure(0);
  for (let n = 1; n < 400; n++) liveStep(n);
  const late = measure(400);
  assert.ok(state.gesture, 'own rounded echoes never cancelled the gesture');
  assert.equal(state.retired.length, 0, 'settled superseded live steps are not retained');
  assert.ok(late <= first * 1.2 + 50, `work per step stays bounded: first ${first}, after 400 steps ${late}`);
  assert.ok(late < 12000, `small absolute work per linked GEQ step: ${late}`);
  assert.equal(state.echoes.length, 0, 'every own echo consumed');
});

test('P2: SETD budget stretches the step gap by path count; writer backpressure defers streamed steps; release still sends', () => {
  const app = setup(); app.session.selectEqTarget(0); const token = app.session.beginEqGesture();
  const draw = shift => requestedDrawSamples(Array(31).fill(shift));
  app.session.previewEqGesture(token, draw(1)); assert.equal(app.writes().length, 62, 'leading 62-path step');
  app.session.previewEqGesture(token, draw(2)); app.advance(240); assert.equal(app.writes().length, 62, '62 paths at 250 SETD/s wait 248 ms, not 120 ms');
  app.advance(8); assert.equal(app.writes().length, 124);
  app.writer.bufferedAmount = 10000; app.session.previewEqGesture(token, draw(3)); app.advance(1000); assert.equal(app.writes().length, 124, 'buffered writer defers streamed steps');
  app.writer.bufferedAmount = 0; app.advance(248); assert.equal(app.writes().length, 186, 'latest preview sent once the buffer drains');
  app.writer.bufferedAmount = 10000; app.session.previewEqGesture(token, draw(4));
  assert.equal(app.session.commitEqGesture(token), true); assert.equal(app.writes().length, 248, 'release sends the final value regardless');
  app.session.disconnect();
});

test('P3: a group cannot re-anchor while any own live echo is outstanding (step-1 echoes alone are not enough)', async () => {
  const app = await groups(); app.session.selectGroupTarget('band', 0);
  try {
    const token = app.session.beginLevelGesture(), ref = delta => continuousDBToFader(continuousFaderDB(0.65) + delta);
    app.session.previewLevelGesture(token, ref(1)); app.advance(50); app.session.previewLevelGesture(token, ref(2));
    assert.equal(app.writes().length, 8); app.session.commitLevelGesture(token, 0);
    assert.equal(app.session.beginLevelGesture(), null, 'no echoes yet');
    app.receiver.receive('3:::' + app.writes().slice(0, 4).map(message => message.slice(4)).join('\n'));
    assert.equal(app.session.beginLevelGesture(), null, 'step-2 echoes still outstanding (basis cutpoints alone would pass)');
    assert.equal(app.session.canEditLevelTarget({ kind: 'group', groupId: 'band', auxIndex: 0 }), false);
    app.echo(4); assert.ok(app.session.beginLevelGesture(), 'all own echoes received: re-anchors without Enable');
  } finally { app.session.disconnect(); await app.repository.close(); }
});

test('P3: commit reports the final release dispatch outcome; cancel after live steps says streamed values stay applied', () => {
  const app = setup(); app.session.selectLevelTarget(master); let token = app.session.beginLevelGesture();
  app.session.previewLevelGesture(token, 0.41); app.writer.send = () => { throw Error('socket'); };
  assert.equal(app.session.commitLevelGesture(token, 0.5), false, 'failed final write is not reported as success');
  const other = setup(); other.session.selectLevelTarget(master); token = other.session.beginLevelGesture();
  other.session.previewLevelGesture(token, 0.45); other.session.cancelLevelGesture();
  assert.match(other.session.snapshot().control.status, /already sent live while dragging stay applied; no rollback/);
  assert.equal(other.writes().length, 2); other.session.disconnect();
});

test('live 2026-11-19 regression: low-magnitude own echoes use the desk 10-significant-digit format and never self-cancel; sends always survive that format', () => {
  // Observed: 0.031999458946648573 echoed as 0.03199945895 (10 significant digits, not 10 decimals).
  assert.equal(deskFormat(0.031999458946648573), 0.03199945895);
  assert.equal(deskFormat(0.0012589254117941673), 0.001258925412);
  assert.equal(deskFormat(0), 0);
  const app = setup(); app.session.selectLevelTarget(master); const token = app.session.beginLevelGesture();
  const low = [0.031999458946648573, 0.0123456789012345, 0.0012589254117941673];
  for (const value of low) {
    const from = app.writes().length;
    app.session.previewLevelGesture(token, value); app.advance(60);
    assert.ok(app.writes().length > from, `streams ${value}`);
    app.echo(from, true);
    assert.equal(app.session.snapshot().control.gestureActive, true, `own desk-formatted echo of ${value} must not cancel`);
  }
  // A change that the desk format cannot represent is not sent (the desk would not echo it).
  const before = app.writes().length;
  app.session.previewLevelGesture(token, 0.0012589254117941673 + 1e-16); app.advance(60);
  assert.equal(app.writes().length, before, 'sub-format change not sent');
  // A genuinely foreign low value still cancels.
  app.receiver.receive('3:::SETD^a.0.mix^0.0222');
  assert.equal(app.session.snapshot().control.gestureActive, false);
  app.session.disconnect();
});
