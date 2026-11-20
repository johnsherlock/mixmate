import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { parseIemStateFrame } from '../src/iem/protocol.js';
import { continuousFaderDB, continuousDBToFader, GROUP_FLOOR_SCALE, GROUP_MAX_DB, groupTravel } from '../src/iem/relative-groups.js';
import { FADER_FLOOR_POSITION, FADER_SCALE_FLOOR_DB, FADER_SCALE_MIN, FADER_SCALE_TOP_DB, positionDbText, positionToScale, scaleToPosition, dbToScale } from '../src/iem/fader-scale.js';
import { installFaderGestures } from '../src/iem/gestures.js';
import { mountLiveController } from '../src/iem/live-controller.js';
import { SettingsRepository, emptySettings } from '../src/settings.js';
import { Node, domFixture } from './helpers/fake-dom.js';

// F09-S06 fader feel: dB-linear display scale, group floor (-70 dB since F09-S07), bounded
// received-basis waits for dropped desk echoes, stable gesture geometry.
// Fake transports and fake timers only; no desk, browser or network.
const FRAME = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\n' +
  'SETD^i.0.stereoIndex^-1\nSETD^i.0.aux.0.value^0.35\nSETD^i.0.aux.1.value^0.35\nSETD^f.0.aux.0.value^0.65\nSETD^f.0.aux.1.value^0.65\nSETD^i.1.stereoIndex^-1\nSETD^i.1.aux.0.value^0.02\nSETD^i.1.aux.1.value^0.02\n' +
  Array.from({ length: 31 }, (_, band) => `SETD^a.0.eq.peak.${band}^0.5\nSETD^a.1.eq.peak.${band}^0.5`).join('\n') + '\nSETD^a.0.eq.bypass^0\nSETD^a.1.eq.bypass^0';
async function groups(members = ['i.0', 'f.0']) {
  const repository = new SettingsRepository({ indexedDB: undefined }), settings = emptySettings();
  settings.profiles = [{ id: 'rig', name: 'rig', address: '192.168.0.60', groups: [{ id: 'band', name: 'Band', members }], navigation: { mixId: null, view: 'groups', expandedGroupId: null } }];
  await repository.replace(settings);
  let clock = 0, next = 0; const jobs = new Map(), sockets = [];
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: clock + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval() { return ++next; }, clearInterval() {} };
  class Socket {
    readyState = 0; sent = [];
    constructor() { sockets.push(this); }
    send(message) { this.sent.push(message); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
  }
  const session = createAuxControlSession({ WebSocketClass: Socket, timers, now: () => clock, wallNow: () => clock, settingsRepository: repository });
  session.bindGroupProfile('rig'); session.connect('192.168.0.60');
  const [writer, receiver] = sockets; receiver.open(); writer.open(); receiver.receive(FRAME);
  const writes = () => writer.sent.filter(message => message.startsWith('3:::SETD'));
  return { session, writer, receiver, writes, jobs, repository,
    advance(ms) { clock += ms; for (const [id, job] of [...jobs].sort((a, b) => a[1].at - b[1].at)) if (job.at <= clock && jobs.has(id)) { jobs.delete(id); job.fn(); } },
    echo(from = 0) { const lines = writes().slice(from).map(message => message.slice(4)); if (lines.length) receiver.receive('3:::' + lines.join('\n')); } };
}
const sent = message => parseIemStateFrame(message)[0];
const control = app => app.session.snapshot().control;

test('dB-linear display scale: equal dB is equal distance above -70 dB (F09-S07), the bottom segment reaches -inf, and round trips are exact enough', () => {
  assert.equal(FADER_SCALE_MIN, GROUP_FLOOR_SCALE, 'group floor is the bottom of the scale (-inf, F09-S08)');
  assert.equal(positionToScale(1), FADER_SCALE_TOP_DB); assert.equal(scaleToPosition(FADER_SCALE_TOP_DB), 1);
  assert.equal(positionToScale(0), FADER_SCALE_MIN); assert.equal(scaleToPosition(FADER_SCALE_MIN), 0, 'an individual fader reaches desk position 0 (-inf)');
  assert.ok(Math.abs(positionToScale(FADER_FLOOR_POSITION) - FADER_SCALE_FLOOR_DB) < 1e-9, 'continuous at the floor');
  for (const db of [9.5, 1.3, 0, -2.4, -11.6, -26.8, -38.2, -52.9, -59.9, -64.2, -69.9]) {
    const position = continuousDBToFader(db);
    assert.ok(Math.abs(positionToScale(position) - db) < 1e-9, `scale is dB above the floor (${db})`);
    assert.ok(Math.abs(scaleToPosition(positionToScale(position)) - position) < 1e-12, `round trip (${db})`);
  }
  // Equal dB = equal travel, unlike the raw position law (0.8 -> +1.3, 0.3 -> -26.8).
  const loud = continuousDBToFader(0), quiet = continuousDBToFader(-30);
  const down = 6, loudMove = positionToScale(continuousDBToFader(-down)) - positionToScale(loud), quietMove = positionToScale(continuousDBToFader(-30 - down)) - positionToScale(quiet);
  assert.ok(Math.abs(loudMove - quietMove) < 1e-9); assert.ok(Math.abs((continuousDBToFader(-down) - loud) - (continuousDBToFader(-36) - quiet)) > 0.05, 'raw positions would differ a lot');
  assert.equal(FADER_SCALE_FLOOR_DB, -70); assert.equal(FADER_SCALE_MIN, -75); assert.ok(FADER_FLOOR_POSITION > 0.02 && FADER_FLOOR_POSITION < 0.03, 'the -70 dB floor is a valid desk position above 0');
  for (const position of [0.001, 0.01, 0.02, 0.025]) {
    const scale = positionToScale(position);
    assert.ok(scale > FADER_SCALE_MIN && scale < FADER_SCALE_FLOOR_DB, `received ${continuousFaderDB(position).toFixed(1)} dB displays in the bottom segment`);
    assert.ok(Math.abs(scaleToPosition(scale) - position) < 1e-15, 'display never rewrites the received position');
  }
  assert.equal(dbToScale(-Infinity), FADER_SCALE_MIN); assert.equal(dbToScale(20), FADER_SCALE_TOP_DB); assert.equal(dbToScale(-12), -12);
  assert.equal(positionDbText(0), '−∞ dB'); assert.equal(positionDbText(1), '+10.0 dB'); assert.equal(positionDbText(0.5523456789012345), `${continuousFaderDB(0.5523456789012345).toFixed(1)} dB`);
  assert.throws(() => positionToScale(1.2)); assert.throws(() => scaleToPosition(Number.NaN));
});

test('group (F09-S08): one common scale delta, equal dB above -70 dB, the quietest member travels to -inf (position 0); a member at -inf stops downward travel but can rise', async () => {
  const app = await groups();
  try {
    const anchor = { members: [0.35, 0.65].map(value => ({ scale: positionToScale(value) })) };
    assert.equal(GROUP_FLOOR_SCALE, -75); assert.equal(groupTravel(anchor).lower, -75 - positionToScale(0.35));
    assert.equal(app.session.selectGroupTarget('band', 0), true);
    let token = app.session.beginLevelGesture();
    assert.ok(Math.abs(positionToScale(control(app).groupReference) - continuousFaderDB(0.65)) < 1e-9, 'cap starts at the loudest member on the dB scale');
    // A 6 dB scale move down from the loudest member: every member moves 6 dB = the same distance.
    const reference = positionToScale(control(app).groupReference);
    const returned = app.session.previewLevelGesture(token, scaleToPosition(reference - 6));
    assert.ok(Math.abs(positionToScale(returned) - (reference - 6)) < 1e-9);
    const step = app.writes().map(sent);
    assert.equal(step.length, 4);
    for (const command of step) {
      const before = command.path.startsWith('i.0') ? 0.35 : 0.65;
      assert.ok(Math.abs((positionToScale(command.value) - positionToScale(before)) + 6) < 1e-9, `${command.path} moves the same scale distance`);
    }
    // Full-down (scale minimum / Home): quietest reaches position 0 (-inf); the loudest keeps its on-screen gap.
    app.advance(60); app.session.previewLevelGesture(token, scaleToPosition(FADER_SCALE_MIN)); app.advance(60);
    const bottom = app.writes().slice(4).map(sent);
    assert.equal(bottom.length, 4); assert.equal(Math.min(...bottom.map(command => command.value)), 0, 'the quietest member reaches -inf');
    const quietest = Math.min(...bottom.map(command => positionToScale(command.value))), loudest = Math.max(...bottom.map(command => positionToScale(command.value)));
    assert.ok(Math.abs(quietest - GROUP_FLOOR_SCALE) < 1e-9, 'quietest exactly at the bottom of the scale');
    assert.ok(Math.abs((loudest - quietest) - (positionToScale(0.65) - positionToScale(0.35))) < 1e-9, 'on-screen gap preserved');
    app.session.commitLevelGesture(token, scaleToPosition(FADER_SCALE_MIN)); app.echo();
    // Top: loudest exactly at desk position 1.
    token = app.session.beginLevelGesture(); assert.ok(token);
    app.session.previewLevelGesture(token, 1);
    const top = app.writes().slice(8).map(sent); assert.equal(Math.max(...top.map(command => command.value)), 1);
    app.session.commitLevelGesture(token, 1);
  } finally { app.session.disconnect(); await app.repository.close(); }
  const below = await groups(['i.0', 'i.1']);
  try {
    below.session.selectGroupTarget('band', 0); const token = below.session.beginLevelGesture(), start = control(below).groupReference;
    const returned = below.session.previewLevelGesture(token, 0);
    assert.ok(returned < start, 'a member at about -73 dB (bottom segment) still travels down (F09-S08)');
    below.advance(100); const sentDown = below.writes().map(sent); assert.equal(Math.min(...sentDown.map(command => command.value)), 0, 'it stops at -inf');
    below.session.cancelLevelGesture();
  } finally { below.session.disconnect(); await below.repository.close(); }
});

test('group: an unechoed write blocks re-anchoring only for the bounded 2.5 s window, then editing resumes from received actual without reconnect; a foreign value still stops a stream', async () => {
  const app = await groups();
  try {
    app.session.selectGroupTarget('band', 0);
    let token = app.session.beginLevelGesture(); const reference = positionToScale(control(app).groupReference);
    app.session.previewLevelGesture(token, scaleToPosition(reference - 3)); app.session.commitLevelGesture(token, 0);
    const count = app.writes().length; assert.equal(count, 4);
    // The desk drops every echo (as after a same-value resend or a sub-5 ms reversal).
    assert.equal(app.session.beginLevelGesture(), null); assert.match(control(app).reason, /Waiting up to 2\.5 s for the desk to report the last group change/);
    app.advance(2499); assert.equal(app.session.canEditLevelTarget({ kind: 'group', groupId: 'band', auxIndex: 0 }), false);
    let emitted = 0; const stop = app.session.subscribe((_, kind) => { if (kind === 'controls') emitted++; }); emitted = 0;
    app.advance(1); assert.ok(emitted > 0, 'the window expiry re-renders on its own');
    stop();
    assert.equal(app.session.canEditLevelTarget({ kind: 'group', groupId: 'band', auxIndex: 0 }), true);
    assert.match(control(app).status, /did not report the last change within 2\.5 s; MixMate is using the desk.s reported values/);
    token = app.session.beginLevelGesture(); assert.ok(token, 'no reconnect needed');
    assert.ok(Math.abs(positionToScale(control(app).groupReference) - continuousFaderDB(0.65)) < 1e-9, 'the new anchor is the received actual, never the unconfirmed request');
    assert.equal(app.writes().length, count, 'nothing replayed');
    app.session.previewLevelGesture(token, scaleToPosition(reference - 1)); assert.equal(app.writes().length, count + 4);
    app.receiver.receive('3:::SETD^f.0.aux.0.value^0.2'); // native edit on a member
    assert.equal(control(app).gestureActive, false, 'a non-own changed value stops the stream immediately');
    app.session.previewLevelGesture(token, scaleToPosition(reference - 2)); app.advance(500); assert.equal(app.writes().length, count + 4, 'no further writes, no replay');
  } finally { app.session.disconnect(); await app.repository.close(); }
});

test('gestures: pointer travel is measured once per drag, so a redraw cannot rescale the mapping; arrow keys use the 0.5 dB key step', () => {
  const document = domFixture().document, root = new Node(document), wrap = document.createElement('div'); wrap.className = 'mm-fader-control';
  const input = document.createElement('input'); input.className = 'mm-vertical'; input.min = String(FADER_SCALE_MIN); input.max = '10'; input.step = 'any'; input.dataset.gestureStep = '0.1'; input.dataset.keyStep = '0.5'; input.dataset.channel = ''; input.value = '-20';
  const cap = document.createElement('span'); cap.className = 'mm-fader-hit'; cap.style = {}; wrap.append(input, cap); root.append(wrap);
  let height = 200; input.getBoundingClientRect = () => ({ width: 42, height, top: 0, bottom: height, left: 0 });
  const previews = [], gestures = installFaderGestures(root, { onBegin: () => ({}), onPreview: (_, __, value) => { previews.push(value); return value; }, onCommit() {}, onCancel() {} });
  const event = y => ({ target: { closest: selector => selector === '.mm-fader-control' ? wrap : selector === '.mm-fader-hit' ? cap : null }, pointerId: 1, button: 0, clientX: 20, clientY: y, preventDefault() {} });
  try {
    root.emit('pointerdown', event(200)); root.emit('pointermove', event(180));
    const first = previews.at(-1);
    height = 120; // e.g. a status line appearing mid-drag would previously shrink the travel
    root.emit('pointermove', event(160));
    assert.ok(Math.abs((previews.at(-1) - -20) - 2 * (first - -20)) < 0.11, 'same pointer delta per pixel throughout the drag');
    root.emit('pointerup', event(160));
    input.value = '-20'; root.emit('keydown', { target: input, key: 'ArrowUp', preventDefault() {} });
    assert.equal(previews.at(-1), -19.5); root.emit('keyup', { target: input, key: 'ArrowUp', preventDefault() {} });
  } finally { gestures.destroy(); }
});

test('controller coalesces session redraws to one per animation frame during an owned gesture and renders immediately when it ends', async () => {
  let listener, current = { phase: 'live', detail: '', observations: new Map(), control: { gestureActive: false, selected: null } };
  const session = { subscribe(fn) { listener = fn; fn(current); return () => {}; }, snapshot: () => current, disconnect() {}, invalidateLevelContext() {}, bindGroupOwner() {} };
  class Events { handlers = new Map(); addEventListener(type, fn) { this.handlers.set(type, [...this.handlers.get(type) || [], fn]); } removeEventListener() {} }
  const field = value => Object.assign(new Events(), { value });
  const ui = { address: field('192.168.0.60'), profile: field(''), connect: field(''), disconnect: field(''), note: field(''), settings: field(''), form: new Events(), navigation: [], close() {}, profiles() {} };
  const settings = emptySettings(), repository = { initialize: async () => ({ settings, status: { mode: 'memory' } }), snapshot: () => ({ settings, status: { mode: 'memory' } }) };
  const view = { renders: 0, render() { this.renders++; }, renderMeters() {}, preferences() {}, destroy() {} };
  const frames = []; const window = Object.assign(new Events(), { requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame: id => { frames[id - 1] = null; } });
  const controller = mountLiveController({ session, repository, view, ui, document: Object.assign(new Events(), { hidden: false }), window }); await controller.ready;
  const before = view.renders;
  current = { ...current, control: { gestureActive: true, selected: null, status: 'step' } };
  for (let n = 0; n < 5; n++) listener(current, n % 2 ? 'state' : 'controls');
  assert.equal(view.renders, before, 'no synchronous full render per live step/echo'); assert.equal(frames.filter(Boolean).length, 1, 'one frame requested');
  frames.shift()(); assert.equal(view.renders, before + 1);
  listener(current, 'controls'); assert.equal(frames.filter(Boolean).length, 1);
  current = { ...current, control: { gestureActive: false, selected: null, status: 'done' } };
  listener(current, 'controls'); assert.equal(view.renders, before + 2, 'gesture end renders now'); assert.equal(frames.filter(Boolean).length, 0, 'pending frame cancelled');
  controller.destroy();
});

test('stable strip/header geometry rules (F09-S07): no per-strip state line, Pan alone fills the bottom row, single-line header/footer status', async () => {
  const css = await readFile(new URL('../src/iem/iem.css', import.meta.url), 'utf8'), block = css.slice(css.indexOf('/* F09-S07 stable geometry'));
  assert.ok(block.length > 100);
  assert.doesNotMatch(css, /mm-live-strip-state/, 'the removed strip state overlay leaves no CSS behind');
  assert.match(css, /#mixmate-iem-concept\[data-mode="live"\] \.mm-strip \{position:relative;padding-bottom:24px;isolation:isolate\}/, 'each live strip is its own stacking context: inner z-indexes cannot paint over the sticky expanded-group strip');
  assert.match(css, /\.mm-strip-scroll\.mm-expanded > \.mm-group \{\s*position: sticky;\s*left: 0;\s*z-index: 1;/, 'the sticky group strip stays above scrolled member strips');
  assert.match(css, /#mixmate-iem-concept\[data-mode="live"\] \.mm-strip > \.mm-pan-button \{position:absolute;inset:auto 3px 2px 3px;width:auto;/, 'without Details, Pan spans the strip footer like the mockup');
  assert.match(block, /\[data-debug="true"\] \.mm-strip > \.mm-pan-button,[^{]*\{right:auto;width:calc\(100% - 58px\)\}/, 'only ?debug makes room for Details');
  assert.match(block, /\.mm-strip \.mm-fader-control\{z-index:2\}/);
  assert.match(block, /\[data-compact="true"\] \.mm-ruler span\[data-tick="off"\]\{display:none\}/, 'compact drops the −∞ label rather than overlap −70');
  assert.match(block, /\.mm-ruler\{container:mm-ruler \/ size\}/);
  assert.match(block, /@container mm-ruler \(max-height: 190px\)\{[^}]*span\[data-tick="off"\]\{display:none\}\}/, 'short strips drop −∞ first');
  assert.match(block, /@container mm-ruler \(max-height: 95px\)\{[^}]*span\[data-tick="-70"\]\{display:none\}\}/, 'then −70');
  assert.match(block, /\.mm-group > \.mm-value\{container:mm-delta \/ inline-size;min-width:0\}/);
  assert.match(block, /@container mm-delta \(max-width: 104px\)\{[^}]*\.mm-delta-prefix\{display:none\}\}/, 'narrow group readouts drop the prefix at any size (1280×800 finding)');
  assert.match(block, /\.mm-sr-only\{position:absolute;width:1px;height:1px;/);
  assert.match(block, /\[data-compact="true"\] \.mm-group > \.mm-value \.mm-delta-prefix\{display:none\}/, 'compact group Δ readout drops its prefix instead of truncating');
  assert.match(block, /\.mm-preview \.mm-feedback\{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
  assert.match(block, /\.mm-bottom \.mm-dirty\{flex:1 1 0;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
});
