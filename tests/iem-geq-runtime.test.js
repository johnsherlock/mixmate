import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createAuxLevelSession } from '../src/iem/aux-level-session.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { auxEqPositionToDb, auxEqDbToPosition, parseAuxProcessingFrame } from '../src/iem/aux-eq-protocol.js';
import { mapRequestedAuxEqCurve } from '../src/iem/aux-eq-curve.js';
import { requestedDrawSamples, requestedPointSamples, auxEqCentreX, auxEqPointGain, pointCentreGainLimit, AUX_EQ_POINT_NEGLIGIBLE_DB } from '../src/iem/aux-eq-curve.js';
import { mountEqControls, projectEqReadback, eqSideText, EQ_APPROXIMATION_NOTE, EQ_MODE_NOTES, EQ_SIDE_COLOURS } from '../src/iem/eq-controls.js';
const VU = JSON.parse(await readFile(new URL('./fixtures/iem-vu2.json', import.meta.url))).frame;
import { domFixture, Node } from './helpers/fake-dom.js';

// Fake transports only. No real mixer, browser or network is used.
const bandLines = (aux, value = () => 0.5) => Array.from({ length: 31 }, (_, band) => `SETD^a.${aux}.eq.peak.${band}^${value(band)}`);
const MONO = band => (band + 1) / 37;
function baseFrame({ omit = [], bypass = [0, 0, 0] } = {}) {
  const lines = ['SETS^model^ui24', 'SETD^a.0.matrix^0', 'SETD^a.1.matrix^0', 'SETD^a.2.matrix^0', 'SETD^a.0.stereoIndex^0', 'SETD^a.1.stereoIndex^1', 'SETD^a.2.stereoIndex^-1',
    'SETD^a.0.mix^0.4', 'SETD^a.1.mix^0.4', 'SETD^a.2.mix^0.4', 'SETD^a.0.eq.hpf.freq^0.1', 'SETD^a.5.eq.hpf.freq^0.1',
    ...bypass.map((value, aux) => `SETD^a.${aux}.eq.bypass^${value}`), ...bandLines(0), ...bandLines(1), ...bandLines(2, MONO)];
  return '3:::' + lines.filter(line => !omit.some(path => line.startsWith(`SETD^${path}^`))).join('\n');
}
const GEQ_WRITE = /^3:::SETD\^a\.[0-9]\.eq\.peak\.(?:[0-9]|[12][0-9]|30)\^[0-9.e-]+$/;
function fixture(options = {}, factory = createAuxControlSession) {
  const sockets = [], jobs = new Map(); let time = 0, next = 0;
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: time + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval(fn) { const id = ++next; jobs.set(id, { fn, at: Infinity }); return id; }, clearInterval(id) { jobs.delete(id); } };
  class Socket {
    readyState = 0; sent = []; hook = null;
    constructor() { sockets.push(this); }
    send(message) { this.sent.push(message); this.hook?.(message); }
    receive(data) { this.onmessage?.({ data }); }
    close() { this.readyState = 3; }
  }
  const session = factory({ WebSocketClass: Socket, timers, now: () => time, wallNow: () => time });
  session.connect('192.168.0.60');
  for (const socket of sockets) { socket.readyState = 1; socket.onopen?.(); }
  const [writer, receiver] = sockets;
  (receiver ?? writer).receive(baseFrame(options));
  // Fake desk modelled on observed 3.0.7865 behaviour: only CHANGED band values
  // echo, formatted to 10 significant digits (observed firmware), to the receive-only companion only.
  const desk = new Map(baseFrame(options).slice(4).split('\n').map(line => /^SETD\^(a\.\d\.eq\.peak\.\d+)\^(.+)$/.exec(line)).filter(Boolean).map(m => [m[1], Number(m[2])]));
  let echoed = 0;
  const writes = () => writer.sent.filter(message => message.startsWith('3:::SETD'));
  return { session, sockets, writer, receiver, jobs, desk, writes, now: () => time,
    deskEcho() {
      const all = writes(), lines = [];
      for (const message of all.slice(echoed)) { const [, path, raw] = message.split('^'), value = Number(raw); if (desk.get(path) !== value) { desk.set(path, value); lines.push(`SETD^${path}^${Number(value.toPrecision(10))}`); } }
      echoed = all.length; if (lines.length) receiver.receive('3:::' + lines.join('\n')); return lines.length;
    },
    advance(ms) { time += ms; for (const [id, job] of [...jobs]) if (job.at <= time) { jobs.delete(id); job.fn(); } } };
}
const control = app => app.session.snapshot().control;
const bandOf = message => message.split('^')[1];
const pathsOf = list => list.map(bandOf);
function drawFrom(app, change) {
  const draw = control(app).eqCoordinate.map(auxEqPositionToDb); change(draw); return requestedDrawSamples(draw);
}

test('sparse dispatch: only changed band peaks are written (both linked sides); full 62/31 order when every band changes', () => {
  const app = fixture();
  assert.equal(app.session.canEditEqTarget(0), true); assert.equal(app.session.canEditEqTarget(1), true);
  assert.equal(app.session.selectEqTarget(0), true);
  const token = app.session.beginEqGesture(); assert.ok(token);
  const values = app.session.previewEqGesture(token, drawFrom(app, draw => { draw[5] = 6; }));
  assert.equal(values.length, 31); assert.equal(values[5], auxEqDbToPosition(6)); assert.ok(values.every((value, band) => band === 5 || value === 0.5));
  assert.equal(app.writes().length, 2, 'a deliberate preview streams only the changed band, both sides');
  assert.equal(app.session.commitEqGesture(token), true);
  assert.deepEqual(app.writes(), [`3:::SETD^a.0.eq.peak.5^${auxEqDbToPosition(6)}`, `3:::SETD^a.1.eq.peak.5^${auxEqDbToPosition(6)}`]);
  assert.equal(control(app).authorized, 2); assert.deepEqual(app.receiver.sent.filter(message => message.startsWith('3:::SETD')), [], 'companion never writes');
  assert.equal(app.deskEcho(), 2); assert.equal(app.session.canEditEqTarget(0), true);
  const all = app.session.beginEqGesture(); app.session.previewEqGesture(all, drawFrom(app, draw => { draw.fill(3); })); app.session.commitEqGesture(all);
  const writes = app.writes().slice(2); assert.equal(writes.length, 62);
  assert.deepEqual(pathsOf(writes), [...Array(31).keys()].map(band => `a.0.eq.peak.${band}`).concat([...Array(31).keys()].map(band => `a.1.eq.peak.${band}`)));
  assert.ok(writes.every(message => GEQ_WRITE.test(message))); app.deskEcho();
  // Mono output with non-uniform received values: exact raw coordinates survive.
  app.session.selectEqTarget(2); const mono = app.session.beginEqGesture();
  assert.notEqual((auxEqPositionToDb(MONO(7)) + 15) / 30, MONO(7), 'fixture exercises a dB round-trip difference');
  app.session.previewEqGesture(mono, drawFrom(app, draw => { draw[3] = -4; }));
  assert.equal(app.session.commitEqGesture(mono), true);
  assert.deepEqual(app.writes().slice(64), [`3:::SETD^a.2.eq.peak.3^${auxEqDbToPosition(-4)}`], 'untouched mono bands (incl. round-trip-sensitive band 7) are never sent');
  assert.ok(app.writer.sent.every(message => ['3:::INIT', '3:::ALIVE', '2::'].includes(message) || GEQ_WRITE.test(message)));
  app.session.disconnect(); assert.equal(app.session.snapshot().eq.size, 0);
});

test('live EQ steps: cancel drops the coalesced pending step (no rollback); unchanged no-op and invalid curves never write', () => {
  const app = fixture(); app.session.selectEqTarget(0);
  let token = app.session.beginEqGesture();
  app.session.previewEqGesture(token, drawFrom(app, draw => { draw[1] = 3; })); app.session.previewEqGesture(token, drawFrom(app, draw => { draw[1] = 4; }));
  assert.equal(app.writes().length, 2, 'leading step sent; the second preview waits for the throttle');
  app.session.cancelEqGesture(); app.advance(1000); assert.equal(app.session.commitEqGesture(token), false); assert.equal(app.writes().length, 2, 'cancel drops the coalesced step; no rollback');
  app.deskEcho(); token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, () => {}));
  app.session.commitEqGesture(token); assert.equal(app.writes().length, 2); assert.equal(control(app).outcome, 'no-op');
  token = app.session.beginEqGesture();
  assert.equal(app.session.previewEqGesture(token, requestedDrawSamples(Array(31).fill(20))), null);
  assert.match(control(app).status, /not clipped/);
  // F09-S06: summed point shapes beyond ±15 dB saturate per band in the requested samples (never rejected whole).
  const saturated = app.session.previewEqGesture(token, requestedPointSamples([0, 1, 2].map(() => ({ x: 0.5, gainDb: 12, q: 0.5 })), control(app).eqCoordinate.map(auxEqPositionToDb)));
  assert.ok(saturated.includes(1) && saturated.every(value => value <= 1), 'saturated at exactly +15 dB');
  app.session.cancelEqGesture(); assert.ok(app.writes().length > 2);
  app.session.disconnect();
});

test('strict GEQ boundary: no raw arrays, paths, accessors or other targets; level/read-only factories expose no GEQ', () => {
  const app = fixture(); app.session.selectEqTarget(0); const token = app.session.beginEqGesture();
  const samples = requestedDrawSamples(Array(31).fill(1)).samples;
  const accessor = { mode: 'draw', get samples() { return samples; } };
  for (const intent of [Array(31).fill(0.6), { mode: 'draw', samples, path: 'a.0.eq.bypass' }, { mode: 'bands', samples }, accessor, { mode: 'draw', samples: [...samples.slice(0, 30), { frequencyHz: 20000, gainDb: 1, value: 1 }] }, null])
    assert.equal(app.session.previewEqGesture(token, intent), null);
  for (const index of [10, -1, '0', 1.5, undefined]) { assert.equal(app.session.canEditEqTarget(index), false); assert.equal(app.session.selectEqTarget(index), false); }
  assert.equal(app.session.canEditLevelTarget({ kind: 'geq', auxIndex: 0, bandIndex: 0 }), false);
  assert.equal(app.writes().length, 0);
  const level = fixture({}, createAuxLevelSession);
  assert.equal(['selectEqTarget', 'beginEqGesture', 'previewEqGesture', 'commitEqGesture', 'resetEqBands', 'canEditEqTarget'].some(key => key in level.session), false);
  assert.equal('eq' in level.session.snapshot(), false); assert.equal(level.session.canEditLevelTarget({ kind: 'geq', auxIndex: 0 }), false);
  const readOnly = fixture({}, createReadOnlySession);
  assert.deepEqual(Object.keys(readOnly.session).sort(), ['connect', 'disconnect', 'snapshot', 'subscribe']); assert.equal('eq' in readOnly.session.snapshot(), false);
  for (const { fn, at } of readOnly.jobs.values()) if (at === Infinity) fn();
  assert.ok(readOnly.writer.sent.every(message => ['3:::INIT', '3:::ALIVE', '2::'].includes(message)));
  for (const item of [app, level, readOnly]) item.session.disconnect();
});

test('unequal or incomplete profiles stay read-only; bypass is displayed and never written', () => {
  const app = fixture(); app.receiver.receive('3:::SETD^a.1.eq.peak.4^0.6');
  assert.equal(app.session.canEditEqTarget(0), false); assert.equal(app.session.selectEqTarget(0), false);
  assert.match(control(app).reason, /Unequal linked EQ profiles/); assert.equal(app.session.beginEqGesture(), null);
  const readback = projectEqReadback(app.session.snapshot(), 0);
  assert.equal(readback.equal, false); assert.equal(readback.sides[0].bands[4], 0.5); assert.equal(readback.sides[1].bands[4], 0.6);
  for (const omit of [['a.2.eq.peak.30'], ['a.2.eq.bypass']]) { const partial = fixture({ omit }); assert.equal(partial.session.canEditEqTarget(2), false); assert.equal(projectEqReadback(partial.session.snapshot(), 2).complete, false); partial.session.disconnect(); }
  const unequalBypass = fixture({ bypass: [1, 0, 0] }); assert.equal(unequalBypass.session.canEditEqTarget(0), false); unequalBypass.session.disconnect();
  const bypassed = fixture({ bypass: [1, 1, 0] });
  const view = projectEqReadback(bypassed.session.snapshot(), 0); assert.equal(view.bypassed, true); assert.match(eqSideText(view.sides[0]), /BYPASSED on desk/);
  bypassed.session.selectEqTarget(0); assert.equal(bypassed.session.resetEqBands(), false, 'already flat: no-op');
  const token = bypassed.session.beginEqGesture(); bypassed.session.previewEqGesture(token, drawFrom(bypassed, draw => { draw[0] = 2; })); bypassed.session.commitEqGesture(token);
  assert.deepEqual(pathsOf(bypassed.writes()), ['a.0.eq.peak.0', 'a.1.eq.peak.0']); assert.ok(bypassed.writes().every(message => !/bypass|hpf|preset/.test(message)));
  for (const item of [app, bypassed]) item.session.disconnect();
});

test('native band, away-and-back, bypass and processing changes cancel obsolete intent; next gesture uses current actual without Enable', () => {
  const app = fixture(); app.session.selectEqTarget(0);
  let token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, draw => { draw[9] = 5; }));
  app.receiver.receive('3:::SETD^a.0.eq.peak.3^0.6'); app.receiver.receive('3:::SETD^a.1.eq.peak.3^0.6');
  assert.equal(app.session.commitEqGesture(token), false); assert.equal(app.writes().length, 2, 'native edit stops the stream; no replay');
  app.deskEcho(); token = app.session.beginEqGesture(); assert.ok(token, 'no manual Enable or re-arm');
  assert.equal(control(app).eqCoordinate[3], 0.6, 'new gesture basis is current received actual');
  const intent = drawFrom(app, draw => { draw[1] = 1; }); assert.ok(app.session.previewEqGesture(token, intent));
  // Away-and-back: equal final values cannot hide the native edit.
  app.receiver.receive('3:::SETD^a.0.eq.peak.12^0.7\nSETD^a.1.eq.peak.12^0.7'); app.receiver.receive('3:::SETD^a.0.eq.peak.12^0.5\nSETD^a.1.eq.peak.12^0.5');
  assert.equal(app.session.previewEqGesture(token, intent), null); assert.equal(app.session.commitEqGesture(token), false); assert.equal(app.writes().length, 4);
  for (const change of ['3:::SETD^a.0.eq.bypass^1', '3:::SETD^a.1.eq.hpf.freq^0.3', '3:::SETS^a.0.eq.preset^Vocal', '3:::SETD^a.0.dyn.threshold^' + 'x'.repeat(200)]) {
    const item = fixture(); item.session.selectEqTarget(0); const gesture = item.session.beginEqGesture();
    item.session.previewEqGesture(gesture, drawFrom(item, draw => { draw[2] = 2; }));
    item.receiver.receive(change);
    assert.equal(item.session.commitEqGesture(gesture), false, change); assert.equal(item.writes().length, 2); item.session.disconnect();
  }
  // Unchanged raw processing and other outputs' processing leave the gesture alone.
  const quiet = fixture(); quiet.session.selectEqTarget(0); const gesture = quiet.session.beginEqGesture();
  quiet.session.previewEqGesture(gesture, drawFrom(quiet, draw => { draw[2] = 2; }));
  quiet.receiver.receive('3:::SETD^a.0.eq.hpf.freq^0.1\nSETD^a.5.eq.hpf.freq^0.9\nSETD^a.2.eq.peak.0^0.1');
  assert.equal(quiet.session.commitEqGesture(gesture), true); assert.deepEqual(pathsOf(quiet.writes()), ['a.0.eq.peak.2', 'a.1.eq.peak.2']);
  for (const item of [app, quiet]) item.session.disconnect();
});

test('reentrant receipts stop the remainder; the full dispatched (62-path) closure must be received again; throwing send disconnects', () => {
  for (const [reentrant, expected] of [['3:::SETD^a.1.eq.peak.20^0.5', 10], ['3:::SETD^a.0.eq.peak.4^0.5', 5], ['3:::SETD^a.1.eq.bypass^0', 7]]) {
    const app = fixture(); app.session.selectEqTarget(0); const token = app.session.beginEqGesture();
    app.writer.hook = () => { if (app.writes().length === expected) { app.writer.hook = null; app.receiver.receive(reentrant); } };
    assert.equal(app.session.previewEqGesture(token, drawFrom(app, draw => { draw.fill(3); })), null);
    assert.equal(app.session.commitEqGesture(token), false); assert.equal(app.writes().length, expected, reentrant);
    assert.equal(app.session.canEditEqTarget(0), false); assert.match(control(app).status, /some values may have changed|interrupted/i);
    app.receiver.receive('3:::' + bandLines(0).join('\n')); assert.equal(app.session.canEditEqTarget(0), false, 'unattempted side still unresolved');
    app.receiver.receive('3:::' + bandLines(1).join('\n')); assert.equal(app.session.canEditEqTarget(0), true);
    assert.ok(app.session.beginEqGesture(), 'complete compatible recovery permits a new gesture without Enable'); app.session.disconnect();
  }
  const app = fixture(); app.session.selectEqTarget(2); const token = app.session.beginEqGesture(), intent = drawFrom(app, draw => { draw.fill(-3); });
  app.writer.send = message => { if (message.startsWith('3:::SETD') && app.writer.sent.filter(x => x.startsWith('3:::SETD')).length === 2) throw Error('socket'); app.writer.sent.push(message); };
  assert.equal(app.session.previewEqGesture(token, intent), null); assert.equal(app.session.commitEqGesture(token), false); assert.equal(app.writes().length, 2);
  assert.equal(app.session.snapshot().phase, 'error'); assert.match(app.session.snapshot().detail, /EQ bands may have changed/); assert.equal(app.session.snapshot().eq.size, 0); assert.ok(app.sockets.every(socket => socket.readyState === 3));
});

test('bounded observation diagnostics keep requested and received distinct; no correlated ACK claim', () => {
  const app = fixture(); app.session.selectEqTarget(2);
  let token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, draw => { draw.fill(1); })); app.session.commitEqGesture(token);
  const requested = control(app).eqRequested; assert.equal(requested[0], auxEqDbToPosition(1));
  assert.equal(app.session.snapshot().eq.get('a.2.eq.peak.0'), MONO(0), 'sending never changes received state');
  app.receiver.receive('3:::' + app.writes().slice(0, 15).map(message => message.slice(4)).join('\n'));
  assert.equal(control(app).outcome, 'pending');
  app.receiver.receive('3:::' + app.writes().slice(15).map(message => message.slice(4)).join('\n'));
  assert.equal(control(app).outcome, 'observed-match'); assert.match(control(app).status, /no correlated acknowledgement/);
  token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, draw => { draw.fill(2); })); app.session.commitEqGesture(token);
  app.advance(2500); assert.equal(control(app).outcome, 'sent-unverified'); assert.match(control(app).status, /application unverified/);
  token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, draw => { draw.fill(-2); })); app.session.commitEqGesture(token);
  app.receiver.receive('3:::SETD^a.2.eq.peak.0^0.4321'); assert.equal(control(app).outcome, 'precision-or-native-conflict');
  assert.equal(app.session.snapshot().eq.get('a.2.eq.peak.0'), 0.4321); assert.equal(control(app).eqRequested, null);
  app.session.disconnect();
});

test('scoped sparse reset writes only selected-output band peaks not already .5', () => {
  const app = fixture(); app.session.selectEqTarget(2); assert.equal(app.session.resetEqBands(), true);
  assert.deepEqual(app.writes(), [...Array(31).keys()].map(band => `3:::SETD^a.2.eq.peak.${band}^0.5`));
  const linked = fixture(); linked.receiver.receive('3:::SETD^a.0.eq.peak.0^0.6\nSETD^a.1.eq.peak.0^0.6');
  linked.desk.set('a.0.eq.peak.0', 0.6); linked.desk.set('a.1.eq.peak.0', 0.6);
  linked.session.selectEqTarget(1); assert.equal(linked.session.resetEqBands(), true);
  assert.deepEqual(linked.writes(), ['3:::SETD^a.0.eq.peak.0^0.5', '3:::SETD^a.1.eq.peak.0^0.5']);
  assert.equal(linked.deskEcho(), 2); assert.equal(linked.session.canEditEqTarget(1), true); assert.equal(linked.session.resetEqBands(), false, 'already flat: no-op');
  for (const item of [app, linked]) item.session.disconnect();
});

test('processing detector is bounded, opaque and excludes modelled fields', () => {
  assert.deepEqual(parseAuxProcessingFrame('3:::SETD^a.0.eq.peak.3^0.5\nSETD^a.0.eq.bypass^1\nSETD^a.0.mix^0.4\nSETS^a.0.name^x\nSETD^a.3.eq.hpf.freq^0.2\nSETD^i.0.eq.hpf^1\nSETD^a.1.dyn.x^' + 'y'.repeat(200)).map(x => [x.path, x.raw]),
    [['a.3.eq.hpf.freq', '0.2'], ['a.1.dyn.x', null]]);
  assert.deepEqual(parseAuxProcessingFrame('SETD^a.0.x^1'), []);
});

function uiFixture(options = {}) {
  const dom = domFixture(), tabs = dom.root.querySelector('.mm-local-tabs'), mix = dom.document.createElement('button');
  mix.dataset.mode = 'eq'; tabs.append(mix);
  const app = fixture(options), contexts = new Set(), context = { profileId: null, revision: 1, selectedAux: 0, sources: [] };
  const controller = { context: () => context, selectAux: () => false, clearLevelContext() { app.session.invalidateLevelContext(); }, subscribeContext(fn) { contexts.add(fn); fn(context); return () => contexts.delete(fn); } };
  const eq = mountEqControls({ root: dom.root, session: app.session, controller, window: new Node(dom.document) });
  for (const fn of contexts) fn(context);
  return { ...dom, ...app, eq, mix, context, contexts, find: selector => eq.section.querySelector(selector), all: selector => eq.section.querySelectorAll(selector) };
}
const press = (node, type, event = {}) => node.emit(type, { button: 0, pointerId: 1, clientX: 0, clientY: 100, ...event });
test('EQ view: explicit open, visible approximation/bypass status, mutually exclusive point/draw modes and release-only slider commits', () => {
  const ui = uiFixture({ bypass: [1, 1, 0] });
  assert.equal(ui.mix.disabled, false); ui.mix.emit('click');
  assert.equal(ui.eq.section.hidden, false); assert.equal(ui.root.dataset.eqOpen, 'true'); assert.equal(ui.writes().length, 0, 'opening never writes');
  assert.match(ui.eq.section.textContent, /not verified DSP centres/); assert.equal(ui.find('.mm-live-eq-approximation').textContent, EQ_APPROXIMATION_NOTE);
  assert.match(ui.find('.mm-live-eq-bypass').textContent, /BYPASSED/); assert.match(ui.find('.mm-live-eq-details').textContent, /0\/31|31\/31 bands received/);
  assert.match(ui.find('.mm-eq-unverified').textContent, /unverified · not available/); assert.equal(ui.all('[data-toggle-cut]').length, 0, 'no shelf/cut controls');
  const gain = ui.find('[data-eq-param="gain"]'), cap = gain.parentElement.querySelector('.mm-fader-hit');
  assert.equal(gain.disabled, false); assert.equal(ui.find('[data-eq-point="1"]').disabled, false);
  press(cap, 'pointerdown'); press(cap, 'pointermove', { clientY: 60 });
  const n = ui.writes().length; assert.ok(n > 0, 'moving streams changed bands live');
  press(cap, 'pointerup', { clientY: 60 }); assert.equal(ui.writes().length, n, 'unchanged release adds nothing');
  assert.ok(n > 0 && n < 62 && n % 2 === 0, `sparse: ${n}`); assert.deepEqual(pathsOf(ui.writes()).slice(n / 2).map(path => path.replace('a.1.', 'a.0.')), pathsOf(ui.writes()).slice(0, n / 2));
  assert.ok(ui.writes().every(message => GEQ_WRITE.test(message)));
  // Draw mode disables point controls/handles; switching mid-gesture cancels without writes.
  press(cap, 'pointerdown'); press(cap, 'pointermove', { clientY: 30 }); const m = ui.writes().length; assert.ok(m > n);
  ui.find('[data-eq-mode="draw"]').emit('click');
  assert.equal(ui.eq.mode, 'draw'); assert.equal(ui.writes().length, m, 'switching mid-gesture sends nothing more');
  assert.equal(gain.disabled, true); assert.equal(ui.find('[data-eq-point="0"]').disabled, true);
  assert.equal(ui.find('[data-eq-handle="0"]').attributes.visibility, 'hidden');
  assert.equal(ui.find('[data-eq-mode="draw"]').attributes['aria-pressed'], 'true'); assert.equal(ui.find('[data-eq-mode="points"]').attributes['aria-pressed'], 'false');
  ui.find('[data-eq-mode="points"]').emit('click'); assert.equal(ui.find('[data-eq-handle="0"]').attributes.visibility, 'visible');
  // The live steps were never echoed and the chain was cancelled: no re-arm from stale received bands.
  assert.equal(gain.disabled, true); assert.match(ui.find('.mm-live-eq-status').textContent, /for the desk to report the last EQ change/);
  ui.receiver.receive('3:::' + ui.writes().map(message => message.slice(4)).join('\n')); assert.equal(gain.disabled, false, 'matching echo clears the barrier automatically');
  ui.eq.close(); assert.equal(ui.eq.section.hidden, true); assert.equal(ui.root.dataset.eqOpen, 'false'); assert.equal(ui.session.snapshot().control.selected, null);
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view: unequal readback disables controls; context change closes; reset is scoped and explicit', () => {
  const ui = uiFixture(); ui.eq.open(0);
  ui.receiver.receive('3:::SETD^a.1.eq.peak.7^0.9');
  assert.equal(ui.find('[data-eq-param="gain"]').disabled, true); assert.equal(ui.find('[data-eq-reset]').disabled, true);
  assert.match(ui.find('.mm-live-eq-status').textContent, /Unequal linked EQ profiles/); assert.match(ui.find('.mm-live-eq-details').textContent, /raw 0\.9/);
  ui.receiver.receive('3:::SETD^a.1.eq.peak.7^0.5'); assert.equal(ui.find('[data-eq-reset]').disabled, false);
  ui.receiver.receive('3:::SETD^a.0.eq.peak.7^0.8\nSETD^a.1.eq.peak.7^0.8');
  const reset = ui.find('[data-eq-reset]'), confirm = ui.find('.mm-live-eq-reset-confirm');
  reset.emit('click'); assert.equal(confirm.hidden, false); assert.equal(ui.writes().length, 0, 'first tap only asks');
  assert.match(confirm.textContent, /Reset all 31 GEQ bands of Output 1 and 2/); assert.equal(ui.document.activeElement, ui.find('[data-eq-reset-cancel]'), 'focus moves to the safe choice');
  ui.document.activeElement.emit('keydown', { key: 'Escape' }); assert.equal(confirm.hidden, true); assert.equal(ui.eq.section.hidden, false, 'Escape closes the confirm, not the view');
  assert.equal(ui.document.activeElement, reset); assert.equal(ui.writes().length, 0);
  reset.emit('click'); ui.find('[data-eq-reset-cancel]').emit('click'); assert.equal(confirm.hidden, true); assert.equal(ui.writes().length, 0);
  reset.emit('click'); ui.find('[data-eq-reset-confirm]').emit('click');
  assert.equal(confirm.hidden, true); assert.deepEqual(ui.writes(), ['3:::SETD^a.0.eq.peak.7^0.5', '3:::SETD^a.1.eq.peak.7^0.5']);
  ui.context.revision++; for (const fn of ui.contexts) fn(ui.context); assert.equal(ui.eq.section.hidden, true);
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ graph: background touch in points mode never begins; handle drag and draw strokes commit once on release', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const svg = ui.find('[data-draw]') || ui.eq.section.querySelectorAll('*').find(node => node.tag === 'svg');
  press(svg, 'pointerdown', { clientX: 60, clientY: 40 }); press(svg, 'pointermove', { clientX: 90, clientY: 30 }); press(svg, 'pointerup', { clientX: 90, clientY: 30 });
  assert.equal(ui.session.snapshot().control.gestureActive, false); assert.equal(ui.writes().length, 0, 'background swipe scrolls without writing');
  const handle = ui.find('[data-eq-handle="1"]');
  press(handle.children[1], 'pointerdown', { clientX: 90, clientY: 94 }); press(svg, 'pointermove', { clientX: 70, clientY: 60 });
  const n = ui.writes().length; assert.ok(n > 0 && n < 62, 'handle drag streams changed bands'); assert.equal(ui.find('[data-eq-point="1"]').attributes['aria-pressed'], 'true');
  press(svg, 'pointerup', { clientX: 70, clientY: 60 }); assert.equal(ui.writes().length, n);
  ui.deskEcho(); assert.equal(ui.find('[data-eq-param="gain"]').disabled, false, 'rounded changed-only echoes clear the basis');
  ui.find('[data-eq-mode="draw"]').emit('click'); assert.equal(svg.dataset.draw, 'true');
  press(svg, 'pointerdown', { clientX: 30, clientY: 50 }); press(svg, 'pointermove', { clientX: 130, clientY: 50 });
  assert.ok(ui.writes().length > n, 'drawing streams live');
  press(svg, 'pointerup', { clientX: 130, clientY: 50 }); assert.ok(ui.writes().length > n);
  assert.ok(ui.writes().every(message => GEQ_WRITE.test(message)));
  ui.eq.destroy(); ui.session.disconnect();
});

test('points are a relative Δ: bands outside influence keep exact raw values; zero Δ is a no-op; out-of-range point bands saturate at ±15 while the session still rejects (never clips) an out-of-range curve', () => {
  const app = fixture(); app.session.selectEqTarget(2);
  let token = app.session.beginEqGesture(); const basis = control(app).eqCoordinate.map(auxEqPositionToDb);
  const neutral = [0.233, 0.566, 0.85].map(x => ({ x, gainDb: 0, q: 0.5 }));
  assert.ok(app.session.previewEqGesture(token, requestedPointSamples(neutral, basis)));
  app.session.commitEqGesture(token); assert.equal(app.writes().length, 0, 'all-zero Δ release writes nothing'); assert.equal(control(app).outcome, 'no-op');
  token = app.session.beginEqGesture();
  const points = [{ x: auxEqCentreX(1000), gainDb: 3, q: 1 }, { x: 0.233, gainDb: 0, q: 0.5 }, { x: 0.85, gainDb: 0, q: 0.5 }];
  app.session.previewEqGesture(token, requestedPointSamples(points, basis)); assert.equal(app.session.commitEqGesture(token), true);
  const writes = app.writes(), centres = [20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
  const influenced = centres.map((f, band) => band).filter(band => Math.abs(auxEqPointGain(points, auxEqCentreX(centres[band]))) >= AUX_EQ_POINT_NEGLIGIBLE_DB);
  assert.deepEqual(pathsOf(writes), influenced.map(band => `a.2.eq.peak.${band}`), 'only influenced bands are sent; all others keep exact raw values by not being written');
  assert.ok(influenced.length <= 11); assert.ok(writes.includes(`3:::SETD^a.2.eq.peak.17^${auxEqDbToPosition(auxEqPositionToDb(MONO(17)) + 3)}`), 'Δ applies on top of the received −value, not around 0 dB');
  // F09-S06 (live finding 2026-11-19): a received +14 dB band plus +3 dB Δ saturates at exactly +15 dB in the
  // requested point samples; the session's unchanged range check passes. An out-of-range curve is still rejected whole.
  app.receiver.receive('3:::' + writes.map(message => message.slice(4)).join('\n'));
  app.receiver.receive(`3:::SETD^a.2.eq.peak.17^${auxEqDbToPosition(14)}`);
  token = app.session.beginEqGesture();
  const requested = app.session.previewEqGesture(token, requestedPointSamples(points, control(app).eqCoordinate.map(auxEqPositionToDb)));
  assert.equal(requested[17], 1, 'band 17 saturates at exactly +15 dB'); assert.ok(requested.every(value => value >= 0 && value <= 1));
  const over = control(app).eqCoordinate.map(auxEqPositionToDb); over[4] = 15.5;
  assert.equal(app.session.previewEqGesture(token, requestedDrawSamples(over)), null, 'session still rejects, never clips');
  assert.equal(app.session.commitEqGesture(token), true); assert.ok(app.writes().length > writes.length);
  app.session.disconnect();
});

// F09-S07 (user decision 2026-11-20; root's live finding: FREQ/WIDTH sent nothing because every point gain
// reset to 0 after each release): points are persistent parametric drawing aids over an anchored base.
const dbOf = message => auxEqPositionToDb(Number(message.split('^')[2]));
const lastDb = (list, path) => { const hit = list.filter(message => bandOf(message) === path).at(-1); return hit === undefined ? undefined : dbOf(hit); };
const keyOn = (ui, input, name) => input.emit('keydown', { key: name, target: input, preventDefault() {} });
const keyUp = (ui, input, name) => input.emit('keyup', { key: name, target: input, preventDefault() {} });
function stepGain(ui, steps) {
  const gain = ui.find('[data-eq-param="gain"]'); gain.focus();
  for (let n = 0; n < steps; n++) { keyOn(ui, gain, 'PageUp'); ui.advance(300); }
  keyUp(ui, gain, 'PageUp'); ui.advance(300); return gain;
}
const capOf = (ui, id) => ui.find(`[data-eq-param="${id}"]`).parentElement.querySelector('.mm-fader-hit');
function dragCap(ui, id, dy) { const cap = capOf(ui, id); press(cap, 'pointerdown'); press(cap, 'pointermove', { clientY: 100 - dy }); ui.advance(300); press(cap, 'pointerup', { clientY: 100 - dy }); ui.advance(300); }

test('EQ view (F09-S07): with all point gains at 0, FREQ/WIDTH correctly send nothing and say so; notes describe persistent points', () => {
  const ui = uiFixture(); ui.eq.open(0);
  assert.match(ui.find('.mm-live-eq-mode-note').textContent, /persistent shape points/);
  dragCap(ui, 'freq', 79); dragCap(ui, 'q', 79);
  assert.equal(ui.writes().length, 0); assert.match(ui.find('.mm-live-eq-status').textContent, /every point gain is 0 dB/);
  assert.doesNotMatch(ui.eq.section.textContent, /only shape the next adjustment|return to 0 dB Δ/);
  ui.find('[data-eq-mode="draw"]').emit('click'); assert.equal(ui.find('.mm-live-eq-mode-note').textContent, EQ_MODE_NOTES.draw); assert.match(EQ_MODE_NOTES.draw, /last requested curve if the desk has not echoed/);
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view (F09-S07): a boosted point keeps its gain; moving FREQ moves the bump (old centre returns to base, new centre rises); WIDTH changes send', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const gain = ui.find('[data-eq-param="gain"]'), output = gain.closest('.mm-eq-param').querySelector('output');
  dragCap(ui, 'gain', 79); // +10.8 dB on point 1 (about 100 Hz)
  const first = ui.writes(); ui.deskEcho();
  assert.ok(first.length > 0); assert.ok(Math.abs(lastDb(first, 'a.0.eq.peak.7') - 10.8) < 0.1, 'point 1 boosts 100 Hz');
  assert.equal(gain.value, '10.8', 'the gain persists after release'); assert.match(output.textContent, /Δ \+10\.8 dB/);
  dragCap(ui, 'freq', 79); // x 0.233 -> 0.683 (about 2.2 kHz)
  const moved = ui.writes().slice(first.length); ui.deskEcho();
  assert.ok(moved.length > 0, 'FREQ with a non-zero gain sends');
  assert.ok(Math.abs(lastDb(moved, 'a.0.eq.peak.7')) < 0.05, 'bands the bump leaves go back to the base');
  assert.ok(lastDb(moved, 'a.0.eq.peak.20') > 10, 'the new centre (2 kHz) rises');
  assert.equal(lastDb(moved, 'a.0.eq.peak.26') === undefined || lastDb(moved, 'a.0.eq.peak.26') > 0, true);
  assert.deepEqual(pathsOf(moved).filter(path => path.startsWith('a.1.')).map(path => path.replace('a.1.', 'a.0.')), pathsOf(moved).filter(path => path.startsWith('a.0.')), 'both linked sides');
  assert.equal(gain.value, '10.8', 'gain still persists');
  const before = ui.writes().length; dragCap(ui, 'q', 79); // narrower bump
  const narrowed = ui.writes().slice(before); assert.ok(narrowed.length > 0, 'a WIDTH change sends');
  assert.ok(lastDb(narrowed, 'a.0.eq.peak.23') < lastDb(moved, 'a.0.eq.peak.23'), 'a narrower bump lowers its flanks');
  assert.doesNotMatch(ui.find('.mm-live-eq-status').textContent, /Unchanged requested coordinate|restarted/);
  assert.ok(ui.writes().every(message => GEQ_WRITE.test(message)));
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view (F09-S07): gains persist across gestures without double counting; a native band change re-anchors with no stale re-send', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const gain = stepGain(ui, 3); const first = ui.writes(); ui.deskEcho();
  const unit = lastDb(first, 'a.0.eq.peak.7') / 3; assert.ok(unit > 0.9 && unit <= 1);
  assert.equal(Number(gain.value), 3);
  stepGain(ui, 2); const second = ui.writes().slice(first.length); ui.deskEcho();
  assert.equal(Number(gain.value), 5);
  assert.ok(Math.abs(lastDb(second, 'a.0.eq.peak.7') - 5 * unit) < 1e-6, 'second gesture builds base + the 5 dB point, not 3 + 5');
  // A native edit (another editor / the desk) between gestures.
  ui.receiver.receive('3:::SETD^a.0.eq.peak.26^0.2\nSETD^a.1.eq.peak.26^0.2');
  const echoed7 = lastDb(second, 'a.0.eq.peak.7'), count = ui.writes().length;
  assert.match(ui.find('.mm-live-eq-status').textContent, /Curve changed on the desk; points restarted from the current curve/, 'restarted at render time, before any touch');
  assert.equal(Number(gain.value), 0, 'handles/sliders restart between gestures');
  stepGain(ui, 1); const third = ui.writes().slice(count);
  assert.equal(Number(gain.value), 1, 'gains restart at 0, then this gesture adds 1');
  assert.ok(Math.abs(lastDb(third, 'a.0.eq.peak.7') - (echoed7 + unit)) < 1e-6, 'base is the new received coordinate (with the applied boost); no double bump');
  assert.equal(lastDb(third, 'a.0.eq.peak.26'), undefined, 'the native band is never overwritten');
  assert.ok(third.length < 62, 'no stale whole-curve re-send');
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view (F09-S07 review): a cancelled points gesture keeps its points when the desk holds the last sent curve, restarts as interrupted when it does not', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const gain = ui.find('[data-eq-param="gain"]'); gain.focus();
  keyOn(ui, gain, 'PageUp'); assert.ok(ui.writes().length > 0, 'leading step streams');
  keyOn(ui, gain, 'Escape'); ui.deskEcho();
  assert.equal(Number(gain.value), 1, 'matching: the moved point is kept'); assert.doesNotMatch(ui.find('.mm-live-eq-status').textContent, /restarted/);
  stepGain(ui, 1); assert.equal(Number(gain.value), 2); assert.doesNotMatch(ui.find('.mm-live-eq-status').textContent, /restarted/);
  ui.deskEcho(); ui.advance(300);
  keyOn(ui, gain, 'PageUp'); ui.advance(10); keyOn(ui, gain, 'PageUp'); // second step throttled, never sent
  assert.equal(Number(gain.value), 4); keyOn(ui, gain, 'Escape'); ui.deskEcho();
  assert.match(ui.find('.mm-live-eq-status').textContent, /last point change was interrupted; points restarted/);
  assert.doesNotMatch(ui.find('.mm-live-eq-status').textContent, /Curve changed on the desk/);
  assert.equal(Number(gain.value), 0, 'mismatch: points restart from the curve the desk holds');
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view (F09-S07 review): own echoes still pending never restart the points; the next gesture builds on the requested curve', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const gain = stepGain(ui, 3); const first = ui.writes(), unit = lastDb(first, 'a.0.eq.peak.7') / 3;
  assert.equal(Number(gain.value), 3, 'no echo yet: no render-time restart');
  stepGain(ui, 1); const second = ui.writes().slice(first.length);
  assert.equal(Number(gain.value), 4); assert.doesNotMatch(ui.find('.mm-live-eq-status').textContent, /restarted/);
  assert.ok(Math.abs(lastDb(second, 'a.0.eq.peak.7') - 4 * unit) < 1e-6);
  ui.deskEcho(); assert.equal(Number(gain.value), 4, 'matching echoes keep the points');
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view (F09-S07 review): the owner ending a gesture mid-drag shows its reason next to any hint; points restart from the desk curve once editable', () => {
  const ui = uiFixture(); ui.eq.open(0);
  stepGain(ui, 2); ui.deskEcho();
  ui.receiver.receive('3:::SETD^a.0.eq.peak.27^0.3\nSETD^a.1.eq.peak.27^0.3'); // native edit: restart hint
  assert.match(ui.find('.mm-live-eq-status').textContent, /Curve changed on the desk/);
  const gain = ui.find('[data-eq-param="gain"]'), cap = capOf(ui, 'gain');
  press(cap, 'pointerdown'); press(cap, 'pointermove', { clientY: 40 }); assert.ok(control(ui).gestureActive);
  ui.receiver.receive('3:::SETD^a.0.eq.peak.26^0.2\nSETD^a.1.eq.peak.26^0.2'); // native edit mid-drag
  assert.equal(control(ui).gestureActive, false, 'owner stopped the stream');
  const reason = control(ui).reason || control(ui).status;
  assert.ok(ui.find('.mm-live-eq-status').textContent.includes(reason), 'owner status is never masked by a hint');
  press(cap, 'pointerup', { clientY: 40 }); ui.deskEcho(); ui.advance(2600);
  assert.equal(Number(gain.value), 0, 'points restart from the desk curve');
  assert.match(ui.find('.mm-live-eq-status').textContent, /restarted from the current curve/);
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view (F09-S07): a draw commit or confirmed reset re-anchors the points silently at 0 dB from the new curve', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const gain = stepGain(ui, 3); ui.deskEcho();
  const svg = ui.eq.section.querySelectorAll('*').find(node => node.tag === 'svg');
  ui.find('[data-eq-mode="draw"]').emit('click');
  press(svg, 'pointerdown', { clientX: 30, clientY: 40 }); press(svg, 'pointermove', { clientX: 130, clientY: 40 }); ui.advance(300); press(svg, 'pointerup', { clientX: 130, clientY: 40 }); ui.advance(300); ui.deskEcho();
  ui.find('[data-eq-mode="points"]').emit('click');
  assert.equal(Number(gain.value), 0, 'points restart at 0 dB after a draw');
  const coordinate = control(ui).eqCoordinate.map(auxEqPositionToDb), count = ui.writes().length;
  stepGain(ui, 1); const after = ui.writes().slice(count);
  assert.doesNotMatch(ui.find('.mm-live-eq-status').textContent, /Curve changed on the desk/, 'own draw is not an outside change');
  const unit = auxEqPointGain([{ x: 0.233, gainDb: 1, q: 0.5 }], auxEqCentreX(100));
  assert.ok(Math.abs(lastDb(after, 'a.0.eq.peak.7') - Math.min(15, coordinate[7] + unit)) < 1e-6, 'builds on the drawn curve');
  ui.deskEcho(); ui.find('[data-eq-reset]').emit('click'); ui.find('[data-eq-reset-confirm]').emit('click'); ui.deskEcho();
  assert.equal(Number(gain.value), 0, 'points restart at 0 dB after a reset');
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view (F09-S07): persistent points still saturate at ±15 dB per band and are never rejected whole', () => {
  const ui = uiFixture(); ui.eq.open(0);
  ui.receiver.receive('3:::' + Array.from({ length: 31 }, (_, band) => `SETD^a.0.eq.peak.${band}^${auxEqDbToPosition(10)}\nSETD^a.1.eq.peak.${band}^${auxEqDbToPosition(10)}`).join('\n'));
  stepGain(ui, 12); ui.deskEcho();
  ui.find('[data-eq-point="1"]').emit('click'); const gain = stepGain(ui, 12);
  assert.ok(Number(gain.value) > 0, 'point 2 still moves');
  assert.doesNotMatch(ui.find('.mm-live-eq-status').textContent, /rejected/);
  assert.ok(ui.writes().length > 0 && ui.writes().every(message => GEQ_WRITE.test(message) && Number(message.split('^')[2]) <= 1));
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view: handles are keyboard reachable; L/R readback is distinct and labelled; meter-only emits skip rendering', () => {
  const ui = uiFixture(); let checks = 0; const original = ui.session.canEditEqTarget;
  ui.eq.destroy(); ui.eq = mountEqControls({ root: ui.root, session: { ...ui.session, canEditEqTarget(index) { checks++; return original(index); } }, controller: { context: () => ui.context, selectAux: () => false, clearLevelContext() {}, subscribeContext(fn) { fn(ui.context); return () => {}; } }, window: new Node(ui.document) });
  ui.eq.open(0);
  const handle = ui.eq.section.querySelectorAll('[data-eq-handle]').find(node => node.dataset.eqHandle === '2');
  assert.equal(handle.attributes.tabindex, '0'); handle.emit('keydown', { key: 'Enter' });
  assert.equal(ui.eq.section.querySelectorAll('[data-eq-point]').find(node => node.dataset.eqPoint === '2').attributes['aria-pressed'], 'true'); assert.equal(ui.writes().length, 0);
  ui.receiver.receive('3:::SETD^a.1.eq.peak.4^0.7');
  const sides = ui.eq.section.querySelectorAll('[data-eq-side]');
  assert.equal(sides[1].attributes.visibility, 'visible'); assert.notEqual(EQ_SIDE_COLOURS[0], EQ_SIDE_COLOURS[1]);
  assert.equal(sides[0].children[0].attributes.stroke, EQ_SIDE_COLOURS[0]); assert.equal(sides[1].children[0].attributes.stroke, EQ_SIDE_COLOURS[1]); assert.equal(sides[1].children[2].attributes.fill, 'none');
  assert.equal(ui.eq.section.querySelectorAll('[data-eq-side-label]').map(node => node.textContent).join('|'), 'L · Output 1|R · Output 2');
  assert.match(ui.eq.section.querySelector('.mm-live-eq-readbacks').textContent, /L · Output 1.*R · Output 2/);
  const before = checks; ui.receiver.receive(VU); ui.advance(100); ui.advance(2000);
  assert.equal(checks, before, 'meter emits do not rebuild the GEQ view');
  ui.eq.destroy(); ui.session.disconnect();
});

test('processing receipts on the selected output during GEQ dispatch stop the remainder', () => {
  const app = fixture(); app.session.selectEqTarget(0); const token = app.session.beginEqGesture();
  app.writer.hook = () => { if (app.writes().length === 8) { app.writer.hook = null; app.receiver.receive('3:::SETD^a.0.eq.hpf.freq^0.1'); } };
  assert.equal(app.session.previewEqGesture(token, drawFrom(app, draw => { draw.fill(2); })), null);
  assert.equal(app.session.commitEqGesture(token), false); assert.equal(app.writes().length, 8, 'even an unchanged processing value');
  app.session.disconnect();
});

test('within the 2.5 s window after an unechoed GEQ write, losing the chain never re-arms from stale received bands; a matching echo clears it', () => {
  const sequences = {
    'no-move cancel': app => { const token = app.session.beginEqGesture(); assert.ok(token, 'retained chain continues from requested'); assert.equal(control(app).eqCoordinate[3], auxEqDbToPosition(4.9)); app.session.cancelEqGesture(); },
    'close and reopen': app => { app.session.closeEq(); app.session.selectEqTarget(0); },
    'mode/context cancel': app => { app.session.invalidateLevelContext(); app.session.selectEqTarget(0); },
    'native edit on another band': app => { app.receiver.receive('3:::SETD^a.0.eq.peak.20^0.55\nSETD^a.1.eq.peak.20^0.55'); },
  };
  for (const [name, loseChain] of Object.entries(sequences)) {
    const app = fixture(); app.session.selectEqTarget(0);
    let token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, draw => { draw[3] = 4.9; })); app.session.commitEqGesture(token);
    const first = app.writes(); assert.deepEqual(pathsOf(first), ['a.0.eq.peak.3', 'a.1.eq.peak.3']); app.advance(2000);
    loseChain(app);
    assert.equal(app.session.canEditEqTarget(0), false, name); assert.equal(app.session.beginEqGesture(), null, name);
    if (control(app).selected?.kind === 'geq') assert.match(control(app).reason, /for the desk to report the last EQ change/, name);
    assert.equal(app.session.resetEqBands(), false); assert.equal(app.writes().length, 2, `${name}: no stale band resent`);
    // Level controls on the same output are unaffected.
    app.session.selectLevelTarget({ kind: 'master', auxIndex: 0 }); assert.ok(app.session.beginLevelGesture(), `${name}: level unaffected`); app.session.cancelLevelGesture();
    app.session.selectEqTarget(0);
    app.receiver.receive('3:::' + first.slice(0, 1).map(message => message.slice(4)).join('\n')); assert.equal(app.session.canEditEqTarget(0), false, `${name}: partial echo keeps waiting`);
    app.receiver.receive('3:::' + first.slice(1).map(message => message.slice(4)).join('\n')); assert.equal(app.session.canEditEqTarget(0), true, `${name}: echo clears without Enable`);
    token = app.session.beginEqGesture(); assert.equal(control(app).eqCoordinate[3], auxEqDbToPosition(4.9));
    app.session.previewEqGesture(token, drawFrom(app, draw => { draw[10] = 1; })); app.session.commitEqGesture(token);
    assert.deepEqual(pathsOf(app.writes().slice(2)), ['a.0.eq.peak.10', 'a.1.eq.peak.10'], `${name}: untouched band 3 keeps the echoed +4.9 dB and is not resent`);
    app.session.disconnect();
  }
  // An explicit reconnect also refreshes the basis.
  const app = fixture(); app.session.selectEqTarget(0); const token = app.session.beginEqGesture();
  app.session.previewEqGesture(token, drawFrom(app, draw => { draw[3] = 4.9; })); app.session.commitEqGesture(token); app.session.cancelEqGesture();
  app.session.closeEq(); app.session.selectEqTarget(0); assert.equal(app.session.canEditEqTarget(0), false);
  app.session.connect('192.168.0.60'); for (const socket of app.sockets.slice(2)) { socket.readyState = 1; socket.onopen?.(); } app.sockets[3].receive(baseFrame());
  assert.equal(app.session.canEditEqTarget(0), true); app.session.disconnect();
});

test('desk-like rounded changed-only echoes clear sparse dispatch barriers; next gesture editable without reconnect; diagnostics count N/N', () => {
  const app = fixture(); app.session.selectEqTarget(0);
  let token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, draw => { draw[4] = 0.1; draw[9] = -0.1; })); app.session.commitEqGesture(token);
  assert.deepEqual(pathsOf(app.writes()), ['a.0.eq.peak.4', 'a.0.eq.peak.9', 'a.1.eq.peak.4', 'a.1.eq.peak.9']);
  assert.equal(control(app).authorized, 4); assert.equal(control(app).dispatched, 4);
  assert.equal(app.deskEcho(), 4, 'desk echoes the four changed paths, rounded');
  assert.equal(app.session.snapshot().eq.get('a.0.eq.peak.4'), Number(auxEqDbToPosition(0.1).toFixed(10)), 'rounded receipt is actual, distinct from the request');
  assert.match(control(app).status, /Observed matching values \(desk-rounded to 10 significant digits\)/); assert.doesNotMatch(control(app).status, /Waiting for complete/);
  token = app.session.beginEqGesture(); app.session.cancelEqGesture(); app.session.closeEq(); app.session.selectEqTarget(0);
  assert.equal(app.session.canEditEqTarget(0), true, 'no reconnect needed'); token = app.session.beginEqGesture(); assert.ok(token);
  assert.equal(control(app).eqCoordinate[4], Number(auxEqDbToPosition(0.1).toFixed(10)));
  const tiny = control(app).eqCoordinate.map(auxEqPositionToDb); tiny[12] += 1e-9;
  app.session.previewEqGesture(token, requestedDrawSamples(tiny)); app.session.commitEqGesture(token);
  assert.equal(app.writes().length, 4, 'a change that would not survive 10-decimal rounding is not sent'); assert.equal(control(app).outcome, 'no-op');
  token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, draw => { draw[20] = 2; })); app.session.commitEqGesture(token);
  app.advance(2500); assert.equal(control(app).outcome, 'sent-unverified'); assert.equal(control(app).authorized, 2);
  app.session.disconnect();
});

test('live entry wires GEQ only through the private control session; demo stays isolated; pure lease stays unwired', async () => {
  const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
  assert.match(await read('src/iem/session-core.js'), /aux-eq-protocol\.js/);
  assert.match(await read('src/iem/live-entry.js'), /mountEqControls/);
  for (const file of ['src/iem/demo-entry.js', 'src/iem/demo-view.js', 'src/iem/demo-provider.js', 'src/iem/demo-eq.js']) assert.doesNotMatch(await read(file), /eq-controls|session-core|aux-eq-|control-session/);
  for (const file of ['src/iem/eq-controls.js', 'src/iem/session-core.js', 'src/iem/live-entry.js']) assert.doesNotMatch(await read(file), /demo-|aux-eq-safety/);
  const pkg = JSON.parse(await read('package.json')); assert.equal(pkg.dependencies['dissect.extfs'], undefined);
});

// F09-S06 probe desk, modelled on live 2026-11-19 probes (writer + separate
// receive-only socket): writes to one path closer than 20 ms coalesce into one
// burst whose FINAL value is echoed only if it differs from the value the desk
// held before the burst (so a re-sent equal value and a reversal within 5 ms
// produce no echo at all; intermediates of a fast burst are never echoed).
function probeDesk(app) {
  const log = []; app.writer.hook = message => { if (message.startsWith('3:::SETD')) log.push({ message, at: app.now() }); };
  let flushed = 0;
  return {
    flush() {
      const byPath = new Map();
      for (const { message, at } of log.slice(flushed)) { const [, path, raw] = message.split('^'); (byPath.get(path) ?? byPath.set(path, []).get(path)).push({ value: Number(raw), at }); }
      flushed = log.length; const lines = [];
      for (const [path, list] of byPath) {
        let burst = [list[0]];
        const close = () => { const final = burst.at(-1).value; if (app.desk.get(path) !== final) { app.desk.set(path, final); lines.push(`SETD^${path}^${Number(final.toPrecision(10))}`); } };
        for (const item of list.slice(1)) { if (item.at - burst.at(-1).at < 20) burst.push(item); else { close(); burst = [item]; } }
        close();
      }
      if (lines.length) app.receiver.receive('3:::' + lines.join('\n'));
      return lines.length;
    },
  };
}

test('probe desk: a release reversal within 5 ms gets no echo; editing is blocked only for the 2.5 s window, then resumes from the desk-reported bands with no reconnect or replay', () => {
  const app = fixture(), desk = probeDesk(app); app.session.selectEqTarget(0);
  let token = app.session.beginEqGesture(); const start = control(app).eqCoordinate.map(auxEqPositionToDb);
  app.session.previewEqGesture(token, drawFrom(app, draw => { draw[3] = 3; })); assert.equal(app.writes().length, 2, 'leading live step');
  app.advance(3); // release 3 ms later returns band 3 to its received value
  app.session.previewEqGesture(token, requestedDrawSamples(start)); assert.equal(app.session.commitEqGesture(token), true);
  assert.deepEqual(app.writes().slice(2), ['3:::SETD^a.0.eq.peak.3^0.5', '3:::SETD^a.1.eq.peak.3^0.5']);
  assert.equal(desk.flush(), 0, 'the desk reports nothing for the reversal');
  app.session.closeEq(); app.session.selectEqTarget(0); // chain lost
  assert.equal(app.session.canEditEqTarget(0), false); assert.match(control(app).reason, /Waiting up to 2\.5 s for the desk to report the last EQ change/);
  app.advance(2499); assert.equal(app.session.canEditEqTarget(0), false, 'the window runs from the last write (t = 3 ms)');
  app.advance(1); assert.equal(app.session.canEditEqTarget(0), true, 'window expiry releases the received-basis barrier');
  assert.match(control(app).status, /did not report the last change within 2\.5 s; MixMate is using the desk.s reported values/);
  token = app.session.beginEqGesture(); assert.ok(token, 'no reconnect needed');
  assert.equal(control(app).eqCoordinate[3], 0.5, 'basis is the desk-reported band, never the unconfirmed request');
  assert.equal(app.writes().length, 4, 'nothing replayed');
  app.session.previewEqGesture(token, drawFrom(app, draw => { draw[8] = -2; })); app.session.commitEqGesture(token);
  assert.deepEqual(pathsOf(app.writes().slice(4)), ['a.0.eq.peak.8', 'a.1.eq.peak.8']);
  assert.equal(desk.flush(), 2); assert.equal(control(app).outcome, 'observed-match');
  app.session.disconnect();
});

test('probe desk: a write equal to the value the desk already holds gets no echo and never blocks later gestures', () => {
  const app = fixture(), desk = probeDesk(app); app.session.selectEqTarget(0);
  const value = auxEqDbToPosition(2); app.desk.set('a.0.eq.peak.6', value); app.desk.set('a.1.eq.peak.6', value); // desk already holds it (received state lags)
  let token = app.session.beginEqGesture(); app.session.previewEqGesture(token, drawFrom(app, draw => { draw[6] = 2; })); app.session.commitEqGesture(token);
  assert.equal(desk.flush(), 0, 'same-value resend: no echo');
  app.session.cancelEqGesture(); app.session.closeEq(); app.session.selectEqTarget(0);
  assert.equal(app.session.canEditEqTarget(0), false);
  app.advance(2500); assert.equal(app.session.canEditEqTarget(0), true);
  token = app.session.beginEqGesture(); assert.ok(token); app.session.cancelEqGesture();
  app.session.disconnect();
});

test('probe desk: coalesced intermediate echoes never count as native edits; a foreign band value still stops the stream', () => {
  const app = fixture(), desk = probeDesk(app); app.session.selectEqTarget(0);
  const token = app.session.beginEqGesture();
  app.session.previewEqGesture(token, drawFrom(app, draw => { draw[3] = 1; }));
  assert.equal(desk.flush(), 2); app.advance(120);
  app.session.previewEqGesture(token, drawFrom(app, draw => { draw[3] = 2; })); app.advance(5);
  app.session.previewEqGesture(token, drawFrom(app, draw => { draw[3] = 3; })); app.session.commitEqGesture(token);
  assert.equal(app.writes().length, 6);
  assert.equal(desk.flush(), 2, 'only the final value of the fast burst is echoed');
  assert.equal(control(app).outcome, 'observed-match', 'no native cancellation from the skipped intermediate');
  assert.equal(app.session.canEditEqTarget(0), true, 'resolved immediately, no window wait');
  const next = app.session.beginEqGesture(), later = drawFrom(app, draw => { draw[3] = 5; }); app.session.previewEqGesture(next, drawFrom(app, draw => { draw[3] = 4; }));
  app.receiver.receive('3:::SETD^a.0.eq.peak.3^0.11\nSETD^a.1.eq.peak.3^0.11'); // native app edit
  assert.equal(control(app).gestureActive, false); const count = app.writes().length;
  assert.equal(app.session.previewEqGesture(next, later), null); app.advance(500); assert.equal(app.writes().length, count, 'no further writes, no replay');
  app.session.disconnect();
});

test('points saturate at ±15 dB per band (live finding 2026-11-19): a band at +15 never blocks another point; saturated bands are exactly ±15; inward moves still work', () => {
  // Point 1 pushed until the 100 Hz region hits +15 (live repro), then point 2 near 1 kHz moves up.
  const basis = Array(31).fill(0), first = { x: auxEqCentreX(100), gainDb: 12, q: 0.5 }, idle = { x: 0.95, gainDb: 0, q: 0.5 };
  const pushed = requestedPointSamples([{ ...first, gainDb: 15 }, { x: auxEqCentreX(1000), gainDb: 0, q: 0.5 }, idle], basis).samples.map(sample => sample.gainDb);
  assert.equal(Math.max(...pushed), 15, 'bands the bump pushes past the range sit exactly at +15');
  const atLimit = pushed; // new basis after the desk applied point 1
  const second = requestedPointSamples([{ x: 0.05, gainDb: 0, q: 0.5 }, { x: auxEqCentreX(1000), gainDb: 6, q: 0.5 }, idle], atLimit).samples.map(sample => sample.gainDb);
  const k1 = AUX_EQ_CENTRES.indexOf(1000), k100 = AUX_EQ_CENTRES.indexOf(100);
  assert.ok(second[k1] - atLimit[k1] > 5.9, 'point 2 moves its own centre band up');
  assert.equal(second[k100], 15, 'a band already at +15 stays at +15 for a positive bump (one-sided)');
  assert.ok(second.every(value => value <= 15 && value >= -15)); assert.doesNotThrow(() => mapPoints([{ x: 0.05, gainDb: 0, q: 0.5 }, { x: auxEqCentreX(1000), gainDb: 6, q: 0.5 }, idle], atLimit), 'session range check passes');
  const inward = requestedPointSamples([{ x: auxEqCentreX(100), gainDb: -4, q: 0.5 }, { x: 0.5, gainDb: 0, q: 0.5 }, idle], atLimit).samples.map(sample => sample.gainDb);
  assert.ok(inward[k100] < 15 - 3.9, 'a saturated band can still move inward');
  const low = requestedPointSamples([{ x: 0.5, gainDb: -12, q: 0.5 }, { x: 0.5, gainDb: -12, q: 0.5 }, idle], Array(31).fill(-10)).samples.map(sample => sample.gainDb);
  assert.equal(Math.min(...low), -15, 'negative saturation is exactly -15');
  const untouched = requestedPointSamples([{ x: 0.05, gainDb: 3, q: 1 }, { x: 0.05, gainDb: 0, q: 1 }, { x: 0.05, gainDb: 0, q: 1 }], atLimit).samples.map(sample => sample.gainDb);
  assert.equal(untouched[30], atLimit[30], 'bands outside influence keep exact basis values');
  assert.equal(pointCentreGainLimit(14, 12), 1, 'the handle stops when its own centre reaches the limit'); assert.equal(pointCentreGainLimit(15, -5), -5, 'and can move inward'); assert.equal(pointCentreGainLimit(15, 3), 0);
});
const AUX_EQ_CENTRES = [20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
function mapPoints(points, basis) { return mapRequestedAuxEqCurve(requestedPointSamples(points, basis)); }

test('EQ view (live repro 2026-11-19): with 100 Hz bands at +15, dragging point 2 up still moves it; saturated bands stay exactly +15; x follows', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const centre = AUX_EQ_CENTRES.indexOf(100);
  ui.receiver.receive('3:::' + [centre - 1, centre, centre + 1].map(band => `SETD^a.0.eq.peak.${band}^1\nSETD^a.1.eq.peak.${band}^1`).join('\n'));
  const svg = ui.eq.section.querySelectorAll('*').find(node => node.tag === 'svg'), handle = ui.find('[data-eq-handle="1"]');
  const x = 28 + 0.566 * 100;
  press(handle.children[1], 'pointerdown', { clientX: x, clientY: 94 }); press(svg, 'pointermove', { clientX: x, clientY: 54 });
  const n = ui.writes().length; assert.ok(n > 0, 'point 2 moves although other bands sit at +15');
  assert.doesNotMatch(ui.find('.mm-live-eq-status').textContent, /Unchanged requested coordinate|rejected/);
  const byPath = new Map(ui.writes().map(message => [message.split('^')[1], Number(message.split('^')[2])]));
  for (const band of [centre - 1, centre, centre + 1]) assert.ok(!byPath.has(`a.0.eq.peak.${band}`) || byPath.get(`a.0.eq.peak.${band}`) === 1, 'saturated band stays exactly +15 dB');
  // Push far up: the handle's own centre stops at +15, x keeps following.
  ui.advance(200); press(svg, 'pointermove', { clientX: x, clientY: 0 }); ui.advance(200);
  const top = ui.writes().map(message => auxEqPositionToDb(Number(message.split('^')[2])));
  assert.ok(Math.max(...top) <= 15 && Math.max(...top) > 11.99, 'reaches the ±12 dB point Δ (within ±15)');
  const before = ui.writes().length; press(svg, 'pointermove', { clientX: x + 8, clientY: 0 }); ui.advance(300); // SETD budget gap for a wide linked step
  assert.ok(ui.writes().length > before, 'the handle still follows horizontally at the limit');
  assert.match(ui.find('[data-eq-handle="1"]').attributes['aria-label'], /Requested point 2/);
  press(svg, 'pointerup', { clientX: x + 8, clientY: 0 });
  assert.ok(ui.writes().every(message => GEQ_WRITE.test(message) && Number(message.split('^')[2]) <= 1));
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view: after a cancelled points gesture with no desk echo, points re-enable on their own at the 2.5 s window (no reconnect)', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const gain = ui.find('[data-eq-param="gain"]'), cap = gain.parentElement.querySelector('.mm-fader-hit');
  press(cap, 'pointerdown'); press(cap, 'pointermove', { clientY: 60 }); const n = ui.writes().length; assert.ok(n > 0);
  ui.find('[data-eq-mode="draw"]').emit('click'); ui.find('[data-eq-mode="points"]').emit('click'); // cancels; the desk never echoes
  assert.equal(gain.disabled, true); assert.match(ui.find('.mm-live-eq-status').textContent, /for the desk to report the last EQ change/);
  ui.advance(2500);
  assert.equal(gain.disabled, false, 'the window expiry renders the view without any other event');
  assert.match(ui.find('.mm-live-eq-status').textContent, /did not report the last change/);
  press(cap, 'pointerdown'); press(cap, 'pointermove', { clientY: 60 }); assert.ok(ui.writes().length > n, 'the next points gesture streams');
  press(cap, 'pointerup', { clientY: 60 });
  ui.eq.destroy(); ui.session.disconnect();
});

test('point centre limit is widened by the current gain: a step outward stops, never pulls the gain inward (re-review P2)', () => {
  // Reviewer repro: point 2 at +12 with a neighbour raising its centre to 15.58 dB (rest 3.58).
  const rest = 15.58 - 12;
  assert.equal(pointCentreGainLimit(rest, 12.5, 12), 12, 'GAIN up from an over-limit 12 stays at 12 (old code returned 11.42)');
  assert.equal(pointCentreGainLimit(rest, 11.8, 12), 11.8, 'moving inward still works');
  assert.equal(pointCentreGainLimit(rest, 13, 0), 15 - rest, 'from inside the range the outward limit applies as before');
  assert.equal(pointCentreGainLimit(-3.58, -12.5, -12), -12, 'same on the negative side');
  // Drag: the pointer can request at most +15 dB at the new x, so the widened range only matters for slider/keys.
  assert.equal(pointCentreGainLimit(10, 15 - 10, 12), 5, 'a drag into a higher-basis region follows the pointer');
});

test('EQ view: GAIN key steps rise monotonically to the centre limit; a drag into a raised region keeps following x', () => {
  const ui = uiFixture(); ui.eq.open(0);
  ui.receiver.receive('3:::' + Array.from({ length: 31 }, (_, band) => `SETD^a.0.eq.peak.${band}^${auxEqDbToPosition(band >= 17 ? 10 : 0)}\nSETD^a.1.eq.peak.${band}^${auxEqDbToPosition(band >= 17 ? 10 : 0)}`).join('\n'));
  ui.find('[data-eq-point="2"]').emit('click'); // point 3 sits in the +10 dB region
  const gain = ui.find('[data-eq-param="gain"]'), key = name => gain.emit('keydown', { key: name, target: gain, preventDefault() {} });
  gain.focus(); const seen = [];
  for (let n = 0; n < 12; n++) { key('PageUp'); seen.push(Number(gain.value)); ui.advance(300); }
  assert.ok(seen.every((value, index) => index === 0 || value >= seen[index - 1]), `monotonic: ${seen}`);
  assert.ok(Math.abs(seen.at(-1) - 5) < 1e-9, 'stops when its own centre reaches +15 dB');
  gain.emit('keyup', { key: 'PageUp', target: gain, preventDefault() {} });
  assert.ok(ui.writes().length > 0 && ui.writes().every(message => Number(message.split('^')[2]) <= 1));
  // Drag point 1 up over the 0 dB region, then sideways into the +10 dB region: x follows, nothing exceeds +15.
  const svg = ui.eq.section.querySelectorAll('*').find(node => node.tag === 'svg'), handle = ui.find('[data-eq-handle="0"]'), x0 = 28 + 0.233 * 100;
  ui.advance(3000); press(handle.children[1], 'pointerdown', { clientX: x0, clientY: 94 }); press(svg, 'pointermove', { clientX: x0, clientY: 0 }); ui.advance(300);
  const before = ui.writes().length; press(svg, 'pointermove', { clientX: 28 + 0.8 * 100, clientY: 0 }); ui.advance(300);
  assert.ok(ui.writes().length > before, 'handle follows horizontally');
  assert.match(handle.attributes['aria-label'], /Requested point 1, (6|7|8|9)\.?[0-9]* kHz|Requested point 1, [0-9.]+ kHz/);
  press(svg, 'pointerup', { clientX: 28 + 0.8 * 100, clientY: 0 });
  assert.ok(ui.writes().every(message => GEQ_WRITE.test(message) && Number(message.split('^')[2]) <= 1));
  ui.eq.destroy(); ui.session.disconnect();
});

// F09-S08: handle press selects/focuses; arrow keys move the selected point as
// a deliberate keyboard gesture; near-handle presses grab; edge handles stay grabbable.
const handleKey = (handle, type, key, extra = {}) => handle.emit(type, { key, target: handle, preventDefault() {}, ...extra });
const svgOf = ui => ui.eq.section.querySelectorAll('*').find(node => node.tag === 'svg');
const xOf = handle => Number(/([0-9.]+) (?:Hz|kHz)/.exec(handle.attributes['aria-label'])[1]) * (/kHz/.test(handle.attributes['aria-label']) ? 1000 : 1);
test('EQ graph (F09-S08): pressing a handle selects and focuses it; arrow keys move the point (x ±1/62, gain ±0.5 dB, Shift 4×) and commit on keyup', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const handle = ui.find('[data-eq-handle="2"]'), gain = ui.find('[data-eq-param="gain"]'), freq = ui.find('[data-eq-param="freq"]');
  press(handle.children[0], 'pointerdown', { clientX: 0, clientY: 0 }); press(svgOf(ui), 'pointerup', { clientX: 0, clientY: 0 });
  assert.equal(ui.document.activeElement, handle, 'the pressed handle takes focus'); assert.equal(ui.find('[data-eq-point="2"]').attributes['aria-pressed'], 'true', 'and is selected');
  assert.equal(ui.writes().length, 0, 'a press without movement writes nothing');
  const x0 = Number(freq.value);
  handleKey(handle, 'keydown', 'ArrowRight'); assert.ok(Math.abs(Number(freq.value) - (x0 + 1 / 62)) < 1e-12, 'Right moves x by 1/62');
  assert.equal(control(ui).gestureActive, true, 'a deliberate keyboard gesture'); assert.equal(ui.writes().length, 0, 'gain 0: no bump to move yet');
  handleKey(handle, 'keydown', 'ArrowUp'); assert.equal(Number(gain.value), 0.5); assert.ok(ui.writes().length > 0, 'Up streams the 0.5 dB bump live');
  ui.advance(300); handleKey(handle, 'keydown', 'ArrowUp', { shiftKey: true }); assert.equal(Number(gain.value), 2.5, 'Shift steps 4×');
  handleKey(handle, 'keydown', 'ArrowLeft', { shiftKey: true }); assert.ok(Math.abs(Number(freq.value) - (x0 + 1 / 62 - 4 / 62)) < 1e-12);
  handleKey(handle, 'keyup', 'ArrowLeft'); assert.equal(control(ui).gestureActive, false, 'keyup commits');
  const sent = ui.writes(); ui.deskEcho(); ui.advance(300);
  assert.ok(sent.every(message => GEQ_WRITE.test(message))); assert.equal(Number(gain.value), 2.5, 'the point keeps its gain');
  handleKey(handle, 'keydown', 'ArrowDown'); assert.equal(Number(gain.value), 2); handleKey(handle, 'keydown', 'Escape');
  assert.equal(control(ui).gestureActive, false, 'Escape cancels'); assert.equal(ui.eq.section.hidden, false, 'without closing the view');
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ graph (F09-S08): a mouse press within 24 px of a handle grabs the nearest one; farther presses still never begin', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const svg = svgOf(ui), handle = ui.find('[data-eq-handle="1"]'), cx = Number(handle.children[0].attributes.cx), cy = Number(handle.children[0].attributes.cy);
  assert.equal(handle.children[1].attributes.r, '20'); assert.equal(handle.children[0].attributes.r, '24', 'the handle owns an r=24 hit circle');
  press(svg, 'pointerdown', { pointerType: 'mouse', clientX: cx, clientY: cy - 30 }); assert.equal(control(ui).gestureActive, false, '30 px away: background, no gesture');
  press(svg, 'pointerup', { pointerType: 'mouse', clientX: cx, clientY: cy - 30 });
  press(svg, 'pointerdown', { pointerType: 'mouse', clientX: cx - 5, clientY: cy + 20 }); assert.equal(control(ui).gestureActive, true, '≈21 px away grabs point 2');
  assert.equal(ui.find('[data-eq-point="1"]').attributes['aria-pressed'], 'true'); assert.equal(ui.document.activeElement, handle);
  press(svg, 'pointermove', { clientX: cx - 5, clientY: cy - 40 }); assert.ok(ui.writes().length > 0, 'and drags it');
  press(svg, 'pointerup', { clientX: cx - 5, clientY: cy - 40 }); assert.equal(control(ui).gestureActive, false);
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ graph (F09-S08): point 1 pinned at +15 dB still moves horizontally, and its whole halo stays inside the viewBox', () => {
  const ui = uiFixture(); ui.eq.open(0);
  ui.receiver.receive('3:::' + Array.from({ length: 31 }, (_, band) => `SETD^a.0.eq.peak.${band}^${auxEqDbToPosition(5)}\nSETD^a.1.eq.peak.${band}^${auxEqDbToPosition(5)}`).join('\n'));
  const handle = ui.find('[data-eq-handle="0"]'), gain = ui.find('[data-eq-param="gain"]'); handle.focus();
  for (let n = 0; n < 6; n++) { handleKey(handle, 'keydown', 'ArrowUp', { shiftKey: true }); ui.advance(300); }
  assert.ok(Math.abs(Number(gain.value) - 10) < 1e-9, 'own centre stops at +15 dB (base +5)');
  const svg = svgOf(ui), [, , w, h] = svg.attributes.viewBox.split(' ').map(Number), halo = handle.children[1];
  assert.ok(Number(halo.attributes.cy) - 20 >= 0, `halo top inside (${halo.attributes.cy})`);
  const before = ui.writes().length, x = xOf(handle);
  handleKey(handle, 'keydown', 'ArrowRight', { shiftKey: true }); ui.advance(300);
  assert.ok(xOf(handle) > x, 'x follows at the limit'); assert.ok(ui.writes().length > before, 'the bump moves');
  assert.ok(Math.abs(Number(gain.value) - 10) < 1e-9);
  handleKey(handle, 'keyup', 'ArrowRight'); ui.deskEcho(); ui.advance(300);
  for (let n = 0; n < 70; n++) handleKey(handle, 'keydown', 'ArrowRight', { shiftKey: true });
  handleKey(handle, 'keyup', 'ArrowRight');
  assert.ok(Number(halo.attributes.cx) + 20 <= w && Number(halo.attributes.cy) + 20 <= h, 'at 20 kHz the halo stays inside on the right');
  assert.ok(ui.writes().every(message => GEQ_WRITE.test(message) && Number(message.split('^')[2]) <= 1));
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ view (F09-S07 follow-ups): a no-move release or Escape never leaves the anchor "interrupted"; the restart hint is visible in the status line and the head', () => {
  const ui = uiFixture(); ui.eq.open(0);
  stepGain(ui, 2); ui.deskEcho(); ui.advance(300);
  const handle = ui.find('[data-eq-handle="0"]'), svg = svgOf(ui);
  press(handle.children[1], 'pointerdown', { clientX: 0, clientY: 0 }); press(svg, 'pointerup', { clientX: 0, clientY: 0 }); // no-move release
  handle.focus(); handleKey(handle, 'keydown', 'ArrowUp'); handleKey(handle, 'keydown', 'Escape'); ui.deskEcho(); ui.advance(300); // leading step streamed, then Escape: the desk holds it
  assert.equal(ui.eq.section.hidden, false);
  const gain = ui.find('[data-eq-param="gain"]'); gain.focus(); keyOn(ui, gain, 'PageUp'); ui.advance(300); keyOn(ui, gain, 'Escape'); ui.deskEcho(); ui.advance(300); // same with a slider
  ui.receiver.receive('3:::SETD^a.0.eq.peak.27^0.3\nSETD^a.1.eq.peak.27^0.3');
  const status = ui.find('.mm-live-eq-status').textContent, hint = ui.find('.mm-live-eq-hint');
  assert.match(status, /^Curve changed on the desk; points restarted from the current curve\./, 'hint leads the status line');
  assert.doesNotMatch(status, /interrupted/);
  assert.equal(hint.hidden, false); assert.equal(hint.textContent, 'Curve changed on the desk; points restarted from the current curve.');
  stepGain(ui, 1); assert.equal(ui.find('.mm-live-eq-hint').hidden, true, 'a new deliberate gesture clears the hint');
  ui.eq.destroy(); ui.session.disconnect();
});

test('EQ graph (F09-S08 review): touch near a handle grabs only through its own r=24 hit circle; a background touch that pans (pointercancel) sends nothing', () => {
  const ui = uiFixture(); ui.eq.open(0);
  const svg = svgOf(ui), handle = ui.find('[data-eq-handle="1"]'), hit = handle.children[0], cx = Number(hit.attributes.cx), cy = Number(hit.attributes.cy);
  assert.equal(hit.attributes.r, '24'); assert.equal(hit.attributes.class, 'mm-eq-handle-hit'); assert.equal(hit.attributes.fill, 'transparent');
  for (const pointerType of ['touch', 'pen']) {
    press(svg, 'pointerdown', { pointerType, clientX: cx - 5, clientY: cy + 20 }); assert.equal(control(ui).gestureActive, false, `${pointerType} on the background near a handle: no gesture (the page may pan)`);
    press(svg, 'pointermove', { pointerType, clientX: cx - 5, clientY: cy + 12 }); press(svg, 'pointercancel', { pointerType });
    assert.equal(ui.writes().length, 0, 'a pan that ends in pointercancel never sends a leading write');
  }
  press(hit, 'pointerdown', { pointerType: 'touch', clientX: cx - 5, clientY: cy + 20 }); assert.equal(control(ui).gestureActive, true, 'the hit circle (touch-action:none) grabs');
  assert.equal(ui.find('[data-eq-point="1"]').attributes['aria-pressed'], 'true');
  press(svg, 'pointermove', { pointerType: 'touch', clientX: cx - 5, clientY: cy - 40 }); assert.ok(ui.writes().length > 0);
  press(svg, 'pointerup', { pointerType: 'touch', clientX: cx - 5, clientY: cy - 40 });
  ui.eq.destroy(); ui.session.disconnect();
});
