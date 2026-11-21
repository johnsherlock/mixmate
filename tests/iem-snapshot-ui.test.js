import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domFixture } from './helpers/fake-dom.js';
import { tidyLive } from '../src/iem/live-shell.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { createLiveConnectionUI, mountLiveController } from '../src/iem/live-controller.js';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { mountSnapshotControls, snapshotAvailability, RECALL_WARNING } from '../src/iem/snapshot-controls.js';
import { MESSAGE_TTL_MS } from '../src/iem/diagnostics.js';
import { SettingsRepository, emptySettings } from '../src/settings.js';

// F07-S02 snapshot dialogs: fake DOM, fake sockets and timers only. No desk,
// browser or network.
const BASE = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\nSETS^var.currentShow^Default\nSETS^var.currentSnapshot^MixMate1\nSETS^settings.block.pass^\nSETD^settings.block.loadshows^1\nSETD^settings.block.shows^0';
const LIST = '3:::SNAPSHOTLIST^Default^* Init *^AIC^MixMate1^MixMate2^^NSLYA';
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
const flush = () => new Promise(resolve => setImmediate(resolve));

async function app({ known = [], autoConnect = false, connect = true } = {}) {
  const dom = domFixture(), { root } = dom, sockets = [], timers = new Clock();
  tidyLive(root);
  const snapButton = dom.document.createElement('button'); snapButton.dataset.action = 'snapshots'; root.append(snapButton);
  const saveButton = dom.document.createElement('button'); saveButton.dataset.action = 'save'; root.append(saveButton);
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
  const repository = new SettingsRepository({ indexedDB: undefined }), settings = emptySettings();
  settings.knownAddresses = known; await repository.replace(settings);
  root.querySelector('.mm-diagnostics-open').disabled = true;
  const owner = createDialogOwner(), ui = createLiveConnectionUI(root, { levels: true, pan: true, dialogOwner: owner, timers });
  const view = { render() {}, preferences() {}, snapshotName() {}, destroy() {} };
  const document = Object.assign(new Events(), { hidden: false, activeElement: null }), window = new Events();
  const controller = mountLiveController({ session, repository, view, ui, document, window, timers, now: () => timers.now, autoConnect, createID: (() => { let n = 0; return () => `rig-${++n}`; })() });
  await controller.ready;
  const controls = mountSnapshotControls({ root, session, ui, dialogOwner: owner });
  const a = {
    dom, root, sockets, timers, session, repository, owner, ui, controller, controls, snapButton, saveButton,
    get writer() { return sockets.at(-2); }, get receiver() { return sockets.at(-1); },
    slot: () => root.querySelector('.mm-message').textContent,
    log: () => ui.diagnostics.entries().map(entry => entry.text),
    status: () => dom.body.querySelector('.mm-snapshot-status'),
    buttons: () => dom.body.querySelectorAll('button'),
    byText: text => dom.body.querySelectorAll('button').find(button => button.textContent === text),
    options: () => dom.body.querySelector('select').children,
    snaps: () => session.snapshot().snapshots,
    snapWrites: () => a.writer.sent.filter(message => !PLAIN.has(message)),
    live(init = BASE) { ui.address.value = '10.0.0.5'; ui.form.emit('submit'); a.writer.open(); a.receiver.open(); a.receiver.receive(init); },
    listed() { a.writer.receive(LIST); },
    async close() { controls.destroy(); controller.destroy(); await repository.close(); },
  };
  if (connect) a.live();
  return a;
}

test('availability reasons: not connected, no show, no current name, lock locked/unknown, pending', async () => {
  const a = await app({ connect: false });
  try {
    assert.equal(a.snapButton.disabled, true); assert.equal(a.saveButton.disabled, true);
    assert.match(a.snapButton.attributes.title, /Connect to the desk first/);
    a.ui.address.value = '10.0.0.5'; a.ui.form.emit('submit'); a.writer.open(); a.receiver.open();
    assert.equal(a.snapButton.disabled, true, 'socket-open is not qualified');
    a.receiver.receive(BASE.replace('SETS^var.currentSnapshot^MixMate1\n', ''));
    assert.equal(a.snapButton.disabled, true); assert.match(a.snapButton.attributes.title, /not reported a current snapshot/); assert.equal(a.saveButton.disabled, true);
    a.receiver.receive('3:::SETS^var.currentSnapshot^MixMate1');
    assert.equal(a.snapButton.disabled, false); assert.equal(a.saveButton.disabled, false, 'an empty lock password means nothing is locked');
    a.receiver.receive('3:::SETS^settings.block.pass^hunter2-lock\nSETD^settings.block.loadshows^0');
    assert.equal(a.snapButton.disabled, true); assert.match(a.snapButton.attributes.title, /Locked on the desk/);
    a.snapButton.emit('click'); assert.equal(a.owner.active(), null, 'a disabled button opens nothing');
    assert.equal(a.saveButton.disabled, true, 'shows lock is 0 on this desk'); assert.match(a.saveButton.attributes.title, /Locked on the desk/);
    a.receiver.receive('3:::SETD^settings.block.shows^1'); assert.equal(a.saveButton.disabled, false);
    a.receiver.receive('3:::SETS^settings.block.pass^'); a.receiver.receive('3:::SETD^settings.block.loadshows^1'); assert.equal(a.snapButton.disabled, false);
    assert.ok(!JSON.stringify(a.session.snapshot().snapshots).includes('hunter2-lock'), 'the lock password never leaves the session');
  } finally { await a.close(); }
  const info = { phase: 'live', qualified: true, snapshots: { show: 'Default', current: 'X', lock: { recall: 'unknown', save: 'allowed' }, operation: null } };
  assert.match(snapshotAvailability(info, 'recall'), /lock settings have not been received/); assert.equal(snapshotAvailability(info, 'save'), '');
  assert.match(snapshotAvailability(info, 'save', true), /waiting for the desk/);
  assert.match(snapshotAvailability({ ...info, snapshots: { ...info.snapshots, show: null } }, 'save'), /current show/);
});

test('recall dialog: opens, requests a list, loading then names (Init absent, current marked and preselected, text only)', async () => {
  const a = await app();
  try {
    a.snapButton.focus(); a.snapButton.emit('click');
    assert.equal(a.owner.active().kind, 'snapshots'); assert.equal(a.dom.layer.hidden, false); assert.equal(a.dom.title.textContent, 'Recall snapshot');
    assert.deepEqual(a.snapWrites(), ['3:::SNAPSHOTLIST^Default']);
    assert.equal(a.status().textContent, 'Loading snapshots…');
    const act = a.byText('Recall snapshot'); assert.equal(act.disabled, true);
    a.writer.receive('3:::SNAPSHOTLIST^Default^* Init *^AIC^MixMate1^<img src=x onerror=alert(1)>^NSLYA');
    assert.equal(a.status().hidden, true);
    const names = a.options().map(option => option.value);
    assert.deepEqual(names, ['', 'AIC', 'MixMate1', '<img src=x onerror=alert(1)>', 'NSLYA']);
    assert.ok(!names.includes('* Init *'));
    assert.equal(a.options()[3].textContent, '<img src=x onerror=alert(1)>', 'an HTML-like name is literal text');
    assert.equal(a.options()[2].textContent, 'MixMate1 (current)'); assert.equal(a.dom.body.querySelector('select').value, 'MixMate1');
    assert.equal(act.disabled, false, 'recalling the current snapshot is allowed');
    assert.ok(a.dom.body.textContent.includes(RECALL_WARNING)); assert.equal(RECALL_WARNING, 'Recall changes desk settings for everyone.');
    a.byText('Cancel').emit('click'); assert.equal(a.owner.active(), null); assert.equal(a.dom.layer.hidden, true); assert.equal(a.dom.document.activeElement, a.snapButton, 'focus restored');
    assert.equal(a.snapWrites().length, 1, 'cancel sends nothing');
    a.snapButton.emit('click'); a.dom.close.emit('click'); assert.equal(a.owner.active(), null);
    a.snapButton.emit('click'); a.root.emit('keydown', { key: 'Escape' }); assert.equal(a.owner.active(), null);
  } finally { await a.close(); }
});

test('recall dialog: a truncated list shows one note; no preselection when the current name is not listed', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click');
    a.writer.receive(`3:::SNAPSHOTLIST^Default^${Array.from({ length: 400 }, (_, i) => `S${i}`).join('^')}`);
    assert.equal(a.snaps().list.truncated, true);
    assert.match(a.dom.body.querySelector('.mm-snapshot-note').textContent, /truncated/);
    assert.equal(a.dom.body.querySelector('select').value, '', 'MixMate1 is not listed: nothing preselected');
    assert.equal(a.byText('Recall snapshot').disabled, true);
  } finally { await a.close(); }
});

test('recall: sends the selected name; pending disables buttons and blocks close; confirmed closes with the footer message', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); a.listed();
    const select = a.dom.body.querySelector('select'); select.value = 'MixMate2'; select.emit('change');
    a.byText('Recall snapshot').emit('click');
    assert.deepEqual(a.snapWrites(), ['3:::SNAPSHOTLIST^Default', '3:::LOADSNAPSHOT^Default^MixMate2']);
    assert.equal(a.status().textContent, 'Recalling MixMate2…');
    assert.ok(a.buttons().every(button => button.disabled), 'every dialog button is disabled while pending');
    assert.equal(a.dom.close.disabled, true); assert.equal(a.snapButton.disabled, true); assert.equal(a.saveButton.disabled, true);
    a.dom.close.emit('click'); a.root.emit('keydown', { key: 'Escape' });
    assert.equal(a.owner.active().kind, 'snapshots', 'modal while pending: no strip gesture can start behind it');
    assert.equal(a.controls.pending(), true);
    a.writer.receive('3:::MSG^$SNAPLOAD^MixMate2');
    assert.equal(a.owner.active(), null); assert.equal(a.dom.layer.hidden, true);
    assert.equal(a.slot(), 'Recalled MixMate2.');
    assert.ok(a.log().some(text => /Recalled MixMate2\./.test(text)));
    assert.equal(a.snapWrites().length, 2, 'no retry');
    a.timers.tick(MESSAGE_TTL_MS + 1); assert.equal(a.slot(), '', 'the transient slot expires');
  } finally { await a.close(); }
});

test('recall: unconfirmed keeps the session text; no retry and no further send', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); a.listed(); a.byText('Recall snapshot').emit('click');
    a.timers.tick(5000);
    assert.match(a.status().textContent, /did not report it within 5 s/);
    assert.equal(a.owner.active().kind, 'snapshots'); assert.equal(a.byText('Recall snapshot').disabled, true); assert.equal(a.byText('Close').disabled, false);
    assert.match(a.slot(), /Recall MixMate1: .*did not report it within 5 s/);
    assert.ok(a.log().some(text => /Recall MixMate1: /.test(text)));
    assert.equal(a.snapWrites().length, 2);
    a.byText('Close').emit('click'); assert.equal(a.owner.active(), null);
  } finally { await a.close(); }
});

test('recall: a disconnect while pending shows the unknown outcome, never success', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); a.listed();
    const select = a.dom.body.querySelector('select'); select.value = 'AIC'; select.emit('change');
    a.byText('Recall snapshot').emit('click');
    a.writer.drop();
    assert.match(a.status().textContent, /outcome is unknown\. No retry/); assert.equal(a.owner.active().kind, 'snapshots');
    assert.match(a.slot(), /Recall AIC: .*unknown/); assert.ok(a.log().some(text => /Recall AIC: /.test(text)));
    assert.equal(a.byText('Recall snapshot').disabled, true); assert.equal(a.dom.close.disabled, false);
    assert.equal(a.snapWrites().length, 2);
    a.dom.close.emit('click'); assert.equal(a.owner.active(), null);
    assert.equal(a.snapButton.disabled, true);
  } finally { await a.close(); }
});

test('recall and save refusals show the session reason in the dialog and never retry', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); a.listed();
    a.receiver.receive('3:::UPDATE_SHOWS'); // the list is now stale
    a.byText('Recall snapshot').emit('click');
    assert.match(a.status().textContent, /desk changed its shows; refresh the snapshot list/);
    assert.deepEqual(a.snapWrites(), ['3:::SNAPSHOTLIST^Default'], 'a refusal sends nothing');
    assert.equal(a.controls.pending(), false); a.dom.close.emit('click');
    a.snapButton.emit('click'); assert.equal(a.snapWrites().length, 2, 'a fresh list is requested on every open'); a.listed(); assert.equal(a.status().hidden, true);
    a.dom.close.emit('click');
    a.receiver.receive('3:::SETD^settings.block.shows^1');
    a.saveButton.emit('click'); a.listed(); a.receiver.receive('3:::UPDATE_SHOWS');
    a.byText('Save snapshot').emit('click');
    assert.match(a.status().textContent, /refresh the snapshot list/); assert.equal(a.snapWrites().filter(message => message.startsWith('3:::SAVESNAPSHOT')).length, 0);
  } finally { await a.close(); }
});

test('recall dialog: when the desk never answers the list request the dialog says so', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); assert.equal(a.status().textContent, 'Loading snapshots…');
    a.timers.tick(5001);
    assert.match(a.status().textContent, /did not send its snapshot list/); assert.equal(a.byText('Recall snapshot').disabled, true);
  } finally { await a.close(); }
});

test('save dialog: requests a list, names the current snapshot with textContent, reported wording never claims verification', async () => {
  const a = await app();
  try {
    a.receiver.receive('3:::SETD^settings.block.shows^1');
    a.saveButton.focus(); a.saveButton.emit('click');
    assert.equal(a.dom.title.textContent, 'Save current snapshot'); assert.equal(a.owner.active().kind, 'snapshots');
    assert.deepEqual(a.snapWrites(), ['3:::SNAPSHOTLIST^Default']); assert.equal(a.status().textContent, 'Loading snapshots…');
    assert.equal(a.byText('Save snapshot').disabled, true);
    a.listed();
    assert.equal(a.dom.body.querySelector('.mm-warning').textContent, 'Overwrite “MixMate1” with the current desk settings?');
    assert.equal(a.dom.body.querySelector('label').hidden, true, 'no name entry or save-as');
    a.byText('Save snapshot').emit('click');
    assert.equal(a.snapWrites().at(-1), '3:::SAVESNAPSHOT^Default^MixMate1');
    assert.equal(a.status().textContent, 'Saving…'); assert.ok(a.buttons().every(button => button.disabled));
    a.receiver.receive('3:::UPDATE_SHOWS');
    assert.equal(a.owner.active(), null);
    assert.equal(a.slot(), 'Save sent for MixMate1; the desk reported a show change (contents not verified).'); assert.ok(!/^Saved/.test(a.slot()));
    assert.equal(a.dom.document.activeElement, a.saveButton);
  } finally { await a.close(); }
});

test('save dialog: unconfirmed keeps the session text; a current name that is not listed cannot be saved', async () => {
  const a = await app();
  try {
    a.receiver.receive('3:::SETD^settings.block.shows^1');
    a.saveButton.emit('click'); a.listed(); a.byText('Save snapshot').emit('click'); a.timers.tick(3000);
    assert.match(a.status().textContent, /did not report a show change within 3 s/); assert.match(a.slot(), /Save MixMate1: .*3 s/);
    assert.equal(a.byText('Save snapshot').disabled, true); a.byText('Close').emit('click');
    a.receiver.receive('3:::SETS^var.currentSnapshot^Unlisted');
    a.saveButton.emit('click'); a.listed();
    assert.match(a.status().textContent, /“Unlisted” is not in the desk’s list/); assert.equal(a.byText('Save snapshot').disabled, true);
  } finally { await a.close(); }
});

test('the rig switch during a recall still delivers the outcome to the footer slot and the log, even after the dialog is replaced', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); a.listed();
    const select = a.dom.body.querySelector('select'); select.value = 'MixMate2'; select.emit('change');
    a.byText('Recall snapshot').emit('click');
    // Another dialog replaces ours while the recall is outstanding.
    const other = a.owner.claim('other', () => {}); assert.ok(other); assert.equal(a.controls.visible(), false);
    assert.equal(a.controls.pending(), true);
    // The desk switches snapshots: the controller follows it with a new rig.
    a.receiver.receive('3:::SETS^var.currentSnapshot^MixMate2'); await flush(); await a.controller.whenRigIdle(); await flush();
    assert.equal(a.slot(), 'Recalled MixMate2.');
    assert.ok(a.log().some(text => /Recalled MixMate2\./.test(text)));
    assert.equal(a.snaps().operation.status, 'confirmed'); assert.equal(a.controls.pending(), false);
    assert.equal(a.owner.active(), other, 'the unrelated dialog is untouched');
    assert.equal(a.repository.snapshot().settings.profiles.some(rig => rig.name === 'MixMate2'), true, 'the rig followed the desk');
  } finally { await a.close(); }
});

test('while a snapshot dialog is open, automatic connection waits and resumes after it closes', async () => {
  const a = await app({ known: ['10.0.0.5'], autoConnect: true, connect: false });
  try {
    a.timers.tick(0); await flush();
    assert.equal(a.sockets.length, 2, 'automatic pass on open'); a.writer.open(); a.receiver.open(); a.receiver.receive(BASE);
    for (let step = 0; step < 4; step++) { a.timers.tick(10000); a.receiver.receive('2::'); a.writer.receive('2::'); } // stay alive past the 30 s reconnection guard
    a.snapButton.emit('click'); a.listed(); a.byText('Recall snapshot').emit('click');
    assert.equal(a.owner.active().kind, 'snapshots');
    a.writer.drop(); a.timers.tick(0); await flush();
    assert.equal(a.sockets.length, 2, 'no pass starts behind the open dialog');
    assert.match(a.status().textContent, /unknown/);
    a.dom.close.emit('click'); a.timers.tick(0); await flush(); a.timers.tick(0);
    assert.equal(a.sockets.length, 4, 'the deferred pass resumes once the dialog closes');
  } finally { await a.close(); }
});

test('Diagnostics lists the Snapshots rows from received state and the operation log', async () => {
  const a = await app();
  try {
    a.ui.diagnostics.show();
    const rows = () => Object.fromEntries(a.dom.body.querySelectorAll('.mm-diag-row').map(row => [row.children[0].textContent, row.children[1].textContent]));
    assert.equal(rows().Show, 'Default'); assert.equal(rows().Current, 'MixMate1'); assert.equal(rows().List, 'none · 0 names');
    assert.equal(rows()['Last operation'], 'none'); assert.equal(rows().Lock, 'recall allowed · save allowed');
    a.ui.diagnostics.close();
    a.snapButton.emit('click'); a.listed(); a.byText('Recall snapshot').emit('click');
    a.ui.diagnostics.show();
    assert.equal(rows().List, 'fresh · 4 names'); assert.equal(rows()['Last operation'], 'recall · MixMate1 · pending');
    a.writer.receive('3:::MSG^$SNAPLOAD^MixMate1');
    assert.equal(rows()['Last operation'], 'recall · MixMate1 · confirmed');
  } finally { await a.close(); }
});

test('the module builds no wire text, never uses innerHTML and does not touch Record/Native', async () => {
  const source = await readFile(new URL('../src/iem/snapshot-controls.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|SNAPSHOTLIST|LOADSNAPSHOT|SAVESNAPSHOT|\.send\(/.test(source.replace(/\/\/.*$/gm, '')));
  assert.ok(!/data-action="record"|data-action="native"/.test(source));
});

test('review round 1: every open preselects the current snapshot, never the previous choice', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); a.listed();
    const select = a.dom.body.querySelector('select'); select.value = 'NSLYA'; select.emit('change'); a.byText('Cancel').emit('click');
    a.snapButton.emit('click'); a.listed();
    assert.equal(a.dom.body.querySelector('select').value, 'MixMate1');
    a.dom.close.emit('click');
    a.receiver.receive('3:::SETS^var.currentSnapshot^Unlisted');
    a.snapButton.emit('click'); a.listed();
    assert.equal(a.dom.body.querySelector('select').value, '', 'placeholder when the current snapshot is not listed');
    assert.equal(a.byText('Recall snapshot').disabled, true);
  } finally { await a.close(); }
});

test('review round 1: pending focuses the dialog and traps Tab; results focus Cancel/Close', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); a.listed(); a.byText('Recall snapshot').emit('click');
    const dialog = a.dom.layer.children[0];
    assert.equal(a.dom.document.activeElement, dialog); assert.equal(dialog.attributes.tabindex, '-1');
    let prevented = false; a.root.emit('keydown', { key: 'Tab', preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(a.dom.document.activeElement, dialog);
    a.timers.tick(5000);
    assert.equal(a.dom.document.activeElement, a.byText('Close'));
  } finally { await a.close(); }
});

test('review round 1: each outcome is logged once; a send failure is one coherent entry', async () => {
  const a = await app();
  try {
    a.snapButton.emit('click'); a.listed(); a.byText('Recall snapshot').emit('click'); a.writer.receive('3:::MSG^$SNAPLOAD^MixMate1');
    assert.equal(a.log().filter(text => /MixMate1/.test(text) && /Recalled|confirmed/.test(text)).length, 1);
  } finally { await a.close(); }
  const b = await app();
  try {
    b.snapButton.emit('click'); b.listed(); b.writer.send = () => { throw Error('boom'); };
    b.byText('Recall snapshot').emit('click');
    const entries = b.log().filter(text => /Recall MixMate1|recall MixMate1/.test(text));
    assert.equal(entries.length, 1, JSON.stringify(entries)); assert.match(b.status().textContent, /unknown|failed/i);
    assert.equal(b.controls.pending(), false);
  } finally { await b.close(); }
});
