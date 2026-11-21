import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createAuxLevelSession } from '../src/iem/aux-level-session.js';
import { encodeAuxEqFilterCommand, auxEqFilterPath, parseAuxEqStateFrame, parseAuxProcessingFrame, resolveAuxEqFilters } from '../src/iem/aux-eq-protocol.js';
import { AUX_EQ_FILTER_DEFAULT, AUX_EQ_FILTER_GAP, AUX_EQ_FILTER_MAX, AUX_EQ_FILTER_MIN, auxEqFilterHz, auxEqFilterPosition, auxEqFilterRolloffDb, mapRequestedAuxEqFilter } from '../src/iem/aux-eq-filter.js';
import { mountEqControls, projectEqReadback } from '../src/iem/eq-controls.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { updateBusy } from '../src/iem/updates.js';
import { domFixture, Node } from './helpers/fake-dom.js';

// Fake transports only. No real mixer, browser or network is used.
const bandLines = aux => Array.from({ length: 31 }, (_, band) => `SETD^a.${aux}.eq.peak.${band}^0.5`);
// AUX 1/2 (a.0/a.1) are a verified reciprocal pair; AUX 3 (a.2) is mono.
function baseFrame({ filters = [[0, 1], [0, 1], [0, 1]], omit = [] } = {}) {
  const lines = ['SETS^model^ui24', 'SETD^a.0.matrix^0', 'SETD^a.1.matrix^0', 'SETD^a.2.matrix^0', 'SETD^a.0.stereoIndex^0', 'SETD^a.1.stereoIndex^1', 'SETD^a.2.stereoIndex^-1',
    'SETD^a.0.mix^0.4', 'SETD^a.1.mix^0.4', 'SETD^a.2.mix^0.4', 'SETD^a.0.eq.bypass^0', 'SETD^a.1.eq.bypass^0', 'SETD^a.2.eq.bypass^0',
    ...filters.flatMap(([hpf, lpf], aux) => [`SETD^a.${aux}.eq.hpf^${hpf}`, `SETD^a.${aux}.eq.lpf^${lpf}`]), ...bandLines(0), ...bandLines(1), ...bandLines(2)];
  return '3:::' + lines.filter(line => !omit.some(path => line.startsWith(`SETD^${path}^`))).join('\n');
}
const FILTER_WRITE = /^3:::SETD\^a\.[0-9]\.eq\.(?:hpf|lpf)\^[0-9.e-]+$/;
function fixture(options = {}, factory = createAuxControlSession) {
  const sockets = [], jobs = new Map(); let time = 0, next = 0;
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval(fn) { const id = ++next; jobs.set(id, { fn, at: Infinity }); return id; }, clearInterval(id) { jobs.delete(id); } };
  class Socket {
    readyState = 0; sent = []; bufferedAmount = 0;
    constructor() { sockets.push(this); }
    send(message) { this.sent.push(message); }
    receive(data) { this.onmessage?.({ data }); }
    close() { this.readyState = 3; }
  }
  const session = factory({ WebSocketClass: Socket, timers, now: () => time, wallNow: () => time });
  session.connect('192.168.0.60');
  for (const socket of sockets) { socket.readyState = 1; socket.onopen?.(); }
  const [writer, receiver] = sockets;
  receiver.receive(baseFrame(options));
  // Fake desk: only CHANGED values echo, to 10 significant digits, to the companion only.
  const desk = new Map(baseFrame(options).slice(4).split('\n').map(line => /^SETD\^(a\.\d\.eq\.[a-z.0-9]+)\^(.+)$/.exec(line)).filter(Boolean).map(m => [m[1], Number(m[2])]));
  let echoed = 0;
  const writes = () => writer.sent.filter(message => message.startsWith('3:::SETD'));
  return { session, sockets, writer, receiver, writes, desk, advance(ms) { time += ms; for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); job.fn(); } },
    deskEcho() {
      const all = writes(), lines = [];
      for (const message of all.slice(echoed)) { const [, path, raw] = message.split('^'), value = Number(raw); if (desk.get(path) !== value) { desk.set(path, value); lines.push(`SETD^${path}^${Number(value.toPrecision(10))}`); } }
      echoed = all.length; if (lines.length) receiver.receive('3:::' + lines.join('\n')); return lines.length;
    } };
}
const control = app => app.session.snapshot().control;
const hpf = (filter, value, enabled = true) => ({ filter, enabled, value });
const pos = hz => auxEqFilterPosition(hz);

test('exact filter serialization: only a.<0..9>.eq.hpf / eq.lpf with a finite number from 0 to 1', () => {
  assert.equal(encodeAuxEqFilterCommand({ auxIndex: 8, filter: 'hpf', value: 0 }), '3:::SETD^a.8.eq.hpf^0');
  assert.equal(encodeAuxEqFilterCommand({ auxIndex: 9, filter: 'lpf', value: 1 }), '3:::SETD^a.9.eq.lpf^1');
  assert.equal(encodeAuxEqFilterCommand({ auxIndex: 0, filter: 'hpf', value: 0.2 }), '3:::SETD^a.0.eq.hpf^0.2');
  assert.equal(auxEqFilterPath({ auxIndex: 3, filter: 'lpf' }), 'a.3.eq.lpf');
  for (const value of [-0.0001, 1.0001, NaN, Infinity, -Infinity, '0.5', null, undefined, 1n]) assert.throws(() => encodeAuxEqFilterCommand({ auxIndex: 0, filter: 'hpf', value }));
  for (const target of [{ auxIndex: 10, filter: 'hpf' }, { auxIndex: -1, filter: 'hpf' }, { auxIndex: 1.5, filter: 'hpf' }, { auxIndex: '1', filter: 'hpf' }, { auxIndex: 0, filter: 'slope' }, { auxIndex: 0, filter: 'hpf.freq' },
    { auxIndex: 0, filter: 'bypass' }, { auxIndex: 0, filter: 'm.eq.hpf.l' }, { auxIndex: 0, filter: 'hpf\nSETD^a.0.mix^1' }, { auxIndex: 0, filter: 'hpf', path: 'i.0.mix' }, { auxIndex: 0 }, { filter: 'hpf' }, { auxIndex: 0, filter: 'hpf', [Symbol()]: 1 }])
    assert.throws(() => encodeAuxEqFilterCommand({ ...target, value: 0.5 }), JSON.stringify(target));
});

test('receive parser admits hpf/lpf positions only (bounded, numeric 0..1); slopes, main-mix and input forms are not state', () => {
  assert.deepEqual(parseAuxEqStateFrame('3:::SETD^a.0.eq.hpf^0\nSETD^a.9.eq.lpf^0.123456789012345').map(x => [x.path, x.field, x.filter, x.value]), [['a.0.eq.hpf', 'filter', 'hpf', 0], ['a.9.eq.lpf', 'filter', 'lpf', 0.123456789012345]]);
  for (const path of ['a.0.eq.hpf.freq', 'a.0.eq.hpf.slope', 'm.eq.hpf.l', 'm.eq.lpf.r', 'i.0.eq.hpf', 'a.10.eq.hpf', 'a.01.eq.lpf', 'a.0.eq.hpf.']) assert.deepEqual(parseAuxEqStateFrame(`3:::SETD^${path}^0.5`), [], path);
  for (const raw of ['', 'NaN', 'Infinity', '-0.1', '1.1', 'false', '0.5^1', ' '.repeat(65)]) assert.deepEqual(parseAuxEqStateFrame(`3:::SETD^a.0.eq.hpf^${raw}`), [], raw);
  assert.deepEqual(parseAuxEqStateFrame('3:::SETS^a.0.eq.hpf^0.5'), []);
  // The opaque processing detector no longer reports the now-modelled filter positions, but still reports slopes.
  assert.deepEqual(parseAuxProcessingFrame('3:::SETD^a.0.eq.hpf^0.2\nSETD^a.0.eq.lpf^0.9\nSETD^a.0.eq.hpf.slope^1\nSETD^m.eq.hpf.l^0.3').map(x => x.path), ['a.0.eq.hpf.slope']);
  const topology = { outputs: [{ auxIndex: 0 }, { auxIndex: 1 }] };
  const received = new Map([['a.0.eq.hpf', 0], ['a.0.eq.lpf', 1], ['a.1.eq.hpf', 0], ['a.1.eq.lpf', 1]]);
  assert.equal(resolveAuxEqFilters(received, topology).status, 'ok'); assert.equal(resolveAuxEqFilters(received, topology).members.length, 4);
  received.set('a.1.eq.lpf', 0.9); assert.equal(resolveAuxEqFilters(received, topology).status, 'unequal');
  received.delete('a.1.eq.lpf'); assert.equal(resolveAuxEqFilters(received, topology).status, 'missing');
});

test('requested position rules: exact off, defaults, strict clamp inside (0,1), hpf below lpf by a gap, no room is a rejection', () => {
  assert.equal(auxEqFilterHz(AUX_EQ_FILTER_DEFAULT.hpf), 35); assert.equal(auxEqFilterHz(AUX_EQ_FILTER_DEFAULT.lpf), 16000);
  assert.equal(auxEqFilterHz(0), 20); assert.equal(auxEqFilterHz(1), 20000); assert.equal(auxEqFilterHz(0.5), Math.round(20 * Math.sqrt(1000)));
  const both = { hpf: 0, lpf: 1 };
  assert.deepEqual({ ...mapRequestedAuxEqFilter(hpf('hpf', 0.7, false), both) }, { filter: 'hpf', enabled: false, value: 0 });
  assert.deepEqual({ ...mapRequestedAuxEqFilter(hpf('lpf', 0.2, false), both) }, { filter: 'lpf', enabled: false, value: 1 });
  assert.equal(mapRequestedAuxEqFilter(hpf('hpf', 0), both).value, AUX_EQ_FILTER_MIN, 'a drag to 0 never turns hpf off');
  assert.equal(mapRequestedAuxEqFilter(hpf('lpf', 1), both).value, AUX_EQ_FILTER_MAX, 'a drag to 1 never turns lpf off');
  assert.equal(mapRequestedAuxEqFilter(hpf('hpf', 1), both).value, AUX_EQ_FILTER_MAX); assert.equal(mapRequestedAuxEqFilter(hpf('lpf', 0), both).value, AUX_EQ_FILTER_MIN);
  assert.equal(mapRequestedAuxEqFilter(hpf('hpf', 0.5), both).value, 0.5);
  assert.ok(Math.abs(mapRequestedAuxEqFilter(hpf('hpf', 0.9), { hpf: 0.2, lpf: 0.6 }).value - (0.6 - AUX_EQ_FILTER_GAP)) < 1e-12, 'hpf stays a gap below an enabled lpf');
  assert.ok(Math.abs(mapRequestedAuxEqFilter(hpf('lpf', 0.1), { hpf: 0.2, lpf: 0.6 }).value - (0.2 + AUX_EQ_FILTER_GAP)) < 1e-12, 'lpf stays a gap above an enabled hpf');
  assert.equal(mapRequestedAuxEqFilter(hpf('hpf', 0.9), { hpf: 0.2, lpf: 1 }).value, 0.9, 'an off lpf imposes no gap');
  assert.throws(() => mapRequestedAuxEqFilter(hpf('lpf', 0.99), { hpf: 0.95, lpf: 1 }), /No room/);
  assert.throws(() => mapRequestedAuxEqFilter(hpf('hpf', 0.01), { hpf: 0, lpf: 0.05 }), /No room/);
  for (const bad of [hpf('slope', 0.5), hpf('hpf', NaN), hpf('hpf', 1.5), hpf('hpf', '0.5'), { filter: 'hpf', enabled: 'yes', value: 0.5 }, { filter: 'hpf', enabled: true }, { ...hpf('hpf', 0.5), path: 'a.0.eq.hpf' }]) assert.throws(() => mapRequestedAuxEqFilter(bad, both), JSON.stringify(bad));
  assert.equal(auxEqFilterRolloffDb(0, 1, 20), 0, 'both off: no roll-off'); assert.equal(auxEqFilterRolloffDb(AUX_EQ_FILTER_DEFAULT.hpf, 1, 17.5 * 2), 0, 'at the corner');
  assert.ok(Math.abs(auxEqFilterRolloffDb(AUX_EQ_FILTER_DEFAULT.hpf, 1, 17.5) - -12) < 1e-9, 'one octave below the corner is -12 dB');
  assert.ok(Math.abs(auxEqFilterRolloffDb(0, AUX_EQ_FILTER_DEFAULT.lpf, 32000) - -12) < 1e-9);
});

test('mono output: one filter path; turning on writes the Demo default, off writes exactly 0/1; no bands are written', () => {
  const app = fixture(); app.session.selectEqTarget(2);
  assert.equal(app.session.setEqFilter(hpf('hpf', AUX_EQ_FILTER_DEFAULT.hpf)), true);
  assert.deepEqual(app.writes(), [`3:::SETD^a.2.eq.hpf^${AUX_EQ_FILTER_DEFAULT.hpf}`]);
  assert.equal(control(app).outcome, 'pending'); assert.equal(app.deskEcho(), 1); assert.equal(app.session.snapshot().eq.get('a.2.eq.hpf'), Number(AUX_EQ_FILTER_DEFAULT.hpf.toPrecision(10)));
  assert.equal(app.session.setEqFilter(hpf('lpf', AUX_EQ_FILTER_DEFAULT.lpf)), true);
  assert.deepEqual(app.writes().slice(1), [`3:::SETD^a.2.eq.lpf^${AUX_EQ_FILTER_DEFAULT.lpf}`]); app.deskEcho();
  app.advance(300); assert.equal(app.session.setEqFilter(hpf('hpf', 0.5, false)), true); assert.equal(app.writes().at(-1), '3:::SETD^a.2.eq.hpf^0');
  assert.equal(app.session.setEqFilter(hpf('lpf', 0.5, false)), true); assert.equal(app.writes().at(-1), '3:::SETD^a.2.eq.lpf^1');
  assert.ok(app.writes().every(message => FILTER_WRITE.test(message) && message.includes('a.2.')));
  app.session.disconnect();
});

test('verified reciprocal pair: both sides are written equally; unequal received sides stay read-only with bands unaffected', () => {
  const app = fixture(); app.session.selectEqTarget(0);
  assert.equal(app.session.setEqFilter(hpf('lpf', 0.8)), true);
  assert.deepEqual(app.writes(), ['3:::SETD^a.0.eq.lpf^0.8', '3:::SETD^a.1.eq.lpf^0.8']); app.session.disconnect();
  const unequal = fixture({ filters: [[0.2, 1], [0.3, 1], [0, 1]] });
  assert.equal(unequal.session.canEditEqTarget(0), true, 'GEQ bands stay editable');
  unequal.session.selectEqTarget(0); assert.equal(unequal.session.setEqFilter(hpf('hpf', 0.5)), false); assert.equal(unequal.writes().length, 0);
  assert.equal(control(unequal).eqFilters, null, 'filters are outside the owned scope');
  assert.equal(unequal.session.resetEqBands(), false, 'flat bands: nothing to write'); assert.equal(unequal.writes().length, 0);
  const token = unequal.session.beginEqGesture(); assert.ok(token); assert.equal(unequal.session.previewEqFilterGesture(token, hpf('hpf', 0.5)), null); unequal.session.cancelEqGesture(); assert.equal(unequal.writes().length, 0);
  assert.equal(projectEqReadback(unequal.session.snapshot(), 0).filters.equal, false);
  // A mono/pair becoming equal natively rebuilds the scope with filters.
  unequal.receiver.receive('3:::SETD^a.1.eq.hpf^0.2'); unequal.session.selectEqTarget(0);
  assert.equal(unequal.session.setEqFilter(hpf('lpf', 0.8)), true); assert.deepEqual(unequal.writes(), ['3:::SETD^a.0.eq.lpf^0.8', '3:::SETD^a.1.eq.lpf^0.8']);
  unequal.session.disconnect();
  const missing = fixture({ omit: ['a.2.eq.lpf'] }); missing.session.selectEqTarget(2);
  assert.equal(missing.session.setEqFilter(hpf('hpf', 0.5)), false); assert.equal(missing.writes().length, 0); assert.equal(missing.session.canEditEqTarget(2), true);
  missing.session.disconnect();
});

test('clamps and the hpf/lpf gap apply to what is actually written; no room sends nothing', () => {
  const app = fixture({ filters: [[0, 1], [0, 1], [0.2, 0.6]] }); app.session.selectEqTarget(2);
  assert.equal(app.session.setEqFilter(hpf('hpf', 0.9)), true);
  assert.ok(Math.abs(Number(app.writes().at(-1).split('^')[2]) - 0.5) < 1e-12, 'hpf is held a gap below lpf'); app.deskEcho(); app.advance(3000);
  const count = app.writes().length;
  assert.equal(app.session.setEqFilter(hpf('lpf', 0)), false, 'clamped to a gap above the (now 0.5) hpf = the current 0.6: nothing to send'); assert.equal(app.writes().length, count); assert.equal(control(app).outcome, 'no-op');
  app.advance(3000); assert.equal(app.session.setEqFilter(hpf('lpf', 0.9)), true); assert.ok(Math.abs(Number(app.writes().at(-1).split('^')[2]) - 0.9) < 1e-12);
  app.session.disconnect();
  const tight = fixture({ filters: [[0, 1], [0, 1], [0.95, 1]] }); tight.session.selectEqTarget(2);
  assert.equal(tight.session.setEqFilter(hpf('lpf', 0.99)), false, 'no room above a 0.95 hpf'); assert.equal(tight.writes().length, 0);
  assert.equal(control(tight).gestureActive, false);
  tight.session.disconnect();
});

test('streaming drag: leading step, throttled at the GEQ cadence, latest wins, release sends only a differing final value', () => {
  const app = fixture(); app.session.selectEqTarget(2);
  const token = app.session.beginEqGesture();
  assert.equal(app.session.previewEqFilterGesture(token, hpf('hpf', 0.1)).value, 0.1); assert.equal(app.writes().length, 1, 'leading step');
  app.session.previewEqFilterGesture(token, hpf('hpf', 0.2)); app.session.previewEqFilterGesture(token, hpf('hpf', 0.3)); assert.equal(app.writes().length, 1, 'throttled');
  app.advance(119); assert.equal(app.writes().length, 1); app.advance(1); assert.deepEqual(app.writes().slice(1), ['3:::SETD^a.2.eq.hpf^0.3'], 'latest value wins');
  app.session.previewEqFilterGesture(token, hpf('hpf', 0.3)); app.advance(500); assert.equal(app.writes().length, 2, 'equal re-send is sparse');
  assert.equal(app.session.commitEqGesture(token), true); assert.equal(app.writes().length, 2, 'release equal to the last request sends nothing');
  const second = app.session.beginEqGesture(); app.session.previewEqFilterGesture(second, hpf('hpf', 0.35)); app.advance(0);
  const before = app.writes().length; app.session.previewEqFilterGesture(second, hpf('hpf', 0.4));
  assert.equal(app.session.commitEqGesture(second), true); assert.equal(app.writes().length, before + 1); assert.equal(app.writes().at(-1), '3:::SETD^a.2.eq.hpf^0.4', 'final exact value on release');
  assert.ok(app.writes().every(message => FILTER_WRITE.test(message)), 'a filter gesture never writes bands');
  app.session.disconnect();
});

test('backpressure defers a filter step; sub-epsilon moves are not sent', () => {
  const app = fixture(); app.session.selectEqTarget(2);
  const token = app.session.beginEqGesture(); app.session.previewEqFilterGesture(token, hpf('hpf', 0.1)); assert.equal(app.writes().length, 1);
  app.writer.bufferedAmount = 5000; app.session.previewEqFilterGesture(token, hpf('hpf', 0.2)); app.advance(500); assert.equal(app.writes().length, 1, 'deferred while the writer buffers');
  app.writer.bufferedAmount = 0; app.advance(200); assert.equal(app.writes().length, 2);
  app.session.previewEqFilterGesture(token, hpf('hpf', 0.2 + 1e-10)); app.advance(500); assert.equal(app.writes().length, 2, 'within 1e-9 of the last request: not sent');
  app.session.cancelEqGesture(); app.session.disconnect();
});

test('own echo of a streamed filter step never cancels; any other changed value is native, stops the stream, no rollback or replay', () => {
  const app = fixture(); app.session.selectEqTarget(2);
  let token = app.session.beginEqGesture(); app.session.previewEqFilterGesture(token, hpf('hpf', 0.1));
  assert.equal(app.deskEcho(), 1); assert.equal(control(app).gestureActive, true, 'own echo (10-significant-digit format) keeps the gesture');
  app.session.previewEqFilterGesture(token, hpf('hpf', 0.123456789012345)); app.advance(120); assert.equal(app.writes().length, 2); assert.equal(app.deskEcho(), 1); assert.equal(control(app).gestureActive, true);
  app.receiver.receive('3:::SETD^a.2.eq.hpf^0.9');
  assert.equal(control(app).gestureActive, false, 'native filter change stops the gesture'); assert.equal(app.session.commitEqGesture(token), false);
  app.advance(1000); assert.equal(app.writes().length, 2, 'no rollback or replay'); assert.equal(app.session.snapshot().eq.get('a.2.eq.hpf'), 0.9);
  assert.match(control(app).status, /Received control value changed|native|Values already sent live/);
  // A native lpf change in the owned scope while a band gesture is active stops it too.
  app.advance(3000); app.session.selectEqTarget(2); token = app.session.beginEqGesture(); assert.ok(token);
  app.receiver.receive('3:::SETD^a.2.eq.lpf^0.7'); assert.equal(control(app).gestureActive, false); app.session.disconnect();
});

test('a native filter change outside the owned scope (unreceived/unequal pair) cancels obsolete intent and rebuilds the scope', () => {
  const app = fixture({ omit: ['a.2.eq.lpf'] }); app.session.selectEqTarget(2);
  const token = app.session.beginEqGesture(); assert.ok(token);
  app.receiver.receive('3:::SETD^a.2.eq.lpf^1'); assert.equal(control(app).gestureActive, false);
  app.session.selectEqTarget(2); assert.equal(app.session.setEqFilter(hpf('hpf', 0.3)), true); assert.equal(app.writes().length, 1);
  app.session.disconnect();
});

test('reset writes the band reset and turns both cuts off (hpf 0, lpf 1) in the same one-shot, both sides of a pair', () => {
  const mono = fixture({ filters: [[0, 1], [0, 1], [0.2, 0.8]] }); mono.receiver.receive('3:::SETD^a.2.eq.peak.4^0.7'); mono.desk.set('a.2.eq.peak.4', 0.7);
  mono.session.selectEqTarget(2); assert.equal(mono.session.resetEqBands(), true);
  assert.deepEqual(mono.writes(), ['3:::SETD^a.2.eq.peak.4^0.5', '3:::SETD^a.2.eq.hpf^0', '3:::SETD^a.2.eq.lpf^1']); mono.session.disconnect();
  const pair = fixture({ filters: [[0.2, 0.8], [0.2, 0.8], [0, 1]] });
  pair.session.selectEqTarget(1); assert.equal(pair.session.resetEqBands(), true);
  assert.deepEqual(pair.writes(), ['3:::SETD^a.0.eq.hpf^0', '3:::SETD^a.1.eq.hpf^0', '3:::SETD^a.0.eq.lpf^1', '3:::SETD^a.1.eq.lpf^1'], 'bands already flat; both sides of each cut');
  assert.equal(pair.deskEcho(), 4); pair.advance(300); assert.equal(pair.session.resetEqBands(), false, 'already flat and off: a further reset sends nothing'); pair.session.disconnect();
  const bandsOnly = fixture({ filters: [[0.2, 0.8], [0.3, 0.8], [0, 1]] }); bandsOnly.receiver.receive('3:::SETD^a.0.eq.peak.2^0.7\nSETD^a.1.eq.peak.2^0.7');
  bandsOnly.session.selectEqTarget(0); assert.equal(bandsOnly.session.resetEqBands(), true);
  assert.deepEqual(bandsOnly.writes(), ['3:::SETD^a.0.eq.peak.2^0.5', '3:::SETD^a.1.eq.peak.2^0.5'], 'unequal cuts: bands only, cuts untouched'); bandsOnly.session.disconnect();
});

test('a band gesture keeps the retained filter coordinate and never writes a filter', () => {
  const app = fixture({ filters: [[0.2, 0.8], [0.2, 0.8], [0, 1]] }); app.session.selectEqTarget(0);
  const token = app.session.beginEqGesture(); const draw = [...control(app).eqCoordinate]; draw[3] = 0.9;
  assert.ok(app.session.previewEqGesture(token, { mode: 'draw', samples: draw.map((value, i) => ({ frequencyHz: [20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000][i], gainDb: 30 * value - 15 })) }));
  app.session.commitEqGesture(token); assert.deepEqual(app.writes().map(m => m.split('^')[1]), ['a.0.eq.peak.3', 'a.1.eq.peak.3']);
  assert.deepEqual(control(app).eqFilters.coordinate, [0.2, 0.8]); app.session.disconnect();
});

test('updateBusy counts an active filter gesture and a pending filter send', () => {
  const app = fixture(); app.session.selectEqTarget(2); const dialogOwner = createDialogOwner();
  const busy = () => updateBusy({ session: { snapshot: () => ({ ...app.session.snapshot(), phase: 'idle' }) }, dialogOwner });
  assert.equal(busy(), false, 'selection alone is not busy');
  const token = app.session.beginEqGesture(); assert.equal(busy(), true, 'active filter gesture');
  app.session.previewEqFilterGesture(token, hpf('hpf', 0.2)); app.session.commitEqGesture(token); assert.equal(control(app).gestureActive, false); assert.equal(busy(), true, 'pending filter send');
  app.deskEcho(); app.advance(3000); assert.equal(busy(), false);
  app.session.disconnect();
});

test('the filter capability needs createAuxControlSession; level and read-only sessions have no filter API', () => {
  const level = fixture({}, createAuxLevelSession);
  assert.equal(level.session.setEqFilter, undefined); assert.equal(level.session.previewEqFilterGesture, undefined); level.session.disconnect();
});

// ---- UI ----
function uiFixture({ debug = false, ...options } = {}) {
  const dom = domFixture(), tabs = dom.root.querySelector('.mm-local-tabs'), mix = dom.document.createElement('button');
  mix.dataset.mode = 'eq'; tabs.append(mix);
  const app = fixture(options), contexts = new Set(), context = { profileId: null, revision: 1, selectedAux: 2, sources: [] };
  const controller = { context: () => context, selectAux: () => false, clearLevelContext() { app.session.invalidateLevelContext(); }, subscribeContext(fn) { contexts.add(fn); fn(context); return () => contexts.delete(fn); } };
  const eq = mountEqControls({ root: dom.root, session: app.session, controller, window: new Node(dom.document), debug });
  for (const fn of contexts) fn(context);
  return { ...dom, ...app, eq, mix, context, find: selector => eq.section.querySelector(selector), all: selector => eq.section.querySelectorAll(selector) };
}
const press = (node, type, event = {}) => node.emit(type, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 100, ...event });
const svgOf = ui => ui.eq.section.querySelectorAll('*').find(node => node.tag === 'svg');
// Geometry in the fake DOM: width 150 -> graph x from 28 to 128 (100 px per position unit).
const clientXFor = position => 28 + position * 100;

test('UI: Low cut / High cut toggles write the default, remember the last used value, turn off with exact 0/1 and show aria-pressed', () => {
  const ui = uiFixture(); ui.eq.open(2);
  const [low, high] = ui.all('[data-eq-filter]'); assert.deepEqual([low.textContent, high.textContent], ['Low cut', 'High cut']);
  assert.equal(low.disabled, false); assert.equal(low.attributes['aria-pressed'], 'false'); assert.match(low.attributes['aria-label'], /Low cut \(high-pass filter\), off/);
  low.emit('click'); assert.deepEqual(ui.writes(), [`3:::SETD^a.2.eq.hpf^${AUX_EQ_FILTER_DEFAULT.hpf}`]);
  ui.deskEcho(); assert.equal(low.attributes['aria-pressed'], 'true'); assert.equal(low.className, 'mm-active'); assert.match(low.attributes['aria-label'], /35 Hz/);
  const handle = ui.find('[data-eq-filter-handle="hpf"]'); assert.equal(handle.attributes.visibility, 'visible'); assert.equal(handle.querySelector('[data-eq-filter-hz="hpf"]').textContent, '35 Hz');
  assert.equal(ui.find('[data-eq-filter-handle="lpf"]').attributes.visibility, 'hidden');
  ui.advance(300); low.emit('click'); assert.equal(ui.writes().at(-1), '3:::SETD^a.2.eq.hpf^0'); ui.deskEcho(); assert.equal(low.attributes['aria-pressed'], 'false'); assert.equal(handle.attributes.visibility, 'hidden');
  ui.advance(300); high.emit('click'); assert.equal(ui.writes().at(-1), `3:::SETD^a.2.eq.lpf^${AUX_EQ_FILTER_DEFAULT.lpf}`); ui.deskEcho();
  assert.equal(ui.find('[data-eq-filter-handle="lpf"]').querySelector('[data-eq-filter-hz="lpf"]').textContent, '16.0 kHz');
  // Drag the cut, turn it off and on again: the last used position returns.
  ui.advance(300); const hit = ui.find('[data-eq-filter-handle="hpf"]');
  low.emit('click'); ui.deskEcho(); ui.advance(300);
  press(ui.find('[data-eq-filter-handle="hpf"]').children[1], 'pointerdown', { clientX: clientXFor(0.081), clientY: 37 }); press(svgOf(ui), 'pointermove', { clientX: clientXFor(0.3), clientY: 40 });
  assert.ok(hit);
  ui.eq.destroy(); ui.session.disconnect();
});

test('UI: a handle drag (mouse, touch and pen) streams the cut, shows the requested value, and release sends once', () => {
  for (const pointerType of ['mouse', 'touch', 'pen']) {
    const ui = uiFixture({ filters: [[0.1, 1], [0.1, 1], [0.1, 1]] }); ui.eq.open(2);
    const hpfHandle = () => ui.find('[data-eq-filter-handle="hpf"]'), svg = svgOf(ui);
    assert.equal(hpfHandle().attributes.visibility, 'visible');
    press(hpfHandle().children[1], 'pointerdown', { pointerType, clientX: clientXFor(0.1), clientY: 37 });
    assert.equal(ui.session.snapshot().control.gestureActive, true); assert.equal(ui.writes().length, 0, 'a press alone writes nothing');
    press(svg, 'pointermove', { pointerType, clientX: clientXFor(0.1) + 1, clientY: 37 }); assert.equal(ui.writes().length, 0, 'below the 4 px slop');
    press(svg, 'pointermove', { pointerType, clientX: clientXFor(0.3), clientY: 37 });
    assert.deepEqual(ui.writes(), ['3:::SETD^a.2.eq.hpf^0.3'], pointerType); assert.equal(hpfHandle().querySelector('[data-eq-filter-hz="hpf"]').textContent, `${auxEqFilterHz(0.3)} Hz`);
    ui.advance(120); press(svg, 'pointermove', { pointerType, clientX: clientXFor(0.4), clientY: 37 }); ui.advance(120); assert.equal(ui.writes().length, 2);
    press(svg, 'pointermove', { pointerType, clientX: clientXFor(0.45), clientY: 37 }); press(svg, 'pointerup', { pointerType, clientX: clientXFor(0.45), clientY: 37 });
    assert.equal(ui.writes().length, 3); assert.equal(ui.writes().at(-1), '3:::SETD^a.2.eq.hpf^0.45'); assert.equal(ui.session.snapshot().control.gestureActive, false);
    assert.ok(ui.writes().every(message => FILTER_WRITE.test(message))); ui.eq.destroy(); ui.session.disconnect();
  }
});

test('UI: dragging past the ends clamps inside (0,1); a drag cannot cross the other cut', () => {
  const ui = uiFixture({ filters: [[0.1, 0.5], [0.1, 0.5], [0.1, 0.5]] }); ui.eq.open(2); const svg = svgOf(ui);
  press(ui.find('[data-eq-filter-handle="hpf"]').children[1], 'pointerdown', { clientX: clientXFor(0.1), clientY: 37 });
  press(svg, 'pointermove', { clientX: clientXFor(0.9), clientY: 37 }); assert.ok(Math.abs(Number(ui.writes().at(-1).split('^')[2]) - 0.4) < 1e-12);
  press(svg, 'pointermove', { clientX: -500, clientY: 37 }); ui.advance(120); assert.equal(ui.writes().at(-1), '3:::SETD^a.2.eq.hpf^0.01');
  press(svg, 'pointerup', { clientX: -500, clientY: 37 }); ui.eq.destroy(); ui.session.disconnect();
});

test('UI: a cancelled drag leaves streamed values applied and says so; pointercancel and a native change stop it', () => {
  const ui = uiFixture({ filters: [[0.1, 1], [0.1, 1], [0.1, 1]] }); ui.eq.open(2); const svg = svgOf(ui);
  press(ui.find('[data-eq-filter-handle="hpf"]').children[1], 'pointerdown', { clientX: clientXFor(0.1), clientY: 37 }); press(svg, 'pointermove', { clientX: clientXFor(0.3), clientY: 37 });
  svg.emit('pointercancel', { pointerId: 1 }); assert.equal(ui.session.snapshot().control.gestureActive, false); assert.equal(ui.writes().length, 1); assert.match(ui.session.snapshot().control.status, /already sent live/);
  ui.deskEcho(); ui.advance(3000);
  press(ui.find('[data-eq-filter-handle="hpf"]').children[1], 'pointerdown', { clientX: clientXFor(0.3), clientY: 37 }); press(svg, 'pointermove', { clientX: clientXFor(0.4), clientY: 37 });
  ui.receiver.receive('3:::SETD^a.2.eq.hpf^0.9'); assert.equal(ui.session.snapshot().control.gestureActive, false);
  press(svg, 'pointermove', { clientX: clientXFor(0.5), clientY: 37 }); press(svg, 'pointerup', { clientX: clientXFor(0.5), clientY: 37 }); assert.equal(ui.writes().length, 2, 'nothing after the native change');
  assert.equal(ui.find('[data-eq-filter-handle="hpf"]').querySelector('[data-eq-filter-hz="hpf"]').textContent, '10.0 kHz', 'the display follows the received value');
  ui.eq.destroy(); ui.session.disconnect();
});

test('UI: cut handles are keyboard operable: arrows step, keyup commits, Escape cancels, Enter/Space turn the cut off', () => {
  const ui = uiFixture({ filters: [[0.1, 1], [0.1, 1], [0.1, 1]] }); ui.eq.open(2);
  const handle = () => ui.find('[data-eq-filter-handle="hpf"]'); assert.equal(handle().attributes.tabindex, '0'); assert.equal(handle().attributes.role, 'button'); assert.match(handle().attributes['aria-label'], /Low cut handle, 40 Hz/);
  const key = (type, event) => handle().emit(type, { target: handle(), ...event });
  key('keydown', { key: 'ArrowRight' }); assert.equal(ui.session.snapshot().control.gestureActive, true); assert.equal(ui.writes().length, 1);
  assert.ok(Math.abs(Number(ui.writes()[0].split('^')[2]) - (0.1 + 1 / 62)) < 1e-12);
  ui.advance(120); key('keydown', { key: 'ArrowRight', shiftKey: true }); ui.advance(120); assert.equal(ui.writes().length, 2); key('keyup', { key: 'ArrowRight' });
  assert.equal(ui.session.snapshot().control.gestureActive, false);
  ui.deskEcho(); ui.advance(3000); key('keydown', { key: 'ArrowLeft' }); key('keydown', { key: 'Escape' }); assert.equal(ui.session.snapshot().control.gestureActive, false); const n = ui.writes().length;
  ui.deskEcho(); ui.advance(3000); key('keydown', { key: 'Enter' }); assert.equal(ui.writes().at(-1), '3:::SETD^a.2.eq.hpf^0'); assert.equal(ui.writes().length, n + 1);
  ui.eq.destroy(); ui.session.disconnect();
});

test('UI: read-only cuts show a compact reason (unequal sides / waiting) while the bands stay editable; handles and toggles never write then', () => {
  const ui = uiFixture({ filters: [[0.2, 1], [0.3, 1], [0, 1]] }); ui.context.selectedAux = 0; ui.eq.open(0);
  const [low] = ui.all('[data-eq-filter]'); assert.equal(low.disabled, true); assert.match(low.attributes.title, /L\/R cuts unequal/);
  const state = ui.find('.mm-live-eq-state'); assert.equal(state.hidden, false); assert.match(state.textContent, /Cuts read-only · L\/R cuts unequal/);
  assert.equal(ui.find('[data-eq-param="gain"]').disabled, false, 'GEQ remains editable');
  low.emit('click'); assert.equal(ui.writes().length, 0);
  press(ui.find('[data-eq-filter-handle="hpf"]').children[1], 'pointerdown', { clientX: 50, clientY: 37 }); assert.equal(ui.session.snapshot().control.gestureActive, false);
  ui.receiver.receive('3:::SETD^a.1.eq.hpf^0.2'); assert.equal(state.hidden, true); assert.equal(low.disabled, false);
  ui.eq.destroy(); ui.session.disconnect();
  const waiting = uiFixture({ omit: ['a.2.eq.hpf'] }); waiting.eq.open(2);
  assert.equal(waiting.all('[data-eq-filter]')[0].disabled, true); assert.match(waiting.find('.mm-live-eq-state').textContent, /waiting for filters/);
  waiting.eq.destroy(); waiting.session.disconnect();
});

test('UI: the reset button also turns both cuts off; received cuts bend the displayed received curve (approximation, ?debug note only)', () => {
  const ui = uiFixture({ debug: true, filters: [[0.3, 0.8], [0.3, 0.8], [0.3, 0.8]] }); ui.eq.open(2);
  assert.match(ui.find('[data-eq-reset]').attributes['aria-label'], /turn both cuts off/);
  const side = projectEqReadback(ui.session.snapshot(), 2).sides[0]; assert.equal(side.hpf, 0.3); assert.equal(side.lpf, 0.8);
  assert.match(ui.find('.mm-live-eq-approximation').textContent, /−12 dB\/oct approximation, not the verified native slope/);
  const path = ui.eq.section.querySelector('[data-eq-side="0"]').children[0].attributes.d;
  const flat = uiFixture({ debug: true }); flat.eq.open(2); assert.notEqual(path, flat.eq.section.querySelector('[data-eq-side="0"]').children[0].attributes.d, 'cuts change the drawn received line');
  ui.find('[data-eq-reset]').emit('click'); assert.deepEqual(ui.writes(), ['3:::SETD^a.2.eq.hpf^0', '3:::SETD^a.2.eq.lpf^1']);
  ui.eq.destroy(); ui.session.disconnect(); flat.eq.destroy(); flat.session.disconnect();
  const hidden = uiFixture(); hidden.eq.open(2); assert.equal(hidden.find('.mm-live-eq-approximation'), null, 'the approximation note exists only with ?debug'); hidden.eq.destroy(); hidden.session.disconnect();
});

test('static audit: filter wire forms exist only in the typed protocol module and are sent only through the private owner', async () => {
  const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(new URL('../src/iem/', import.meta.url))).filter(name => name.endsWith('.js'));
  for (const name of files) {
    const text = (await read(`src/iem/${name}`)).replace(/\/\/.*$/gm, '');
    if (name !== 'aux-eq-protocol.js') assert.doesNotMatch(text, /3:::SETD\^[^`'"]*eq\./, `${name} builds no EQ SETD text`);
    if (!['session-core.js', 'aux-eq-protocol.js'].includes(name)) assert.doesNotMatch(text, /encodeAuxEqFilterCommand/, `${name} does not serialize filters`);
    assert.doesNotMatch(text, /eq\.hpf\.(?:slope|freq)|\bm\.eq\.(?:hpf|lpf)|\.eq\.bypass\^/, `${name}: no slope/main-mix/bypass write form`);
  }
  assert.doesNotMatch(await read('src/iem/eq-controls.js'), /SETD|\.send\(|innerHTML|aux-eq-safety|demo-/);
  for (const file of ['src/iem/demo-entry.js', 'src/iem/demo-view.js', 'src/iem/demo-provider.js', 'src/iem/demo-eq.js']) assert.doesNotMatch(await read(file), /aux-eq-/);
  const core = await read('src/iem/session-core.js');
  assert.equal([...core.matchAll(/encodeAuxEqFilterCommand\(/g)].length, 1, 'one filter serializer call site (serialize)');
});
