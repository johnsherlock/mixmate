import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDialogOwner, restoreDialogFocus } from '../src/iem/dialog-owner.js';
import { mountPanControls, projectPanReadback } from '../src/iem/pan-controls.js';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createLiveConnectionUI } from '../src/iem/live-controller.js';
import { createGroupEditorUI } from '../src/iem/group-editor-ui.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';
import { projectLiveState } from '../src/iem/live-provider.js';
import { parseIemStateFrame } from '../src/iem/protocol.js';
import { domFixture, Node } from './helpers/fake-dom.js';
const target = { sourceId: 'i.0', auxIndex: 0 };
const FRAME = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.5\nSETD^a.1.mix^0.6\nSETD^i.0.stereoIndex^-1\nSETS^i.0.name^<img onerror=bad>\nSETD^i.0.aux.0.value^0.3\nSETD^i.0.aux.1.value^0.3\nSETD^i.0.aux.0.pan^0.25\nSETD^i.0.aux.1.pan^0.25\nSETD^f.0.aux.0.pan^0.5\nSETD^f.0.aux.1.pan^0.5';
function fixture(withBank = false) {
  const dom = domFixture(), owner = createDialogOwner(), window = new Node(dom.document); let socket, next = 0;
  const jobs = new Map(), timers = { setTimeout(fn) { const id = ++next; jobs.set(id, fn); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval() { return ++next; }, clearInterval() {} };
  class Socket { readyState = 0; sent = []; constructor() { socket = this; } send(message) { assert.ok(['3:::INIT', '3:::ALIVE', '2::'].includes(message) || parseIemStateFrame(message).length === 1); this.sent.push(message); } close() { this.readyState = 3; } receive(data) { this.onmessage?.({ data }); } }
  const engine = createAuxControlSession({ WebSocketClass: Socket, timers, now: () => 0, wallNow: () => 0 });
  let panBegins = 0, levelBegins = 0;
  const session = { ...engine, beginPanGesture() { panBegins++; return engine.beginPanGesture(); } };
  const contexts = new Set(), context = { profileId: 'rig', revision: 1, selectedAux: 0, sources: [{ sourceId: 'i.0', name: '<img onerror=bad>' }, { sourceId: 'f.0', name: 'FX' }] };
  const controller = { context: () => context, clearLevelContext() { engine.invalidateLevelContext(); }, subscribeContext(fn) { contexts.add(fn); fn(context); return () => contexts.delete(fn); } };
  const oldGlobals = Object.fromEntries(['document', 'window', 'matchMedia', 'innerHeight', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  let view, offBank = () => {};
  if (withBank) {
    Object.assign(globalThis, { document: dom.document, window, matchMedia: () => ({ matches: true }), innerHeight: 844, ResizeObserver: class { observe() {} disconnect() {} } });
    view = mountReadOnlyView(dom.root, { onBeginLevel: () => { levelBegins++; return engine.beginLevelGesture(); } });
    offBank = engine.subscribe(snapshot => view.render({ ...projectLiveState(snapshot, 0), view: 'channels', groups: [] }));
  }
  const connection = createLiveConnectionUI(dom.root, { levels: true, pan: true, dialogOwner: owner });
  const groups = createGroupEditorUI(dom.root, connection); groups.bind({ open: () => groups.show('Rig'), close: () => groups.hide() });
  const pan = mountPanControls({ root: dom.root, session, controller, dialogOwner: owner, window });
  engine.connect('192.168.0.60'); socket.readyState = 1; socket.onopen(); socket.receive(FRAME);
  return { ...dom, view, closeButton: dom.close, owner, controller, context, engine, socket, pan, connection, groups,
    get counts() { return { panBegins, levelBegins }; },
    writes: () => socket.sent.filter(message => message.startsWith('3:::SETD')),
    changeContext() { context.revision++; for (const fn of contexts) fn(context); },
    close() { pan.destroy(); groups.destroy(); connection.destroy(); offBank(); view?.destroy(); engine.disconnect(); for (const [key, value] of Object.entries(oldGlobals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } } };
}
test('dialog owner rejects stale/reentrant leases and focus restoration skips disabled or detached controls', () => {
  const owner = createDialogOwner(); let newest;
  const first = owner.claim('first', () => { newest = owner.claim('newest', () => {}); });
  const superseded = owner.claim('second', () => {}); assert.equal(superseded, null); assert.equal(owner.owns(newest), true); assert.equal(owner.close(first), false); assert.equal(owner.release(first), false);
  const dom = domFixture(), input = dom.document.createElement('input'); dom.root.append(input); let focused = 0; input.onFocus = () => focused++;
  input.disabled = true; restoreDialogFocus(input); assert.equal(focused, 0); input.disabled = false; input.remove(); restoreDialogFocus(input); assert.equal(focused, 0);
});
test('opening/Enable never write, presets use one opaque pan operation and raw unequal pair remains visible/unavailable', () => {
  const app = fixture();
  try {
    assert.equal(app.pan.open(target), true); assert.equal(app.layer.hidden, false); assert.equal(app.title.textContent.includes('<img onerror=bad>'), true); assert.equal(app.root.querySelectorAll('img').length, 0);
    assert.equal(app.writes().length, 0); app.root.querySelector('.mm-pan-enable').emit('click'); assert.equal(app.writes().length, 0);
    app.root.querySelector('.mm-pan-presets').children[1].emit('click'); assert.equal(app.counts.panBegins, 1); assert.equal(app.writes().length, 2);
    for (const message of app.writes()) app.socket.receive(message);
    app.socket.receive('3:::SETD^i.0.aux.0.pan^0.2504\nSETD^i.0.aux.1.pan^0.25049');
    assert.match(app.root.querySelector('.mm-pan-readbacks').textContent, /0.2504/); assert.match(app.root.querySelector('.mm-pan-readbacks').textContent, /0.25049/);
    assert.equal(app.root.querySelector('.mm-pan-enable').disabled, true); assert.match(app.root.querySelector('.mm-pan-status').textContent, /Unequal/);
  } finally { app.close(); }
});
test('pan modal has one gesture owner, never begins bank level gesture, and preserves cap/input/readback during preview updates', () => {
  const app = fixture(true);
  try {
    app.pan.open(target); app.root.querySelector('.mm-pan-enable').emit('click');
    const input = app.root.querySelector('.mm-pan-large'), cap = input.parentElement.querySelector('.mm-fader-hit'), row = app.root.querySelector('.mm-pan-readbacks').children[0];
    cap.emit('pointerdown', { pointerId: 1, button: 0, clientX: 80, clientY: 100 }); cap.emit('pointermove', { pointerId: 1, clientX: 130, clientY: 100 });
    assert.deepEqual(app.counts, { panBegins: 1, levelBegins: 0 }); assert.equal(app.writes().length, 0); assert.match(row.textContent, /0.25/);
    const value = input.value; app.socket.receive('3:::SETS^i.0.name^Renamed <svg>');
    assert.equal(app.root.querySelector('.mm-pan-large'), input); assert.equal(input.parentElement.querySelector('.mm-fader-hit'), cap); assert.equal(input.value, value); assert.equal(app.root.querySelector('.mm-pan-readbacks').children[0], row);
    cap.emit('pointerup', { pointerId: 1, clientX: 130, clientY: 100 }); assert.equal(app.writes().length, 2); assert.deepEqual(app.counts, { panBegins: 1, levelBegins: 0 });
  } finally { app.close(); }
});
test('single track/swipe do not write, keyup and double track each commit one operation, generic events cannot bypass', () => {
  const app = fixture();
  try {
    app.pan.open(target); app.root.querySelector('.mm-pan-enable').emit('click'); const input = app.root.querySelector('.mm-pan-large');
    input.emit('pointerdown', { pointerId: 1, button: 0, clientX: 80, clientY: 100 }); input.emit('pointerup', { pointerId: 1, clientX: 80, clientY: 100 }); assert.equal(app.writes().length, 0);
    input.emit('pointerdown', { pointerId: 2, button: 0, clientX: 80, clientY: 100 }); input.emit('pointermove', { pointerId: 2, clientX: 130, clientY: 140 }); input.emit('pointerup', { pointerId: 2, clientX: 130, clientY: 140 }); assert.equal(app.writes().length, 0);
    input.emit('keydown', { key: 'ArrowRight' }); assert.equal(app.writes().length, 0); input.emit('keyup', { key: 'ArrowRight' }); assert.equal(app.writes().length, 2); for (const message of app.writes()) app.socket.receive(message);
    for (let n = 0; n < 2; n++) { input.emit('pointerdown', { pointerId: 3, button: 0, clientX: 200, clientY: 100 }); input.emit('pointerup', { pointerId: 3, clientX: 200, clientY: 100 }); }
    assert.equal(app.writes().length, 4); input.emit('input'); input.emit('change'); assert.equal(app.writes().length, 4);
  } finally { app.close(); }
});
test('connection/groups/pan owners replace exclusively, close/Escape affect only current owner, and stale actions cannot commit new target', () => {
  const app = fixture();
  try {
    app.pan.open(target); const oldLease = app.owner.active(), preset = app.root.querySelector('.mm-pan-presets').children[1], stale = [...preset.handlers.get('click')][0];
    app.groups.show('Rig'); assert.equal(app.owner.active().kind, 'groups'); assert.equal(app.engine.snapshot().control.armed, false); assert.equal(app.owner.close(oldLease), false);
    app.pan.open(target); app.root.querySelector('.mm-pan-enable').emit('click'); stale(); assert.equal(app.writes().length, 0);
    app.root.querySelector('.mm-connect-toggle').emit('click'); assert.equal(app.owner.active().kind, 'connection'); assert.equal(app.engine.snapshot().control.armed, false);
    app.closeButton.emit('click'); assert.equal(app.owner.active(), null); assert.equal(app.layer.hidden, true);
    app.pan.open(target); app.root.emit('keydown', { key: 'Escape' }); assert.equal(app.owner.active(), null); assert.equal(app.layer.hidden, true);
  } finally { app.close(); }
});
test('same shared head click/Escape cannot close a new dialog opened reentrantly during old focus restoration', () => {
  for (const event of ['click', 'Escape']) {
    const app = fixture();
    try {
      const opener = app.root.querySelector('.mm-connect-toggle'); opener.focus(); opener.emit('click');
      opener.onFocus = () => app.groups.show('New owner');
      if (event === 'click') app.closeButton.emit('click'); else app.root.emit('keydown', { key: 'Escape' });
      assert.equal(app.owner.active().kind, 'groups'); assert.equal(app.layer.hidden, false);
    } finally { app.close(); }
  }
});
test('pan context/hide/native changes cancel or close without writes and unsupported FX retains read-only values', () => {
  const app = fixture();
  try {
    app.pan.open(target); app.root.querySelector('.mm-pan-enable').emit('click'); const input = app.root.querySelector('.mm-pan-large'), cap = input.parentElement.querySelector('.mm-fader-hit');
    cap.emit('pointerdown', { pointerId: 1, button: 0, clientX: 80, clientY: 100 }); cap.emit('pointermove', { pointerId: 1, clientX: 130, clientY: 100 });
    app.socket.receive('3:::SETD^i.0.aux.0.pan^0.7'); cap.emit('pointerup', { pointerId: 1, clientX: 130, clientY: 100 }); assert.equal(app.writes().length, 0); assert.equal(input.disabled, true);
    app.changeContext(); assert.equal(app.layer.hidden, true); assert.equal(app.engine.snapshot().control.armed, false);
    app.pan.open({ sourceId: 'f.0', auxIndex: 0 }); assert.match(app.root.querySelector('.mm-pan-readbacks').textContent, /0.5/); assert.equal(app.root.querySelector('.mm-pan-enable').disabled, true);
    app.engine.disconnect(); assert.equal(app.layer.hidden, true); assert.equal(app.writes().length, 0);
  } finally { app.close(); }
});


test('unresolved group members cannot present an enabled pan action without an observed destination', () => {
  const app = fixture(true);
  try {
    app.view.render({ ...projectLiveState(app.engine.snapshot(), 0), view: 'groups', groups: [], sources: [{ id: 'i.20@0', sourceId: 'i.20', name: 'Input 21 · Unresolved', unresolved: true }] });
    const button = app.root.querySelector('.mm-strip-scroll').children[0].querySelector('.mm-pan-button');
    assert.equal(button.disabled, true); assert.equal(button.dataset.openPan, undefined); assert.equal(button.dataset.panAux, undefined);
    assert.equal(app.writes().length, 0);
  } finally { app.close(); }
});

test('closing an armed pan dialog disables every owned action before focus callbacks', () => {
  const app = fixture();
  try {
    app.pan.open(target); app.root.querySelector('.mm-pan-enable').emit('click');
    const input = app.root.querySelector('.mm-pan-large'), enable = app.root.querySelector('.mm-pan-enable');
    const presets = [...app.root.querySelector('.mm-pan-presets').children];
    assert.equal(input.disabled, false);
    app.pan.close();
    assert.equal(input.disabled, true); assert.equal(enable.disabled, true);
    assert.ok(presets.every(button => button.disabled));
    assert.equal(app.engine.snapshot().control.armed, false); assert.equal(app.writes().length, 0);
  } finally { app.close(); }
});
