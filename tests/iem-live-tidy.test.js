import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domFixture, Node } from './helpers/fake-dom.js';
import { tidyLive } from '../src/iem/live-shell.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { createDiagnostics, DIAGNOSTICS_LOG_LIMIT, MESSAGE_TTL_MS } from '../src/iem/diagnostics.js';
import { buildInfo } from '../src/build-info.js';
import { createLiveConnectionUI, mountLiveController } from '../src/iem/live-controller.js';
import { AUTO_CONNECT_ATTEMPT_MS } from '../src/iem/auto-connect.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';
import { SettingsRepository, emptySettings } from '../src/settings.js';

// F09-S11 live UI tidy: no banner, footer status/message/Diagnostics, the
// Diagnostics modal and the minimal Connect dialog. Fake DOM, sockets and timers
// only; no desk, browser or network.
const ALLOWED = new Set(['3:::INIT', '3:::ALIVE', '2::']);
const LIVE = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.0.mix^0.5\nSETD^a.0.stereoIndex^-1\nSETS^var.currentSnapshot^IMGL FIBBERS';
class Clock {
  now = 0; next = 1; jobs = new Map();
  setTimeout = (callback, delay = 0) => this.add(callback, delay);
  setInterval = (callback, delay) => this.add(callback, delay, true);
  clearTimeout = id => this.jobs.delete(id);
  clearInterval = id => this.jobs.delete(id);
  add(callback, delay, repeat = false) { const id = this.next++; this.jobs.set(id, { callback, delay, repeat, at: this.now + delay }); return id; }
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
const flush = () => new Promise(resolve => setImmediate(resolve));
const texts = (root, selector) => root.querySelectorAll(selector).map(node => node.textContent);

async function app({ known = [], autoConnect = false, initialSuppressed = false } = {}) {
  const dom = domFixture(), { root } = dom, sockets = [], timers = new Clock();
  tidyLive(root);
  class FakeSocket {
    readyState = 0; sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(message) { assert.ok(ALLOWED.has(message), 'no new outbound message'); this.sent.push(message); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
    drop() { this.readyState = 3; this.onclose?.(); }
  }
  const session = createReadOnlySession({ WebSocketClass: FakeSocket, timers, now: () => timers.now, wallNow: () => timers.now });
  const repository = new SettingsRepository({ indexedDB: undefined }), settings = emptySettings();
  settings.knownAddresses = known; await repository.replace(settings);
  root.querySelector('.mm-diagnostics-open').disabled = true; // mountReadOnlyView disables every button present at mount
  const owner = createDialogOwner(), ui = createLiveConnectionUI(root, { levels: true, pan: true, dialogOwner: owner, timers });
  const view = { renders: [], render(model) { this.renders.push(model); }, preferences() {}, snapshotName() {}, destroy() {} };
  const document = Object.assign(new Events(), { hidden: false }), window = new Events();
  Object.assign(document, { activeElement: null });
  const controller = mountLiveController({ session, repository, view, ui, document, window, timers, now: () => timers.now, autoConnect, initialSuppressed, createID: (() => { let n = 0; return () => `rig-${++n}`; })() });
  await controller.ready;
  const desk = root.querySelector('.mm-desk');
  return { dom, root, sockets, timers, session, repository, owner, ui, view, controller, window, document, desk,
    diagnosticsButton: root.querySelector('.mm-diagnostics-open'), diag: ui.diagnostics,
    async close() { controller.destroy(); await repository.close(); } };
}

test('live shell has no banner: routine text moves to a hidden sink and the footer is status, one message slot and Diagnostics', () => {
  const { root } = domFixture(); tidyLive(root);
  assert.equal(root.querySelector('.mm-preview'), null, 'no banner under the header');
  const footer = root.querySelector('.mm-bottom');
  assert.deepEqual(footer.children.map(node => node.className), ['mm-message', 'mm-diagnostics-open', 'mm-diag-sink']);
  assert.equal(root.querySelector('.mm-desk').textContent, 'Not connected');
  const message = root.querySelector('.mm-message');
  assert.equal(message.attributes.role, 'status'); assert.equal(message.attributes['aria-live'], 'polite');
  const button = root.querySelector('.mm-diagnostics-open'); assert.equal(button.tag, 'button'); assert.equal(button.type, 'button'); assert.equal(button.textContent, 'Diagnostics');
  const sink = root.querySelector('.mm-diag-sink'); assert.equal(sink.hidden, true);
  for (const name of ['mm-mode-label', 'mm-feedback', 'mm-offline-state', 'mm-dirty', 'mm-rec-state', 'mm-page-state']) assert.ok(sink.querySelector(`.${name}`), `${name} lives in the hidden sink`);
  for (const name of ['mm-dirty', 'mm-rec-state', 'mm-page-state']) assert.equal(footer.children.filter(node => node.className === name).length, 0);
});

test('footer connection status: not connected, connecting with the address, connected, could not reach, connection lost', async () => {
  const a = await app();
  try {
    assert.equal(a.desk.textContent, 'Not connected'); assert.equal(a.desk.dataset.state, 'idle');
    a.ui.address.value = '10.0.0.5'; a.ui.form.emit('submit');
    assert.equal(a.sockets[0].url, 'ws://10.0.0.5/'); assert.equal(a.desk.textContent, 'Connecting · 10.0.0.5…'); assert.equal(a.desk.dataset.state, 'connecting');
    a.sockets[0].open(); assert.equal(a.desk.textContent, 'Connecting · 10.0.0.5…', 'socket-open is not ready');
    a.sockets[0].receive(LIVE); assert.equal(a.desk.textContent, 'Connected · 10.0.0.5'); assert.equal(a.desk.dataset.state, 'connected');
    a.sockets[0].drop(); assert.equal(a.desk.textContent, 'Connection lost'); assert.equal(a.desk.dataset.state, 'failed');
    a.ui.address.value = '10.0.0.6'; a.ui.form.emit('submit'); assert.equal(a.desk.textContent, 'Connecting · 10.0.0.6…');
    a.sockets[1].drop(); assert.equal(a.desk.textContent, "Couldn't reach 10.0.0.6"); assert.equal(a.desk.dataset.state, 'failed');
    assert.equal(a.ui.feedback.textContent, "Couldn't reach 10.0.0.6.", 'one concise line in the Connect dialog');
    a.ui.address.value = '10.0.0.7'; a.ui.form.emit('submit'); a.sockets[2].open(); a.sockets[2].receive(LIVE);
    a.ui.dialogDisconnect.emit('click'); assert.equal(a.desk.textContent, 'Not connected');
  } finally { await a.close(); }
});

test('footer Diagnostics button opens the modal through the dialog owner; Close, Escape and replacement release it', async () => {
  const a = await app();
  try {
    assert.equal(a.diagnosticsButton.disabled, false, 'Diagnostics is always enabled');
    a.diagnosticsButton.focus(); a.diagnosticsButton.emit('click');
    assert.equal(a.owner.active().kind, 'diagnostics'); assert.equal(a.dom.layer.hidden, false); assert.equal(a.dom.title.textContent, 'Diagnostics');
    assert.ok(a.dom.body.children.includes(a.diag.form.parentElement.parentElement.parentElement) || a.dom.body.querySelector('.mm-diag'));
    a.dom.close.emit('click'); assert.equal(a.owner.active(), null); assert.equal(a.dom.layer.hidden, true); assert.equal(a.dom.document.activeElement, a.diagnosticsButton, 'focus restored');
    a.diagnosticsButton.emit('click'); a.root.emit('keydown', { key: 'Escape' }); assert.equal(a.owner.active(), null); assert.equal(a.dom.layer.hidden, true);
    a.diagnosticsButton.emit('click'); a.desk.emit('click');
    assert.equal(a.owner.active().kind, 'connection', 'the Connect dialog replaces Diagnostics through the owner'); assert.equal(a.diag.visible(), false);
    a.dom.close.emit('click'); assert.equal(a.owner.active(), null);
  } finally { await a.close(); }
});

test('Diagnostics shows version, commit and build time with an unknown fallback outside a Vite build', () => {
  const dom = domFixture(); tidyLive(dom.root); const owner = createDialogOwner();
  const diag = createDiagnostics(dom.root, { dialogOwner: owner, info: buildInfo({ commit: 'abc1234', time: '2026-11-21T10:00:00.000Z' }) });
  diag.show();
  const values = texts(dom.root, '.mm-diag-value'), labels = texts(dom.root, '.mm-diag-label');
  assert.match(values[labels.indexOf('Version')], /^v\d+\.\d+\.\d+$/);
  assert.equal(values[labels.indexOf('Commit')], 'abc1234'); assert.equal(values[labels.indexOf('Built (UTC)')], '2026-11-21T10:00:00.000Z');
  assert.equal(typeof __BUILD_COMMIT__, 'undefined', 'node tests run without Vite defines');
  const fallback = buildInfo(); assert.equal(fallback.commit, 'unknown'); assert.equal(fallback.time, 'unknown'); assert.match(fallback.version, /^\d+\.\d+\.\d+$/);
  const own = domFixture(); tidyLive(own.root); const second = createDiagnostics(own.root, { dialogOwner: createDialogOwner() }); second.show();
  assert.ok(texts(own.root, '.mm-diag-value').includes('unknown'));
});

test('Diagnostics shows the offline line, desk state and links from the status sink, as text only', async () => {
  const a = await app();
  try {
    const sink = name => a.root.querySelector(`.mm-diag-sink .${name}`);
    sink('mm-offline-state').textContent = 'v0.5.0 · Offline ready · 9ce75844fa30b67d'; sink('mm-mode-label').textContent = 'LIVE IEM · CONTROLS READY';
    sink('mm-feedback').textContent = '<img src=x onerror=alert(1)>'; sink('mm-dirty').textContent = 'Ready to edit current received state.';
    a.root.querySelector('.mm-snapshot-name').textContent = '<b>Snapshot</b>';
    a.diagnosticsButton.emit('click');
    const labels = texts(a.root, '.mm-diag-label'), values = texts(a.root, '.mm-diag-value'), value = label => values[labels.indexOf(label)];
    assert.equal(value('Offline'), 'v0.5.0 · Offline ready · 9ce75844fa30b67d'); assert.equal(value('Mode'), 'LIVE IEM · CONTROLS READY');
    assert.equal(value('Latest feedback'), '<img src=x onerror=alert(1)>'); assert.equal(value('Snapshot'), '<b>Snapshot</b>'); assert.equal(value('Controls'), 'Ready to edit current received state.');
    assert.equal(a.root.querySelectorAll('.mm-diag img, .mm-diag b').length, 0, 'mixer strings never become markup');
    assert.deepEqual(a.root.querySelectorAll('.mm-diag-links a').map(link => link.href), ['./demo.html', './connection-test.html']);
    const source = await readFile(new URL('../src/iem/diagnostics.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|localStorage|sessionStorage|indexedDB/, 'text only and never persisted');
    // Live while open: a later status update repaints without reopening.
    sink('mm-dirty').textContent = 'Adjustment interrupted.'; a.diag.refresh(); assert.equal(texts(a.root, '.mm-diag-value')[labels.indexOf('Controls')], 'Adjustment interrupted.');
  } finally { await a.close(); }
});

test('modal Connect uses the explicit path (cancels an automatic pass); modal Disconnect suppresses automatic connection', async () => {
  const a = await app({ known: ['10.0.0.1', '10.0.0.2'], autoConnect: true });
  try {
    assert.equal(a.sockets.length, 1); assert.equal(a.controller.autoConnecting(), true);
    a.diagnosticsButton.emit('click');
    a.diag.address.value = '10.0.0.9'; a.diag.address.emit('input'); assert.equal(a.ui.address.value, '10.0.0.9', 'both address fields stay in step');
    a.diag.form.emit('submit');
    assert.equal(a.controller.autoConnecting(), false, 'explicit Connect cancels the automatic pass');
    assert.equal(a.sockets.at(-1).url, 'ws://10.0.0.9/'); assert.equal(a.desk.textContent, 'Connecting · 10.0.0.9…');
    a.sockets.at(-1).open(); a.sockets.at(-1).receive(LIVE);
    assert.equal(a.diag.connect.disabled, true); assert.equal(a.diag.disconnect.disabled, false);
    const count = a.sockets.length;
    a.diag.disconnect.emit('click');
    assert.equal(a.session.snapshot().phase, 'disconnected'); assert.equal(a.desk.textContent, 'Not connected');
    a.dom.close.emit('click'); a.timers.tick(0); a.window.emit('online'); a.document.emit('visibilitychange'); a.timers.tick(60000);
    assert.equal(a.sockets.length, count, 'explicit Disconnect suppresses automatic connection');
    a.diagnosticsButton.emit('click'); a.diag.form.emit('submit'); assert.equal(a.sockets.length, count + 1, 'Connect in the modal is an explicit Connect again');
  } finally { await a.close(); }
});

test('opening Diagnostics pauses an automatic pass until it closes; per-attempt reasons are listed', async () => {
  const a = await app({ known: ['10.0.0.1', '10.0.0.2'], autoConnect: true });
  try {
    assert.equal(a.sockets.length, 1);
    a.diagnosticsButton.emit('click');
    a.timers.tick(AUTO_CONNECT_ATTEMPT_MS * 3); assert.equal(a.sockets.length, 1, 'a pass never advances behind an open Diagnostics modal');
    a.dom.close.emit('click'); a.timers.tick(0); assert.equal(a.sockets.length, 2, 'it resumes when the modal closes');
    a.sockets[1].drop(); a.timers.tick(0);
    assert.equal(a.owner.active()?.kind, 'connection', 'the failed pass opens the Connect dialog');
    a.diagnosticsButton.emit('click');
    assert.deepEqual(texts(a.root, '.mm-diag-list li').filter(text => text.startsWith('10.0.0.')), ['10.0.0.1 — no answer in time (timeout)', '10.0.0.2 — failed (closed)']);
    const labels = texts(a.root, '.mm-diag-label'), values = texts(a.root, '.mm-diag-value');
    assert.match(values[labels.indexOf('Automatic')], /open pass · no address answered \(2 tried\)/);
  } finally { await a.close(); }
});

test('Connect dialog is minimal: address, Connect, Disconnect while connected and a single status line', async () => {
  const a = await app({ known: ['10.0.0.1', '10.0.0.2'], autoConnect: true });
  try {
    a.timers.tick(AUTO_CONNECT_ATTEMPT_MS); a.timers.tick(AUTO_CONNECT_ATTEMPT_MS);
    assert.equal(a.owner.active().kind, 'connection');
    assert.deepEqual(a.ui.form.children.map(node => node.tag), ['label', 'datalist', 'div', 'p'], 'address, datalist, actions, one status line');
    assert.equal(a.ui.feedback.textContent, 'No known desk address answered (2 tried). Enter the mixer address and Connect.');
    assert.equal(a.ui.dialogDisconnect.hidden, true, 'Disconnect only while connected');
    assert.equal(a.ui.form.querySelectorAll('.mm-caption').length, 1);
    const all = a.ui.form.textContent; assert.doesNotMatch(all, /Local settings storage|Groups are kept|editable after connecting|No received mixer state/);
    a.ui.address.value = '10.0.0.3'; a.ui.form.emit('submit'); a.sockets.at(-1).open(); a.sockets.at(-1).receive(LIVE);
    assert.equal(a.ui.dialogDisconnect.hidden, false);
  } finally { await a.close(); }
});

test('settings status and explanatory notes live in Diagnostics, not the Connect dialog', async () => {
  const a = await app({ known: ['10.0.0.1'] });
  try {
    a.diagnosticsButton.emit('click');
    const text = a.dom.body.textContent;
    assert.match(text, /Local settings storage|settings/i); assert.match(text, /Groups are kept on this device for each desk snapshot name/); assert.match(text, /editable after connecting/);
    assert.doesNotMatch(a.ui.form.textContent, /Groups are kept|editable after connecting/);
  } finally { await a.close(); }
});

test('recent messages are bounded, newest first, time-stamped and kept in memory only', () => {
  const dom = domFixture(); tidyLive(dom.root); const diag = createDiagnostics(dom.root, { dialogOwner: createDialogOwner(), now: () => new Date(2026, 10, 21, 9, 5, 7) });
  for (let n = 0; n < DIAGNOSTICS_LOG_LIMIT + 10; n++) diag.log(`message ${n}`);
  diag.log('message 39'); // An immediate duplicate is not repeated.
  const entries = diag.entries(); assert.equal(entries.length, DIAGNOSTICS_LOG_LIMIT); assert.equal(entries.at(-1).text, 'message 39'); assert.equal(entries[0].text, 'message 10'); assert.equal(entries[0].time, '09:05:07');
  diag.show(); const items = texts(dom.root, '.mm-diag-log li'); assert.equal(items.length, DIAGNOSTICS_LOG_LIMIT); assert.equal(items[0], '09:05:07 message 39');
});

test('message slot shows the session\'s attention outcomes only; routine status stays out of the footer', () => {
  const previous = Object.fromEntries(['document', 'window', 'matchMedia', 'innerHeight', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  const dom = domFixture(), { root } = dom, timers = new Clock();
  tidyLive(root);
  Object.assign(globalThis, { document: dom.document, window: new Node(dom.document), matchMedia: () => ({ matches: true }), innerHeight: 300, ResizeObserver: class { observe() {} disconnect() {} } });
  const diag = createDiagnostics(root, { dialogOwner: createDialogOwner(), timers }), cleared = [];
  let view;
  try {
    view = mountReadOnlyView(root, { onMessage: text => diag.message(text), onGestureStart: () => diag.clearMessage(), onClearMessage: text => { cleared.push(text); if (diag.currentMessage() === text) diag.clearMessage(); } });
    const slot = root.querySelector('.mm-message');
    const render = (status, extra = {}) => view.render({ status: 'Ui24 model received', connectionPhase: 'live', modelLabel: 'Ui24 model received', mixes: [], sources: [], control: { selected: null, eligible: true, armed: true, status, attention: '', ...extra } });
    render('Ready to edit current received state.'); assert.equal(slot.textContent, '', 'routine control status is not shown');
    render('Sent; application unverified. Requested coordinate retained; no retry. Some values may have changed.'); assert.equal(slot.textContent, '', 'a normal sent-unverified outcome is routine, whatever its wording');
    assert.equal(root.querySelector('.mm-desk').textContent, 'Not connected', 'the live view no longer writes the footer status button');
    const stopped = 'Local group definition changed; select the current group.';
    render(stopped, { attention: stopped }); assert.equal(slot.textContent, stopped, 'a stopped gesture is shown whatever its wording'); assert.equal(slot.attributes.title, stopped, 'full text in the title');
    render('Ready to edit current received state.'); assert.equal(slot.textContent, '', 'cleared when the outcome is superseded'); assert.equal(cleared.length, 1);
    diag.message('Fullscreen unavailable; use the installed app.'); render('Ready to edit current received state.');
    assert.equal(slot.textContent, 'Fullscreen unavailable; use the installed app.', 'an explicit message is not wiped by a routine render');
    render('Gesture', { gestureActive: true }); assert.equal(slot.textContent, '', 'the next deliberate gesture clears a transient message');
    assert.ok(diag.entries().some(entry => /select the current group/.test(entry.text)), 'actionable messages are logged for Diagnostics');
  } finally { view?.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test('a transient slot message clears after 8 s; a lasting condition stays while it holds and never hides a newer transient message', () => {
  const dom = domFixture(), timers = new Clock(); tidyLive(dom.root);
  const diag = createDiagnostics(dom.root, { dialogOwner: createDialogOwner(), timers }), slot = dom.root.querySelector('.mm-message');
  diag.message('Try again in a moment.'); assert.equal(slot.textContent, 'Try again in a moment.');
  timers.tick(MESSAGE_TTL_MS - 1); assert.equal(slot.textContent, 'Try again in a moment.'); timers.tick(1); assert.equal(slot.textContent, '');
  diag.condition('View is temporary; not saved on this device.'); timers.tick(60000); assert.equal(slot.textContent, 'View is temporary; not saved on this device.', 'lasting condition stays');
  diag.message('Fullscreen unavailable.'); assert.equal(slot.textContent, 'Fullscreen unavailable.'); timers.tick(MESSAGE_TTL_MS); assert.equal(slot.textContent, 'View is temporary; not saved on this device.', 'condition returns after the transient message');
  diag.condition(''); assert.equal(slot.textContent, '', 'cleared when the condition stops holding');
});

test('lasting conditions reach the footer slot: groups unavailable without a snapshot name, temporary view', async () => {
  const a = await app();
  try {
    a.ui.address.value = '10.0.0.5'; a.ui.form.emit('submit'); a.sockets[0].open();
    a.sockets[0].receive(LIVE.replace('\nSETS^var.currentSnapshot^IMGL FIBBERS', ''));
    const slot = a.root.querySelector('.mm-message');
    assert.match(slot.textContent, /^Groups unavailable: the desk has not reported a current snapshot name/);
    a.timers.tick(9000); assert.match(slot.textContent, /^Groups unavailable/, 'persists while the condition holds');
    a.sockets[0].receive('3:::SETS^var.currentSnapshot^IMGL FIBBERS'); await a.controller.whenRigIdle(); await flush();
    assert.doesNotMatch(slot.textContent, /Groups unavailable/, 'cleared when a rig is bound');
    a.controller.selectAux(0); await a.controller.whenNavigationIdle(); await flush();
    assert.equal(slot.textContent, 'View is temporary; not saved on this device.', 'memory-only storage is a lasting condition');
  } finally { await a.close(); }
});

test('F07-S05: initialSuppressed (explicit Disconnect carried over an update reload) keeps automatic connection off until an explicit Connect', async () => {
  const carried = await app({ known: ['192.168.0.60'], autoConnect: true, initialSuppressed: true });
  assert.equal(carried.sockets.length, 0); assert.equal(carried.controller.autoSuppressed(), true);
  carried.window.emit('online'); carried.document.emit('visibilitychange'); assert.equal(carried.sockets.length, 0);
  await carried.close();
  const normal = await app({ known: ['192.168.0.60'], autoConnect: true });
  assert.ok(normal.sockets.length > 0); assert.equal(normal.controller.autoSuppressed(), false); await normal.close();
});

test('F07-S05: explicitConnecting is true only for a user-initiated attempt, not an automatic pass', async () => {
  const automatic = await app({ known: ['192.168.0.60'], autoConnect: true });
  assert.equal(automatic.session.snapshot().phase, 'connecting'); assert.equal(automatic.controller.explicitConnecting(), false); await automatic.close();
  const manual = await app({ known: [] });
  manual.ui.address.value = '192.168.0.60'; manual.ui.form.emit('submit');
  assert.equal(manual.session.snapshot().phase, 'connecting'); assert.equal(manual.controller.explicitConnecting(), true); await manual.close();
});
