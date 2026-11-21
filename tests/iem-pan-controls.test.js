import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { commonPanWire, panDisplayAmount, panDisplayText } from '../src/iem/pan-display.js';
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
// Existing diagnostic assertions mount with ?debug; default-UI tests pass debug = false.
function fixture(withBank = false, debug = true) {
  const dom = domFixture(), owner = createDialogOwner(), window = new Node(dom.document); let socket, next = 0; const sockets = [];
  const jobs = new Map(), timers = { setTimeout(fn) { const id = ++next; jobs.set(id, fn); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval() { return ++next; }, clearInterval() {} };
  class Socket { readyState = 0; sent = []; constructor() { sockets.push(this); } send(message) { assert.ok(['3:::INIT', '3:::ALIVE', '2::'].includes(message) || parseIemStateFrame(message).length === 1); this.sent.push(message); } close() { this.readyState = 3; } receive(data) { (this.receiver ?? this).onmessage?.({ data }); } }
  let time = 0; const engine = createAuxControlSession({ WebSocketClass: Socket, timers, now: () => time, wallNow: () => time });
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
  const pan = mountPanControls({ root: dom.root, session, controller, dialogOwner: owner, window, debug });
  engine.connect('192.168.0.60'); socket = sockets[0]; socket.receiver = sockets[1]; for (const connection of sockets) { connection.readyState = 1; connection.onopen(); } socket.receive(FRAME);
  return { ...dom, view, closeButton: dom.close, owner, controller, context, engine, socket, pan, connection, groups,
    get counts() { return { panBegins, levelBegins }; },
    advance(ms) { time += ms; },
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
    assert.equal(app.writes().length, 0); assert.equal(app.root.querySelector('.mm-pan-enable'), null); assert.equal(app.writes().length, 0);
    app.root.querySelector('.mm-pan-presets').children[1].emit('click'); assert.equal(app.counts.panBegins, 1); assert.equal(app.writes().length, 2);
    for (const message of app.writes()) app.socket.receive(message);
    app.socket.receive('3:::SETD^i.0.aux.0.pan^0.2504\nSETD^i.0.aux.1.pan^0.25049');
    assert.match(app.root.querySelector('.mm-pan-readbacks').textContent, /0.2504/); assert.match(app.root.querySelector('.mm-pan-readbacks').textContent, /0.25049/);
    assert.equal(app.root.querySelector('.mm-pan-large').disabled, true); assert.match(app.root.querySelector('.mm-pan-status').textContent, /Unequal/);
  } finally { app.close(); }
});
test('pan modal has one gesture owner, never begins bank level gesture, and preserves cap/input/readback during preview updates', () => {
  const app = fixture(true);
  try {
    app.pan.open(target); assert.equal(app.root.querySelector('.mm-pan-enable'), null);
    const input = app.root.querySelector('.mm-pan-large'), cap = input.parentElement.querySelector('.mm-fader-hit'), row = app.root.querySelector('.mm-pan-readbacks').children[0];
    cap.emit('pointerdown', { pointerId: 1, button: 0, clientX: 80, clientY: 100 }); cap.emit('pointermove', { pointerId: 1, clientX: 130, clientY: 100 });
    assert.deepEqual(app.counts, { panBegins: 1, levelBegins: 0 }); assert.equal(app.writes().length, 2, 'cap drag streams live'); assert.match(row.textContent, /0.25/);
    const value = input.value; app.socket.receive('3:::SETS^i.0.name^Renamed <svg>');
    assert.equal(app.root.querySelector('.mm-pan-large'), input); assert.equal(input.parentElement.querySelector('.mm-fader-hit'), cap); assert.equal(input.value, value); assert.equal(app.root.querySelector('.mm-pan-readbacks').children[0], row);
    cap.emit('pointerup', { pointerId: 1, clientX: 130, clientY: 100 }); assert.equal(app.writes().length, 2, 'unchanged release adds nothing'); assert.deepEqual(app.counts, { panBegins: 1, levelBegins: 0 });
  } finally { app.close(); }
});
test('single track/swipe do not write, key repeat streams live and double track jumps once, generic events cannot bypass', () => {
  const app = fixture();
  try {
    app.pan.open(target); assert.equal(app.root.querySelector('.mm-pan-enable'), null); const input = app.root.querySelector('.mm-pan-large');
    input.emit('pointerdown', { pointerId: 1, button: 0, clientX: 80, clientY: 100 }); input.emit('pointerup', { pointerId: 1, clientX: 80, clientY: 100 }); assert.equal(app.writes().length, 0);
    input.emit('pointerdown', { pointerId: 2, button: 0, clientX: 80, clientY: 100 }); input.emit('pointermove', { pointerId: 2, clientX: 130, clientY: 140 }); input.emit('pointerup', { pointerId: 2, clientX: 130, clientY: 140 }); assert.equal(app.writes().length, 0);
    input.emit('keydown', { key: 'ArrowRight' }); assert.equal(app.writes().length, 2, 'deliberate key gesture streams'); input.emit('keyup', { key: 'ArrowRight' }); assert.equal(app.writes().length, 2); for (const message of app.writes()) app.socket.receive(message);
    for (let n = 0; n < 2; n++) { input.emit('pointerdown', { pointerId: 3, button: 0, clientX: 200, clientY: 100 }); input.emit('pointerup', { pointerId: 3, clientX: 200, clientY: 100 }); }
    assert.equal(app.writes().length, 4); input.emit('input'); input.emit('change'); assert.equal(app.writes().length, 4);
  } finally { app.close(); }
});
test('connection/groups/pan owners replace exclusively, close/Escape affect only current owner, and stale actions cannot commit new target', () => {
  const app = fixture();
  try {
    app.pan.open(target); const oldLease = app.owner.active(), preset = app.root.querySelector('.mm-pan-presets').children[1], stale = [...preset.handlers.get('click')][0];
    app.groups.show('Rig'); assert.equal(app.owner.active().kind, 'groups'); assert.equal(app.engine.snapshot().control.armed, false); assert.equal(app.owner.close(oldLease), false);
    app.pan.open(target); assert.equal(app.root.querySelector('.mm-pan-enable'), null); stale(); assert.equal(app.writes().length, 0);
    app.root.querySelector('.mm-desk').emit('click'); assert.equal(app.owner.active().kind, 'connection'); assert.equal(app.engine.snapshot().control.armed, false);
    app.closeButton.emit('click'); assert.equal(app.owner.active(), null); assert.equal(app.layer.hidden, true);
    app.pan.open(target); app.root.emit('keydown', { key: 'Escape' }); assert.equal(app.owner.active(), null); assert.equal(app.layer.hidden, true);
  } finally { app.close(); }
});
test('same shared head click/Escape cannot close a new dialog opened reentrantly during old focus restoration', () => {
  for (const event of ['click', 'Escape']) {
    const app = fixture();
    try {
      const opener = app.root.querySelector('.mm-desk'); opener.focus(); opener.emit('click');
      opener.onFocus = () => app.groups.show('New owner');
      if (event === 'click') app.closeButton.emit('click'); else app.root.emit('keydown', { key: 'Escape' });
      assert.equal(app.owner.active().kind, 'groups'); assert.equal(app.layer.hidden, false);
    } finally { app.close(); }
  }
});
test('pan context/hide/native changes cancel or close without writes and unsupported FX retains read-only values', () => {
  const app = fixture();
  try {
    app.pan.open(target); assert.equal(app.root.querySelector('.mm-pan-enable'), null); const input = app.root.querySelector('.mm-pan-large'), cap = input.parentElement.querySelector('.mm-fader-hit');
    cap.emit('pointerdown', { pointerId: 1, button: 0, clientX: 80, clientY: 100 }); cap.emit('pointermove', { pointerId: 1, clientX: 130, clientY: 100 });
    assert.equal(app.writes().length, 2, 'live step');
    app.socket.receive('3:::SETD^i.0.aux.0.pan^0.7'); cap.emit('pointerup', { pointerId: 1, clientX: 130, clientY: 100 }); assert.equal(app.writes().length, 2, 'native edit stops the stream; release sends nothing'); assert.equal(input.disabled, true);
    app.changeContext(); assert.equal(app.layer.hidden, true); assert.equal(app.engine.snapshot().control.armed, false);
    app.pan.open({ sourceId: 'f.0', auxIndex: 0 }); assert.match(app.root.querySelector('.mm-pan-readbacks').textContent, /0.5/); assert.equal(app.root.querySelector('.mm-pan-large').disabled, true);
    app.engine.disconnect(); assert.equal(app.layer.hidden, true); assert.equal(app.writes().length, 2);
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
    app.pan.open(target); assert.equal(app.root.querySelector('.mm-pan-enable'), null);
    const input = app.root.querySelector('.mm-pan-large');
    const presets = [...app.root.querySelector('.mm-pan-presets').children];
    assert.equal(input.disabled, false);
    app.pan.close();
    assert.equal(input.disabled, true);
    assert.ok(presets.every(button => button.disabled));
    assert.equal(app.engine.snapshot().control.armed, false); assert.equal(app.writes().length, 0);
  } finally { app.close(); }
});


test('F04-S05 Edit Groups never detours into rig setup; it only asks the group editor to open', () => {
  const app = fixture();
  try {
    let opens = 0;
    app.groups.bind({ open: () => { opens++; return false; }, close: () => app.groups.hide() });
    const button = app.root.querySelector('[data-action="edit-groups"]'); button.disabled = false; button.emit('click');
    assert.equal(opens, 1); assert.equal(app.owner.active(), null);
    assert.equal(app.writes().length, 0);
  } finally { app.close(); }
});

test('F09-S09 pan display text follows the Demo convention: wire 0 = L 100, 0.5 = CENTRE, 1 = R 100, linear, rounded; unknown/unequal has none', async () => {
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map(panDisplayText), ['L 100', 'L 50', 'CENTRE', 'R 50', 'R 100']);
  assert.equal(panDisplayText(0.849), 'R 70'); assert.equal(panDisplayText(0.151), 'L 70', 'symmetric rounding');
  assert.equal(panDisplayText(0.4976), 'CENTRE'); assert.equal(panDisplayAmount(0.4975), -1); assert.ok(Object.is(panDisplayAmount(0.5), 0));
  for (const bad of [undefined, null, NaN, -0.1, 1.1, '0.5', Infinity]) assert.equal(panDisplayText(bad), null);
  assert.equal(commonPanWire([0.25, 0.25]), 0.25); assert.equal(commonPanWire([0.25, 0.2504]), undefined); assert.equal(commonPanWire([0.25, undefined]), undefined); assert.equal(commonPanWire([]), undefined);
  const demo = await readFile(new URL('../src/iem/demo-view.js', import.meta.url), 'utf8');
  assert.match(demo, /"PAN · CENTRE"/); assert.match(demo, /`PAN · \$\{v < 0 \? "L" : "R"\} \$\{Math\.abs\(v\)\}`/);
});

test('F09-S09 default pan dialog matches the prototype: MIX · CHANNEL · PAN, LEFT/CENTRE/RIGHT, large L/R readout, Hard L/Centre/Hard R, footer; no diagnostics', () => {
  const app = fixture(false, false);
  try {
    app.socket.receive('3:::SETS^a.0.name^Drums IEM');
    assert.equal(app.pan.open(target), true);
    assert.equal(app.title.textContent, 'Drums IEM · <img onerror=bad> · PAN'); assert.equal(app.root.querySelectorAll('img').length, 0);
    for (const selector of ['.mm-pan-status', '.mm-pan-details', '.mm-pan-readbacks', '.mm-pan-diagnostic', '.mm-caption']) assert.equal(app.root.querySelector(`.mm-live-pan-controls ${selector}`) ?? app.root.querySelector(selector), null, `${selector} is not rendered`);
    const content = app.root.querySelector('.mm-live-pan-controls');
    assert.doesNotMatch(content.textContent, /Last requested|normalized|received normalized|Ready to edit|authorized/);
    assert.deepEqual(app.root.querySelector('.mm-pan-labels').children.map(node => node.textContent), ['LEFT', 'CENTRE', 'RIGHT']);
    const value = app.root.querySelector('.mm-pan-value'), input = app.root.querySelector('.mm-pan-large'), footer = app.root.querySelector('.mm-pan-keys');
    assert.equal(value.textContent, 'L 50'); assert.equal(input.attributes['aria-valuetext'], 'Pan L 50'); assert.match(input.attributes['aria-label'], /pan/);
    assert.equal(footer.textContent, 'Fine control · full-width travel');
    const presets = [...app.root.querySelector('.mm-pan-presets').children];
    assert.deepEqual(presets.map(button => button.textContent), ['Hard L', 'Centre', 'Hard R']);
    presets[2].emit('click'); assert.deepEqual(app.writes(), ['3:::SETD^i.0.aux.0.pan^1', '3:::SETD^i.0.aux.1.pan^1'], 'Hard R is a deliberate one-shot through the typed path (wire unchanged)');
    assert.equal(value.textContent, 'R 100');
    for (const message of app.writes()) app.socket.receive(message);
    presets[0].emit('click'); assert.deepEqual(app.writes().slice(2), ['3:::SETD^i.0.aux.0.pan^0', '3:::SETD^i.0.aux.1.pan^0']); assert.equal(value.textContent, 'L 100');
    for (const message of app.writes().slice(2)) app.socket.receive(message);
    app.socket.receive('3:::SETD^i.0.aux.1.pan^0.3');
    assert.equal(value.textContent, '—'); assert.equal(input.disabled, true); assert.equal(footer.textContent, 'Read-only · L/R pan unequal'); assert.match(footer.attributes.title, /Unequal/);
  } finally { app.close(); }
});

test('F09-S09 strip Pan button shows PAN · L/CENTRE/R from received actual, the requested value during this owner\'s gesture, and just "Pan" when unequal', () => {
  const app = fixture(true, false);
  try {
    const button = id => app.root.querySelectorAll('[data-open-pan]').find(node => node.dataset.openPan === id);
    assert.equal(button('i.0').querySelector('.mm-pan-short').textContent, 'PAN · L 50');
    assert.equal(button('f.0').querySelector('.mm-pan-short').textContent, 'PAN · CENTRE');
    assert.match(button('i.0').attributes['aria-label'], /L 50/);
    app.pan.open(target);
    const input = app.root.querySelector('.mm-pan-large'), cap = input.parentElement.querySelector('.mm-fader-hit');
    cap.emit('pointerdown', { pointerId: 1, button: 0, clientX: 80, clientY: 100 }); cap.emit('pointermove', { pointerId: 1, clientX: 130, clientY: 100 });
    const requested = app.engine.snapshot().control.requestedValue; assert.equal(typeof requested, 'number'); assert.notEqual(requested, 0.25);
    assert.equal(button('i.0').querySelector('.mm-pan-short').textContent, `PAN · ${panDisplayText(requested)}`, 'live requested preview during the gesture');
    assert.equal(button('i.0').dataset.panRequested, 'true');
    cap.emit('pointerup', { pointerId: 1, clientX: 130, clientY: 100 });
    for (const message of app.writes()) app.socket.receive(message);
    app.pan.close();
    app.socket.receive('3:::SETD^i.0.aux.0.pan^0.6\nSETD^i.0.aux.1.pan^0.7');
    assert.equal(button('i.0').querySelector('.mm-pan-short').textContent, 'Pan', 'unequal sides: just Pan');
    assert.equal(app.writes().every(message => /^3:::SETD\^i\.0\.aux\.[01]\.pan\^/.test(message)), true);
  } finally { app.close(); }
});

test('F09-S09 review P1: after an unechoed preset and the 2.5 s window, the dialog readout, aria-valuetext and slider show the received value, like the strip', () => {
  const app = fixture(true, false);
  try {
    app.pan.open(target);
    const value = app.root.querySelector('.mm-pan-value'), input = app.root.querySelector('.mm-pan-large');
    const strip = app.root.querySelectorAll('[data-open-pan]').find(node => node.dataset.openPan === 'i.0');
    app.root.querySelector('.mm-pan-presets').children[2].emit('click');
    assert.deepEqual(app.writes(), ['3:::SETD^i.0.aux.0.pan^1', '3:::SETD^i.0.aux.1.pan^1']);
    assert.equal(value.textContent, 'R 100', 'pending own request is shown while live');
    app.advance(2600); app.socket.receive('3:::SETS^i.23.name^Unrelated'); // no echo; the observation window expires
    const control = app.engine.snapshot().control;
    assert.equal(control.pending, false); assert.equal(control.gestureActive, false); assert.equal(control.requestedValue, 1, 'the session keeps the requested chain');
    assert.equal(value.textContent, 'L 50'); assert.equal(input.attributes['aria-valuetext'], 'Pan L 50'); assert.equal(input.value, '0.25');
    assert.equal(strip.querySelector('.mm-pan-short').textContent, 'PAN · L 50');
    app.socket.receive('3:::SETD^i.0.aux.1.pan^0.3');
    assert.equal(value.textContent, '—', 'unequal sides: no shared value'); assert.equal(input.value, '0.25', 'slider falls back to the first received side');
    assert.equal(input.attributes['aria-valuetext'], 'Pan unknown or unequal');
  } finally { app.close(); }
});

test('F09-S09 re-review P1: after an unechoed preset and the window, grabbing the cap or stepping a key starts from the received 0.25, never the retained request', () => {
  const pans = list => list.map(message => Number(message.split('^')[2]));
  const settle = app => {
    app.pan.open(target); app.root.querySelector('.mm-pan-presets').children[2].emit('click');
    app.advance(2600); app.socket.receive('3:::SETS^i.23.name^Unrelated');
    assert.equal(app.engine.snapshot().control.requestedValue, 1); return { input: app.root.querySelector('.mm-pan-large'), value: app.root.querySelector('.mm-pan-value'), sent: app.writes().length };
  };
  const drag = fixture(true, false);
  try {
    const { input, value, sent } = settle(drag), cap = input.parentElement.querySelector('.mm-fader-hit');
    cap.emit('pointerdown', { pointerId: 1, button: 0, clientX: 80, clientY: 100 });
    assert.equal(drag.engine.snapshot().control.gestureActive, true); assert.equal(input.value, '0.25', 'begin does not snap the cap to the retained request'); assert.equal(value.textContent, 'L 50');
    cap.emit('pointermove', { pointerId: 1, clientX: 60, clientY: 100 }); cap.emit('pointerup', { pointerId: 1, clientX: 60, clientY: 100 });
    const moved = pans(drag.writes().slice(sent)); assert.ok(moved.length > 0);
    assert.ok(moved.every(wire => wire < 0.25 && wire > 0.1), `drag left is relative to 0.25: ${moved}`);
  } finally { drag.close(); }
  const key = fixture(false, false);
  try {
    const { input, sent } = settle(key);
    input.emit('keydown', { key: 'ArrowLeft' }); input.emit('keyup', { key: 'ArrowLeft' });
    const stepped = pans(key.writes().slice(sent)); assert.ok(stepped.length > 0);
    assert.ok(stepped.every(wire => wire < 0.25 && wire >= 0.2), `ArrowLeft steps from 0.25: ${stepped}`);
  } finally { key.close(); }
});

test('F09-S09 re-review: level begin after an unechoed send and the window never reports a different start than before begin (no retained-request snap)', () => {
  const app = fixture();
  try {
    const send = { kind: 'send', sourceId: 'i.0', auxIndex: 0 }, control = () => app.engine.snapshot().control;
    app.engine.selectLevelTarget(send);
    let token = app.engine.beginLevelGesture(); assert.ok(token); app.engine.previewLevelGesture(token, 0.6); app.engine.commitLevelGesture(token, 0.6);
    assert.ok(app.writes().length > 0);
    app.advance(2600); app.socket.receive('3:::SETS^i.23.name^Unrelated');
    const before = control().requestedValue;
    token = app.engine.beginLevelGesture(); assert.ok(token);
    assert.equal(control().requestedValue, before, 'same target: the cap start shown before begin is unchanged at begin');
    app.engine.cancelLevelGesture();
    app.pan.open(target); app.pan.close(); app.engine.selectLevelTarget(send);
    assert.equal(control().requestedValue, null, 'after selecting away and back the cap shows received actual');
    token = app.engine.beginLevelGesture();
    assert.equal(control().requestedValue, 0.3, 'begin starts from the received 0.3, not the retained 0.6');
    app.engine.cancelLevelGesture();
  } finally { app.close(); }
});
