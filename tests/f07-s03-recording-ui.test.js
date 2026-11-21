import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domFixture } from './helpers/fake-dom.js';
import { tidyLive } from '../src/iem/live-shell.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { createLiveConnectionUI, mountLiveController } from '../src/iem/live-controller.js';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { mountRecordingControls, recordingAvailability } from '../src/iem/recording-controls.js';
import { SettingsRepository, emptySettings } from '../src/settings.js';

// F07-S03 header Record button and Stop dialog: fake DOM, fake sockets and timers only.
const TOPOLOGY = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\nSETS^var.currentShow^Default\nSETS^var.currentSnapshot^MixMate1\nSETS^settings.block.pass^\nSETD^settings.block.player^1';
const mtk = ({ present = 1, state = 0, busy = 0, time = 21 } = {}) => `\nSETD^var.mtk.present^${present}\nSETD^var.mtk.freespace^7000\nSETD^var.mtk.dropouts^0\nSETD^var.mtk.rec.currentState^${state}\nSETD^var.mtk.rec.busy^${busy}\nSETD^var.mtk.rec.time^${time}\nSETS^var.mtk.rec.session^0011`;
const PLAIN = new Set(['3:::INIT', '3:::ALIVE', '2::']);
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
}

async function app({ init = TOPOLOGY + mtk(), connect = true } = {}) {
  const dom = domFixture(), { root } = dom, sockets = [], timers = new Clock();
  tidyLive(root);
  const recordButton = dom.document.createElement('button'); recordButton.dataset.action = 'record'; recordButton.className = 'mm-record';
  const text = dom.document.createElement('span'); text.className = 'mm-rec-text'; text.textContent = 'Record';
  const long = dom.document.createElement('span'); long.className = 'mm-long'; long.textContent = ' MTK'; text.append(long);
  recordButton.disabled = true; recordButton.append(text); root.append(recordButton);
  class FakeSocket {
    readyState = 0; sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(message) { this.sent.push(message); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
    drop() { this.readyState = 3; this.onclose?.(); }
  }
  const session = createAuxControlSession({ WebSocketClass: FakeSocket, timers, now: () => timers.now, wallNow: () => timers.now });
  const repository = new SettingsRepository({ indexedDB: undefined });
  await repository.replace(emptySettings());
  root.querySelector('.mm-diagnostics-open').disabled = true;
  const owner = createDialogOwner(), ui = createLiveConnectionUI(root, { levels: true, pan: true, dialogOwner: owner, timers });
  const view = { render() {}, preferences() {}, snapshotName() {}, destroy() {} };
  const document = Object.assign(new Events(), { hidden: false, activeElement: null }), window = new Events();
  const controller = mountLiveController({ session, repository, view, ui, document, window, timers, now: () => timers.now, autoConnect: false, createID: (() => { let n = 0; return () => `rig-${++n}`; })() });
  await controller.ready;
  const controls = mountRecordingControls({ root, session, ui, dialogOwner: owner });
  const a = {
    dom, root, sockets, timers, session, owner, ui, controller, controls, recordButton, text,
    get writer() { return sockets.at(-2); }, get receiver() { return sockets.at(-1); },
    slot: () => root.querySelector('.mm-message').textContent,
    sink: () => root.querySelector('.mm-rec-state').textContent,
    log: () => ui.diagnostics.entries().map(entry => entry.text),
    byText: label => dom.body.querySelectorAll('button').find(button => button.textContent === label),
    writes: () => a.writer.sent.filter(message => !PLAIN.has(message)),
    rec: () => session.snapshot().recording,
    live(data = init) { ui.address.value = '10.0.0.5'; ui.form.emit('submit'); a.writer.open(); a.receiver.open(); a.receiver.receive(data); },
    async close() { controls.destroy(); controller.destroy(); await repository.close(); },
  };
  if (connect) a.live();
  return a;
}

test('availability reasons: not connected, unknown state, no drive, locked, busy, pending', async () => {
  const a = await app({ connect: false });
  try {
    assert.equal(a.recordButton.disabled, true); assert.match(a.recordButton.attributes.title, /Connect to the desk first/);
    assert.equal(a.sink(), 'Recording status unavailable'); assert.equal(a.text.textContent, 'Record');
    a.ui.address.value = '10.0.0.5'; a.ui.form.emit('submit'); a.writer.open(); a.receiver.open();
    assert.equal(a.recordButton.disabled, true, 'socket-open is not qualified');
    a.receiver.receive(TOPOLOGY);
    assert.equal(a.recordButton.disabled, true); assert.match(a.recordButton.attributes.title, /not reported its recording state/);
    a.receiver.receive('3:::SETD^var.mtk.rec.currentState^0'); assert.match(a.recordButton.attributes.title, /not reported its USB drive/);
    a.receiver.receive('3:::SETD^var.mtk.present^0'); assert.equal(a.recordButton.attributes.title, 'No USB drive in the desk'); assert.equal(a.sink(), 'MTK stopped · no USB drive');
    a.receiver.receive('3:::SETD^var.mtk.present^1'); assert.match(a.recordButton.attributes.title, /whether the recorder is busy/);
    a.receiver.receive('3:::SETD^var.mtk.rec.busy^1'); assert.equal(a.recordButton.attributes.title, 'Recorder busy');
    a.receiver.receive('3:::SETD^var.mtk.rec.busy^0'); assert.equal(a.recordButton.disabled, false); assert.equal(a.recordButton.attributes.title, 'Start multitrack recording');
    a.receiver.receive('3:::SETS^settings.block.pass^secret\nSETD^settings.block.player^0');
    assert.equal(a.recordButton.disabled, true); assert.equal(a.recordButton.attributes.title, 'Locked on the desk');
    a.recordButton.emit('click'); assert.deepEqual(a.writes(), [], 'a disabled button sends nothing'); assert.equal(a.owner.active(), null);
    assert.ok(!a.dom.root.textContent.includes('secret'), 'the lock password never reaches the UI');
    a.receiver.receive('3:::SETD^settings.block.player^1'); assert.equal(a.recordButton.disabled, false);
  } finally { await a.close(); }
  const base = { phase: 'live', qualified: true, recording: { recording: false, present: true, lock: 'allowed', busy: 0, operation: null } };
  assert.equal(recordingAvailability(base), '');
  assert.match(recordingAvailability(base, true), /waiting for the desk/);
  assert.match(recordingAvailability({ ...base, recording: { ...base.recording, operation: { status: 'pending' } } }), /waiting for the desk/);
  assert.equal(recordingAvailability({ ...base, recording: { ...base.recording, recording: true, present: false } }), '', 'a stop does not need the drive');
  assert.match(recordingAvailability({ ...base, recording: { ...base.recording, lock: 'unknown' } }), /lock settings have not been received/);
});

test('start: one tap sends the toggle, shows Starting…, then the recording look with received elapsed time; the footer says started', async () => {
  const a = await app();
  try {
    assert.equal(a.recordButton.disabled, false); assert.equal(a.text.textContent, 'Record');
    assert.equal(a.recordButton.classList.contains('mm-recording'), false); assert.equal(a.sink(), 'MTK stopped');
    a.recordButton.emit('click');
    assert.deepEqual(a.writes(), ['3:::MTK_REC_TOGGLE']); assert.equal(a.owner.active(), null, 'start needs no confirmation dialog');
    assert.equal(a.text.textContent, 'Starting…'); assert.equal(a.recordButton.disabled, true); assert.match(a.recordButton.attributes.title, /waiting for the desk/);
    assert.equal(a.controls.pending(), true);
    a.recordButton.emit('click'); assert.equal(a.writes().length, 1, 'a second tap while pending sends nothing');
    a.receiver.receive('3:::SETD^var.mtk.rec.currentState^1\nSETD^var.mtk.rec.time^0');
    assert.equal(a.controls.pending(), false);
    assert.equal(a.slot(), 'Recording started.'); assert.ok(a.log().includes('Recording started.'));
    assert.equal(a.recordButton.classList.contains('mm-recording'), true); assert.equal(a.text.textContent, '00:00:00'); assert.equal(a.sink(), '● MTK 00:00:00');
    assert.equal(a.recordButton.disabled, false); assert.equal(a.recordButton.attributes.title, 'Stop multitrack recording');
    a.receiver.receive('3:::SETD^var.mtk.rec.time^3725'); assert.equal(a.text.textContent, '01:02:05'); assert.equal(a.sink(), '● MTK 01:02:05');
    a.timers.tick(5000); assert.equal(a.text.textContent, '01:02:05', 'there is no local timer: the time only follows received values');
  } finally { await a.close(); }
});

test('start refused by the desk with no drive: footer shows the mapped text and the button returns', async () => {
  const a = await app({ init: TOPOLOGY + mtk() }); // the desk reports a drive but refuses (for example it was pulled)
  try {
    a.recordButton.emit('click');
    a.writer.receive('3:::MSG^$REC_ERRNOSTICK\nSETD^var.mtk.rec.time^0\nDLGSHOW^usb_rec^$REC_ERRNOACCESS^$MSGBTN_OK');
    assert.equal(a.slot(), 'No USB drive in the desk.'); assert.equal(a.text.textContent, 'Record'); assert.equal(a.recordButton.disabled, false);
    assert.equal(a.recordButton.classList.contains('mm-recording'), false);
    a.recordButton.emit('click'); a.writer.receive('3:::MSG^$REC_ERRODDCODE'); assert.equal(a.slot(), 'Desk refused recording (REC_ERRODDCODE).');
    assert.deepEqual(a.writes(), ['3:::MTK_REC_TOGGLE', '3:::MTK_REC_TOGGLE'], 'each tap is explicit; nothing retries');
  } finally { await a.close(); }
});

test('start unconfirmed after 5 s and unknown after a disconnect are reported once', async () => {
  let a = await app();
  try { a.recordButton.emit('click'); a.timers.tick(5000); assert.match(a.slot(), /did not report recording within 5 s/); assert.equal(a.text.textContent, 'Record'); assert.equal(a.recordButton.disabled, false); }
  finally { await a.close(); }
  a = await app();
  try { a.recordButton.emit('click'); a.receiver.drop(); assert.match(a.slot(), /outcome is unknown\. No retry/); assert.equal(a.recordButton.disabled, true); assert.equal(a.controls.pending(), false); }
  finally { await a.close(); }
});

test('unknown elapsed time shows REC; a send failure settles once as unknown', async () => {
  const a = await app({ init: TOPOLOGY.replace('', '') + mtk({ state: 1 }).replace('\nSETD^var.mtk.rec.time^21', '') });
  try {
    assert.equal(a.rec().recording, true); assert.equal(a.rec().elapsed, null);
    assert.equal(a.text.textContent, 'REC'); assert.equal(a.sink(), '● MTK recording');
    a.receiver.receive('3:::SETD^var.mtk.rec.time^5'); assert.equal(a.text.textContent, '00:00:05');
  } finally { await a.close(); }
  const b = await app();
  try { b.writer.send = () => { throw Error('boom'); }; b.recordButton.emit('click'); assert.match(b.slot(), /outcome is unknown/); assert.equal(b.controls.pending(), false); }
  finally { await b.close(); }
});

test('stop dialog: opens from the recording button, live-updates the take, Keep recording sends nothing, Stop recording sends once', async () => {
  const a = await app({ init: TOPOLOGY + mtk({ state: 1, time: 5 }) });
  try {
    a.recordButton.focus(); a.recordButton.emit('click');
    assert.equal(a.owner.active().kind, 'recording'); assert.equal(a.dom.layer.hidden, false); assert.equal(a.dom.title.textContent, 'Stop multitrack recording?');
    assert.deepEqual(a.writes(), [], 'opening the dialog sends nothing');
    assert.ok(a.dom.body.textContent.includes('Current take · 00:00:05'));
    a.receiver.receive('3:::SETD^var.mtk.rec.time^6'); assert.ok(a.dom.body.textContent.includes('Current take · 00:00:06'), 'the dialog follows received time');
    a.byText('Keep recording').emit('click'); assert.equal(a.owner.active(), null); assert.equal(a.dom.layer.hidden, true); assert.deepEqual(a.writes(), []);
    assert.equal(a.dom.document.activeElement, a.recordButton, 'focus restored');
    a.recordButton.emit('click'); a.dom.close.emit('click'); assert.equal(a.owner.active(), null);
    a.recordButton.emit('click'); a.root.emit('keydown', { key: 'Escape' }); assert.equal(a.owner.active(), null); assert.deepEqual(a.writes(), []);
    a.recordButton.emit('click'); a.byText('Stop recording').emit('click');
    assert.deepEqual(a.writes(), ['3:::MTK_REC_TOGGLE']); assert.equal(a.owner.active(), null, 'the dialog closes once the stop is sent');
    assert.equal(a.text.textContent, 'Stopping…'); assert.equal(a.recordButton.disabled, true);
    a.receiver.receive('3:::SETD^var.mtk.rec.currentState^0');
    assert.equal(a.slot(), 'Recording stopped.'); assert.equal(a.text.textContent, 'Record'); assert.equal(a.recordButton.classList.contains('mm-recording'), false);
    assert.ok(a.log().includes('Recording stopped.'));
  } finally { await a.close(); }
});

test('stop dialog: stop unconfirmed is reported; an external stop closes the dialog; a refusal shows inside it', async () => {
  let a = await app({ init: TOPOLOGY + mtk({ state: 1 }) });
  try { a.recordButton.emit('click'); a.byText('Stop recording').emit('click'); a.timers.tick(5000); assert.match(a.slot(), /did not report recording stopped/); assert.equal(a.rec().recording, true); assert.equal(a.recordButton.disabled, false); }
  finally { await a.close(); }
  a = await app({ init: TOPOLOGY + mtk({ state: 1 }) });
  try {
    a.recordButton.emit('click'); assert.equal(a.owner.active().kind, 'recording');
    a.receiver.receive('3:::SETD^var.mtk.rec.currentState^0'); assert.equal(a.owner.active(), null, 'nothing left to stop');
    assert.deepEqual(a.writes(), []); assert.ok(a.log().includes('The desk stopped recording.'), 'an external stop is logged, not reported as ours');
    assert.equal(a.slot(), '');
  } finally { await a.close(); }
  a = await app({ init: TOPOLOGY + mtk({ state: 1 }) });
  try {
    a.recordButton.emit('click');
    a.receiver.receive('3:::SETS^settings.block.pass^x\nSETD^settings.block.player^0'); // the lock changes under the open dialog
    a.byText('Stop recording')?.emit('click');
    assert.deepEqual(a.writes(), [], 'the lock is revalidated at send');
    assert.ok(a.dom.body.textContent.includes('Locked on the desk.')); assert.equal(a.owner.active().kind, 'recording');
    a.byText('Close').emit('click'); assert.equal(a.owner.active(), null);
  } finally { await a.close(); }
});

test('dropping the connection closes the stop dialog and clears the elapsed time', async () => {
  const a = await app({ init: TOPOLOGY + mtk({ state: 1 }) });
  try {
    a.recordButton.emit('click'); assert.equal(a.owner.active().kind, 'recording');
    a.receiver.drop(); assert.equal(a.owner.active(), null); assert.equal(a.recordButton.disabled, true);
    assert.equal(a.sink(), 'Recording status unavailable'); assert.equal(a.text.textContent, 'Record', 'no stale elapsed time after disconnect');
  } finally { await a.close(); }
});

test('an external start is shown and logged without an operation; textContent only for desk strings', async () => {
  const a = await app();
  try {
    a.receiver.receive('3:::SETD^var.mtk.rec.currentState^1\nSETD^var.mtk.rec.time^0\nSETS^var.mtk.rec.session^<img src=x onerror=alert(1)>');
    assert.equal(a.recordButton.classList.contains('mm-recording'), true); assert.ok(a.log().includes('The desk started recording.')); assert.equal(a.slot(), '');
    assert.equal(a.rec().operation, null); assert.deepEqual(a.writes(), []);
    a.ui.diagnostics.show();
    const text = a.dom.body.textContent;
    for (const expected of ['Recording', 'Drive', 'present', 'Free space', '7000 (raw; units unverified)', 'Dropouts', 'State', 'recording (1)', 'Elapsed', '00:00:00', 'Session', '<img src=x onerror=alert(1)>', 'Busy', 'Recording lock', 'allowed', 'Last recording operation', 'none']) assert.ok(text.includes(expected), expected);
    assert.equal(a.dom.body.querySelectorAll('img').length, 0, 'a hostile session name is literal text');
    a.ui.diagnostics.close();
  } finally { await a.close(); }
});

test('the module builds no wire text and uses no innerHTML', async () => {
  const source = await readFile('src/iem/recording-controls.js', 'utf8');
  assert.ok(!source.includes('innerHTML') && !source.includes('MTK_') && !source.includes('.send('));
  const shell = await readFile('src/iem/shell.html', 'utf8');
  assert.match(shell, /data-action="record"[^>]*class="mm-record"|class="mm-record"/);
});
