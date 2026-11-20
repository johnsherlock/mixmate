import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutoConnect, AUTO_CONNECT_ATTEMPT_MS } from '../src/iem/auto-connect.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { mountLiveController, AUTO_RECONNECT_MIN_INTERVAL_MS } from '../src/iem/live-controller.js';
import { parseIemStateFrame, IEM_RECEIVE_LIMITS } from '../src/iem/protocol.js';
import { SettingsRepository, emptySettings, KNOWN_ADDRESS_LIMIT } from '../src/settings.js';

// F02-S05 automatic connection and snapshot-name receipt. Fake transports and
// timers only; no desk, browser or network.
const ALLOWED = new Set(['3:::INIT', '3:::ALIVE', '2::']);
const LIVE = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.0.mix^0.5\nSETD^a.0.stereoIndex^-1\nSETS^var.currentSnapshot^IMGL FIBBERS';
class Clock {
  now = 0; next = 1; jobs = new Map();
  setTimeout = (callback, delay = 0) => this.add(callback, delay, false);
  setInterval = (callback, delay) => this.add(callback, delay, true);
  clearTimeout = id => this.jobs.delete(id);
  clearInterval = id => this.jobs.delete(id);
  add(callback, delay, repeat) { const id = this.next++; this.jobs.set(id, { callback, delay, repeat, at: this.now + delay }); return id; }
  tick(amount = 0) {
    const end = this.now + amount;
    while (true) {
      const found = [...this.jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!found) break;
      const [id, job] = found; this.now = job.at;
      if (job.repeat) job.at += job.delay; else this.jobs.delete(id);
      job.callback();
    }
    this.now = end;
  }
}
class Events {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, [...this.handlers.get(type) || [], fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item !== fn)); }
  emit(type, additions = {}) { for (const fn of [...this.handlers.get(type) || []]) fn({ preventDefault() {}, ...additions }); }
}
const field = value => Object.assign(new Events(), { value, textContent: '', disabled: false, hidden: false, setCustomValidity(text) { this.validity = text; }, reportValidity() {} });
const flush = () => new Promise(resolve => setImmediate(resolve));

async function liveApp({ known = ['10.0.0.1', '10.0.0.2'], autoConnect = true, settings: seeded, control = false, dialogOwner } = {}) {
  const sockets = [], timers = new Clock();
  class FakeSocket {
    readyState = 0; sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(message) { assert.ok(ALLOWED.has(message), 'no new outbound message'); this.sent.push(message); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
    drop() { this.readyState = 3; this.onclose?.(); }
  }
  const options = { WebSocketClass: FakeSocket, timers, now: () => timers.now, wallNow: () => timers.now, settingsRepository: undefined };
  const session = control ? createAuxControlSession(options) : createReadOnlySession(options);
  const repository = new SettingsRepository({ indexedDB: undefined }), settings = seeded || emptySettings();
  if (!seeded) settings.knownAddresses = known;
  await repository.replace(settings);
  const openListeners = new Set();
  const ui = {
    address: field('192.168.0.60'), connect: field(''), disconnect: field(''), dialogDisconnect: field(''), note: field(''), settings: field(''), feedback: field(''), form: new Events(), navigation: [],
    shown: 0, open: false, dialogOwner, lease: null,
    show() { if (dialogOwner) { this.lease = dialogOwner.claim('connection', () => { this.open = false; }); } this.shown++; const was = this.open; this.open = true; if (!was) for (const listener of openListeners) listener(); },
    close() { this.open = false; if (dialogOwner) dialogOwner.release(this.lease); }, visible() { return this.open; },
    onOpen(listener) { openListeners.add(listener); return () => openListeners.delete(listener); },
    knownAddresses(list) { this.known = [...list]; }, connected() {},
  };
  const view = { renders: [], render(model) { this.renders.push(model); }, preferences() {}, snapshotName(text) { this.snapshot = text; }, destroy() {} };
  const document = Object.assign(new Events(), { hidden: false }), window = new Events();
  const controller = mountLiveController({ session, repository, view, ui, document, window, timers, now: () => timers.now, autoConnect, createID: (() => { let n = 0; return () => `rig-${++n}`; })() });
  await controller.ready;
  return { sockets, timers, session, repository, ui, view, document, window, controller,
    async close() { controller.destroy(); await repository.close(); } };
}

test('pure pass: ordered attempts, bounded per-attempt timeout, success only on readiness, single pass and no overlap', () => {
  const timers = new Clock(), calls = [], results = [];
  let auto;
  auto = createAutoConnect({ timers, connect: address => { calls.push(['connect', address]); return true; }, disconnect: () => calls.push(['disconnect']),
    onSuccess: value => results.push(['success', value.address]), onExhausted: value => results.push(['exhausted', value.tried]) });
  assert.equal(auto.start(['10.0.0.1', '10.0.0.2', '10.0.0.1', '10.0.0.3']), true);
  assert.equal(auto.start(['10.9.9.9']), false, 'never overlaps a running pass');
  assert.deepEqual(calls, [['connect', '10.0.0.1']]);
  auto.observe('connecting'); auto.observe('connected'); auto.observe('partial');
  timers.tick(AUTO_CONNECT_ATTEMPT_MS - 1); assert.deepEqual(calls, [['connect', '10.0.0.1']], 'socket-open is not readiness');
  timers.tick(1); assert.deepEqual(calls.slice(1), [['disconnect'], ['connect', '10.0.0.2']]);
  auto.observe('disconnected'); auto.observe('error'); timers.tick(0);
  assert.deepEqual(calls.at(-1), ['connect', '10.0.0.3'], 'a failure advances exactly once, after the emitting call stack; duplicates are skipped');
  auto.observe('live');
  assert.deepEqual(results, [['success', '10.0.0.3']]); assert.equal(auto.running(), false);
  timers.tick(60000); assert.equal(calls.filter(([kind]) => kind === 'connect').length, 3, 'no retry loop after the pass ends');
  // Exhaustion, and a connect that refuses synchronously advances once.
  const refused = [], ended = [];
  const other = createAutoConnect({ timers, connect: address => { refused.push(address); return false; }, disconnect() {}, onExhausted: value => ended.push(value.tried) });
  other.start(['10.0.0.1', '10.0.0.2']); timers.tick(0); timers.tick(0);
  assert.deepEqual(refused, ['10.0.0.1', '10.0.0.2']); assert.deepEqual(ended, [2]);
  const empty = []; createAutoConnect({ timers, connect() { throw Error('never'); }, disconnect() {}, onExhausted: value => empty.push(value.tried) }).start([]);
  assert.deepEqual(empty, [0]);
  // Cancel stops the pass and its timers.
  const cancelled = []; const third = createAutoConnect({ timers, connect: address => { cancelled.push(address); return true; }, disconnect() {} });
  third.start(['10.0.0.1', '10.0.0.2']); assert.equal(third.cancel(), true); timers.tick(60000);
  assert.deepEqual(cancelled, ['10.0.0.1']); assert.equal(third.running(), false);
});

test('app open tries known addresses most recent first, needs received Ui24 readiness, then promotes the address that worked', async () => {
  const app = await liveApp();
  try {
    assert.equal(app.sockets.length, 1); assert.equal(app.sockets[0].url, 'ws://10.0.0.1/');
    assert.match(app.view.renders.at(-1).status, /Connecting automatically to 10\.0\.0\.1 \(1 of 2\)/);
    app.sockets[0].open(); // Socket-open alone is not success.
    app.timers.tick(AUTO_CONNECT_ATTEMPT_MS);
    assert.equal(app.sockets[0].readyState, 3); assert.equal(app.sockets.length, 2); assert.equal(app.sockets[1].url, 'ws://10.0.0.2/');
    app.sockets[1].open(); app.sockets[1].receive(LIVE);
    assert.equal(app.session.snapshot().phase, 'live'); assert.equal(app.controller.autoConnecting(), false);
    assert.equal(app.view.snapshot, 'IMGL FIBBERS'); assert.equal(app.ui.shown, 0);
    await app.controller.whenRigIdle(); await flush();
    const settings = app.repository.snapshot().settings;
    assert.deepEqual(settings.knownAddresses, ['10.0.0.2', '10.0.0.1']);
    // The snapshot rig is created with empty groups and becomes the last-used rig.
    assert.deepEqual(settings.profiles.map(rig => [rig.name, rig.groups.length]), [['IMGL FIBBERS', 0]]);
    assert.equal(settings.selectedProfileId, app.controller.context().profileId);
    app.timers.tick(20000); assert.equal(app.sockets.length, 2, 'no probing while connected');
    assert.ok(app.sockets.every(socket => socket.sent.every(message => ALLOWED.has(message))));
  } finally { await app.close(); }
});

test('when every known address fails, or none is known, one pass ends by opening the Connect dialog', async () => {
  const app = await liveApp();
  try {
    app.sockets[0].drop(); app.timers.tick(0); // Immediate failure advances.
    assert.equal(app.sockets.length, 2);
    app.timers.tick(AUTO_CONNECT_ATTEMPT_MS); // Slow second attempt times out.
    assert.equal(app.ui.shown, 1); assert.match(app.ui.feedback.textContent, /No known desk address answered \(2 tried\)/);
    app.timers.tick(120000); assert.equal(app.sockets.length, 2, 'one pass per trigger');
  } finally { await app.close(); }
  const none = await liveApp({ known: [] });
  try { assert.equal(none.sockets.length, 0); assert.equal(none.ui.shown, 1); assert.match(none.ui.feedback.textContent, /Enter the mixer address/); }
  finally { await none.close(); }
});

test('known addresses are promoted on manual success, deduplicated and capped', async () => {
  const known = Array.from({ length: KNOWN_ADDRESS_LIMIT }, (_, n) => `10.0.1.${n + 1}`);
  const app = await liveApp({ known, autoConnect: false });
  try {
    assert.equal(app.sockets.length, 0, 'no automatic connection unless enabled');
    assert.equal(app.ui.address.value, '10.0.1.1'); assert.deepEqual(app.ui.known, known);
    app.ui.address.value = '192.168.5.5'; app.ui.address.emit('input'); app.ui.form.emit('submit');
    app.sockets[0].open(); app.sockets[0].receive(LIVE);
    await app.controller.whenRigIdle(); await flush();
    const list = app.repository.snapshot().settings.knownAddresses;
    assert.equal(list.length, KNOWN_ADDRESS_LIMIT); assert.equal(list[0], '192.168.5.5'); assert.ok(!list.includes(`10.0.1.${KNOWN_ADDRESS_LIMIT}`));
    assert.deepEqual(app.ui.known, list);
    // Socket-open without readiness never records an address.
    app.ui.disconnect.emit('click'); app.ui.address.value = '192.168.6.6'; app.ui.form.emit('submit'); app.sockets[1].open();
    await flush(); assert.ok(!app.repository.snapshot().settings.knownAddresses.includes('192.168.6.6'));
  } finally { await app.close(); }
});

test('an explicit Disconnect suppresses every automatic trigger until an explicit Connect', async () => {
  const app = await liveApp();
  try {
    app.sockets[0].open(); app.sockets[0].receive(LIVE);
    app.ui.disconnect.emit('click');
    assert.equal(app.sockets[0].readyState, 3); assert.match(app.ui.feedback.textContent, /Automatic connection is off/);
    app.document.hidden = true; app.document.emit('visibilitychange'); app.document.hidden = false; app.document.emit('visibilitychange');
    app.window.emit('online'); app.window.emit('pageshow', { persisted: true }); app.timers.tick(60000);
    assert.equal(app.sockets.length, 1, 'no automatic reconnection after an explicit Disconnect');
    // An explicit Connect re-enables automatic recovery from a later drop.
    app.ui.address.value = '10.0.0.2'; app.ui.form.emit('submit');
    const manual = app.sockets[1]; manual.open(); manual.receive(LIVE); await app.controller.whenRigIdle(); await flush();
    app.timers.tick(AUTO_RECONNECT_MIN_INTERVAL_MS + 1);
    manual.drop(); app.timers.tick(0);
    assert.equal(app.sockets.length, 3); assert.equal(app.sockets[2].url, 'ws://10.0.0.2/', 'the promoted address is tried first');
  } finally { await app.close(); }
});

test('returning from background, coming online or an unexpected drop each start one pass; a quick repeat drop opens the dialog instead', async () => {
  const app = await liveApp();
  try {
    app.sockets[0].open(); app.sockets[0].receive(LIVE); await app.controller.whenRigIdle();
    app.document.hidden = true; app.document.emit('visibilitychange');
    assert.equal(app.sockets[0].readyState, 3); assert.equal(app.view.snapshot, 'Unavailable', 'hiding clears received state including the snapshot name');
    app.document.hidden = false; app.document.emit('visibilitychange');
    assert.equal(app.sockets.length, 2); assert.equal(app.sockets[1].url, 'ws://10.0.0.1/');
    app.window.emit('online'); assert.equal(app.sockets.length, 2, 'never overlaps the running pass');
    app.sockets[1].open(); app.sockets[1].receive(LIVE);
    app.window.emit('online'); app.window.emit('pageshow', { persisted: true }); assert.equal(app.sockets.length, 2, 'no pass while connected');
    // A drop right after an automatic reconnection does not loop.
    app.sockets[1].drop(); app.timers.tick(0);
    assert.equal(app.sockets.length, 2); assert.equal(app.ui.shown, 1); assert.match(app.ui.feedback.textContent, /dropped again soon/);
    // Online while the Connect dialog is in use starts nothing.
    app.window.emit('online'); assert.equal(app.sockets.length, 2);
    app.ui.close(); app.timers.tick(AUTO_RECONNECT_MIN_INTERVAL_MS);
    app.window.emit('online'); assert.equal(app.sockets.length, 3);
    app.sockets[2].open(); app.sockets[2].receive(LIVE);
    app.timers.tick(AUTO_RECONNECT_MIN_INTERVAL_MS + 1); app.sockets[2].drop(); app.timers.tick(0);
    assert.equal(app.sockets.length, 4, 'a later unexpected drop starts one pass');
  } finally { await app.close(); }
});

test('opening the Connect dialog or an explicit Connect cancels an in-flight pass; attempts never overlap', async () => {
  const app = await liveApp();
  try {
    assert.equal(app.controller.autoConnecting(), true);
    app.ui.show();
    assert.equal(app.controller.autoConnecting(), false); assert.equal(app.sockets[0].readyState, 3, 'the in-flight attempt is retired');
    assert.match(app.ui.feedback.textContent, /Automatic connection stopped/);
    app.timers.tick(60000); assert.equal(app.sockets.length, 1);
    app.document.emit('visibilitychange'); assert.equal(app.sockets.length, 1, 'no probing while the dialog is in use');
  } finally { await app.close(); }
  const second = await liveApp();
  try {
    second.ui.address.value = '192.168.9.9'; second.ui.address.emit('input'); second.ui.form.emit('submit');
    assert.equal(second.sockets[0].readyState, 3); assert.equal(second.sockets.length, 2); assert.equal(second.sockets[1].url, 'ws://192.168.9.9/');
    second.timers.tick(AUTO_CONNECT_ATTEMPT_MS * 2); assert.equal(second.sockets.length, 2, 'the cancelled pass never resumes');
    assert.equal(second.sockets.filter(socket => socket.readyState !== 3).length, 1);
  } finally { await second.close(); }
});

test('rig overflow: an empty rig makes room at the cap; with every rig holding groups the new snapshot has no rig and nothing is lost', async () => {
  const navigation = { mixId: null, view: 'groups', expandedGroupId: null };
  const make = groups => { const settings = emptySettings(); settings.knownAddresses = ['10.0.0.1'];
    settings.profiles = Array.from({ length: 128 }, (_, n) => ({ id: `r${n}`, name: `Snap ${n}`, groups: groups(n), navigation })); settings.selectedProfileId = 'r0'; return settings; };
  const roomy = await liveApp({ settings: make(n => n === 5 ? [] : [{ id: 'g', name: 'G', members: ['i.0'] }]) });
  try {
    roomy.sockets[0].open(); roomy.sockets[0].receive(LIVE); await roomy.controller.whenRigIdle(); await flush();
    const profiles = roomy.repository.snapshot().settings.profiles;
    assert.equal(profiles.length, 128); assert.ok(!profiles.some(rig => rig.id === 'r5')); assert.equal(profiles.at(-1).name, 'IMGL FIBBERS');
    assert.equal(roomy.controller.context().profileId, profiles.at(-1).id);
  } finally { await roomy.close(); }
  const full = await liveApp({ settings: make(() => [{ id: 'g', name: 'G', members: ['i.0'] }]) });
  try {
    full.sockets[0].open(); full.sockets[0].receive(LIVE); await full.controller.whenRigIdle(); await flush();
    assert.equal(full.controller.context().profileId, null); assert.match(full.controller.context().unavailableReason, /128 snapshot rigs with groups/);
    assert.equal(full.repository.snapshot().settings.profiles.length, 128);
    assert.ok(full.repository.snapshot().settings.profiles.every(rig => rig.groups.length === 1));
    assert.equal(full.session.snapshot().phase, 'live', 'the connection still works without groups');
  } finally { await full.close(); }
});

test('var.currentSnapshot is a bounded receive-only SETS string', () => {
  assert.deepEqual(parseIemStateFrame('3:::SETS^var.currentSnapshot^IMGL FIBBERS\nSETS^var.currentShow^Default\nSETS^var.currentCue^'),
    [{ kind: 'device', field: 'currentSnapshot', path: 'var.currentSnapshot', value: 'IMGL FIBBERS' }]);
  assert.deepEqual(parseIemStateFrame('3:::SETS^var.currentSnapshot^'), [{ kind: 'device', field: 'currentSnapshot', path: 'var.currentSnapshot', value: '' }]);
  assert.deepEqual(parseIemStateFrame('3:::SETD^var.currentSnapshot^1'), []);
  assert.deepEqual(parseIemStateFrame(`3:::SETS^var.currentSnapshot^${'x'.repeat(IEM_RECEIVE_LIMITS.nameBytes + 1)}`), []);
});

test('the live Connect dialog is only the address, Connect, Disconnect while connected, Close and feedback (no rig picker or editor)', async () => {
  const { domFixture } = await import('./helpers/fake-dom.js');
  const { createLiveConnectionUI } = await import('../src/iem/live-controller.js');
  const { createDialogOwner } = await import('../src/iem/dialog-owner.js');
  const dom = domFixture(), ui = createLiveConnectionUI(dom.root, { levels: true, pan: true, dialogOwner: createDialogOwner() });
  assert.equal(ui.form.querySelectorAll('select').length, 0);
  assert.deepEqual(ui.form.querySelectorAll('input').map(node => node), [ui.address]);
  assert.deepEqual(ui.form.querySelectorAll('button').map(node => node.textContent), ['Connect live IEM', 'Disconnect']);
  assert.equal(ui.profile, undefined); assert.equal(ui.newRig, undefined); assert.equal(ui.saveRig, undefined); assert.equal(ui.name, undefined);
  assert.equal(ui.dialogDisconnect.hidden, true); ui.connected(true); assert.equal(ui.dialogDisconnect.hidden, false);
  ui.knownAddresses(['10.0.0.2', '10.0.0.1']);
  assert.deepEqual(ui.form.querySelectorAll('option').map(node => node.value), ['10.0.0.2', '10.0.0.1']);
  let opened = 0; ui.onOpen(() => opened++);
  ui.show(); ui.show(); assert.equal(opened, 1); assert.equal(ui.visible(), true);
  ui.close(); assert.equal(ui.visible(), false); ui.destroy();
});

// Review P2-1: a control session is ready only when the writer is open as well
// as the receive-only companion qualifying.
test('control session: a qualified companion with a stalled writer is not success, records nothing and never loops; the pass ends in the dialog', async () => {
  const app = await liveApp({ control: true });
  try {
    for (const [index, address] of ['10.0.0.1', '10.0.0.2'].entries()) {
      const writer = app.sockets[index * 2], companion = app.sockets[index * 2 + 1];
      assert.equal(writer.url, `ws://${address}/`); assert.equal(companion.url, `ws://${address}/`);
      companion.open(); companion.receive(LIVE); // Companion qualifies; writer never opens.
      assert.equal(app.session.snapshot().phase, 'live'); assert.equal(app.session.snapshot().qualified, false);
      assert.equal(app.controller.autoConnecting(), true, 'not counted as success');
      app.timers.tick(AUTO_CONNECT_ATTEMPT_MS);
      assert.equal(writer.readyState, 3); assert.equal(companion.readyState, 3);
    }
    assert.equal(app.sockets.length, 4); assert.equal(app.ui.shown, 1); assert.match(app.ui.feedback.textContent, /No known desk address answered/);
    await app.controller.whenRigIdle(); await flush();
    assert.deepEqual(app.repository.snapshot().settings.knownAddresses, ['10.0.0.1', '10.0.0.2'], 'nothing promoted');
    app.timers.tick(120000); assert.equal(app.sockets.length, 4, 'no automatic loop');
  } finally { await app.close(); }
});

test('control session: success needs writer and companion; a companion drop reconnects once, a quick repeat drop opens the dialog', async () => {
  const app = await liveApp({ control: true, known: ['10.0.0.2', '10.0.0.1'] });
  try {
    const [writer, companion] = app.sockets;
    companion.open(); companion.receive(LIVE); assert.equal(app.controller.autoConnecting(), true);
    writer.open(); assert.equal(app.session.snapshot().qualified, true); assert.equal(app.controller.autoConnecting(), false);
    // Keep both sockets alive (heartbeats) past the reconnection guard.
    for (let elapsed = 0; elapsed <= AUTO_RECONNECT_MIN_INTERVAL_MS; elapsed += 10000) { app.timers.tick(10000); writer.receive('2::'); companion.receive('2::'); }
    assert.equal(app.session.snapshot().qualified, true);
    companion.drop(); app.timers.tick(0);
    assert.equal(writer.readyState, 3); assert.equal(app.sockets.length, 4, 'one pass after an unexpected drop');
    const [writer2, companion2] = app.sockets.slice(2);
    companion2.open(); companion2.receive(LIVE); writer2.open(); assert.equal(app.controller.autoConnecting(), false);
    app.timers.tick(1000); companion2.drop(); app.timers.tick(0);
    assert.equal(app.sockets.length, 4); assert.equal(app.ui.shown, 1); assert.match(app.ui.feedback.textContent, /dropped again soon/);
    assert.match(app.view.renders.at(-1).status, /dropped again soon/);
  } finally { await app.close(); }
});

// Review P2-2 / P3-1: automatic work never disturbs another open dialog.
test('an open Edit Groups (or other) dialog pauses the pass without changing context, defers triggers and shows exhaustion in the status line', async () => {
  const dialogOwner = createDialogOwner(), seeded = emptySettings(); seeded.knownAddresses = ['10.0.0.1', '10.0.0.2'];
  seeded.profiles = [{ id: 'r1', name: 'Snap', groups: [], navigation: { mixId: null, view: 'groups', expandedGroupId: null } }]; seeded.selectedProfileId = 'r1';
  const app = await liveApp({ dialogOwner, settings: seeded });
  try {
    assert.equal(app.sockets.length, 1);
    const editor = dialogOwner.claim('groups', () => {}); const revision = app.controller.context().revision;
    app.timers.tick(AUTO_CONNECT_ATTEMPT_MS * 2); // Past our deadline, inside the session's own 15 s one.
    assert.equal(app.sockets.length, 1, 'no next attempt behind the dialog'); assert.equal(app.sockets[0].readyState, 0, 'the attempt is not retired behind the dialog');
    app.sockets[0].drop(); app.timers.tick(0);
    assert.equal(app.sockets.length, 1); assert.equal(app.controller.context().revision, revision, 'a failed attempt never invalidates the open editor');
    assert.equal(app.controller.context().profileId, 'r1');
    dialogOwner.release(editor); app.timers.tick(0);
    assert.equal(app.sockets.length, 2, 'the pass resumes when the dialog closes'); assert.equal(app.sockets[1].url, 'ws://10.0.0.2/');
    // The last failure behind another dialog waits; the pass ends (and the
    // Connect dialog opens) only once that dialog closes.
    const pan = dialogOwner.claim('pan', () => {});
    app.sockets[1].drop(); app.timers.tick(0);
    assert.equal(app.ui.shown, 0); assert.equal(app.controller.autoConnecting(), true);
    dialogOwner.release(pan); app.timers.tick(0);
    assert.equal(app.ui.shown, 1); assert.match(app.view.renders.at(-1).status, /No known desk address answered \(2 tried\)/);
    app.ui.close(); app.timers.tick(0);
    // A trigger while another dialog is open is deferred until it closes.
    const detail = dialogOwner.claim('detail', () => {});
    app.window.emit('online'); assert.equal(app.sockets.length, 2);
    dialogOwner.release(detail); app.timers.tick(0);
    assert.equal(app.sockets.length, 3);
    // A quick repeat drop while another dialog is open: the reason goes to the
    // status line at once and the Connect dialog opens after that dialog closes.
    app.sockets[2].open(); app.sockets[2].receive(LIVE); assert.equal(app.controller.autoConnecting(), false);
    const groups = dialogOwner.claim('groups', () => {}), shown = app.ui.shown;
    app.sockets[2].drop(); app.timers.tick(0);
    assert.equal(app.ui.shown, shown); assert.match(app.view.renders.at(-1).status, /dropped again soon/);
    dialogOwner.release(groups); app.timers.tick(0);
    assert.equal(app.ui.shown, shown + 1); assert.equal(app.sockets.length, 3);
  } finally { await app.close(); }
});

test('a rig-creation failure is forgotten when the snapshot name changes', async () => {
  const navigation = { mixId: null, view: 'groups', expandedGroupId: null };
  const settings = emptySettings(); settings.knownAddresses = ['10.0.0.1'];
  settings.profiles = Array.from({ length: 128 }, (_, n) => ({ id: `r${n}`, name: `Snap ${n}`, groups: [{ id: 'g', name: 'G', members: ['i.0'] }], navigation })); settings.selectedProfileId = 'r0';
  const app = await liveApp({ settings });
  try {
    app.sockets[0].open(); app.sockets[0].receive(LIVE); await app.controller.whenRigIdle(); await flush();
    assert.match(app.controller.context().unavailableReason, /128 snapshot rigs/);
    app.sockets[0].receive('3:::SETS^var.currentSnapshot^Snap 3'); assert.equal(app.controller.context().profileId, 'r3');
    await app.repository.update(draft => { draft.profiles[5].groups = []; });
    // Back to the failed name: retried, and now there is room.
    app.sockets[0].receive('3:::SETS^var.currentSnapshot^IMGL FIBBERS'); await app.controller.whenRigIdle(); await flush();
    assert.equal(app.repository.snapshot().settings.profiles.at(-1).name, 'IMGL FIBBERS');
    assert.equal(app.controller.context().profileId, app.repository.snapshot().settings.profiles.at(-1).id);
  } finally { await app.close(); }
});
