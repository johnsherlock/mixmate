import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { createLiveConnectionUI, mountLiveController } from '../src/iem/live-controller.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';
import { positionDbText, positionToScale, scaleToPosition } from '../src/iem/fader-scale.js';
import { NUDGE_DOWN_DB, NUDGE_UP_DB } from '../src/iem/nudge-config.js';
import { emptySettings, SettingsRepository } from '../src/settings.js';
import { domFixture, Node } from './helpers/fake-dom.js';

const master = ['a.8.mix', 'a.9.mix'];
const vocal = ['i.0.aux.8.value', 'i.0.aux.9.value'];
const keys = ['i.2.aux.8.value', 'i.2.aux.9.value'];
const initial = new Map([
  ...master.map(path => [path, 0.4]),
  ...vocal.map(path => [path, 0.6]),
  ...keys.map(path => [path, 0.3]),
  ['i.3.aux.8.value', 0.5],
  ['i.3.aux.9.value', 0.3],
]);
const levelFrame = levels => '3:::' + [...levels].map(([path, position]) => `SETD^${path}^${position}`).join('\n');
const frame = [
  '3:::SETS^model^ui24',
  'SETS^var.currentSnapshot^Show A',
  'SETS^a.8.name^SPARE', 'SETS^a.9.name^SPARE',
  'SETD^a.8.matrix^0', 'SETD^a.9.matrix^0', 'SETD^a.8.stereoIndex^0', 'SETD^a.9.stereoIndex^1',
  'SETD^a.0.matrix^0', 'SETD^a.0.stereoIndex^-1', 'SETD^a.0.mix^0.5',
  'SETS^i.0.name^Voice', 'SETS^i.2.name^Keys', 'SETS^i.3.name^Unequal',
  'SETD^i.0.stereoIndex^-1', 'SETD^i.2.stereoIndex^-1', 'SETD^i.3.stereoIndex^-1',
  levelFrame(initial).slice(4),
].join('\n');
const groups = [
  { id: 'band', name: 'Band', members: ['i.2', 'i.0'] },
  { id: 'voice', name: 'Voice Group', members: ['i.0'] },
  { id: 'missing', name: 'Missing Group', members: ['i.23', 'i.3'] },
  { id: 'empty', name: 'Empty', members: [] },
];
const navigation = { mixId: null, view: 'groups', expandedGroupId: null };
const stereoNames = ['SPARE', 'Band', 'Voice Group', 'Missing Group', 'Empty'];

async function fixture() {
  const repository = new SettingsRepository({ indexedDB: undefined }), settings = emptySettings();
  settings.profiles = [
    { id: 'showa', name: 'Show A', groups, navigation },
    { id: 'showb', name: 'Show B', groups: [{ id: 'band', name: 'Band', members: ['i.0'] }], navigation },
  ];
  await repository.replace(settings);
  const { root, document } = domFixture(), window = new Node(document), sockets = [], frames = new Map();
  document.scrollingElement = { scrollTop: 0 };
  let frameId = 0;
  window.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const globals = { document, window, matchMedia: () => ({ matches: false }), innerHeight: 844, ResizeObserver: class { observe() {} disconnect() {} } };
  const original = Object.fromEntries(Object.keys(globals).map(name => [name, globalThis[name]]));
  Object.assign(globalThis, globals);
  class Socket {
    readyState = 0; sent = [];
    constructor() { sockets.push(this); }
    open() { this.readyState = 1; this.onopen(); }
    receive(data) { this.onmessage({ data }); }
    send(message) { this.sent.push(message); }
    close() { this.readyState = 3; }
  }
  const session = createAuxControlSession({ WebSocketClass: Socket, settingsRepository: repository });
  const dialogOwner = createDialogOwner();
  let ui, controller;
  const view = mountReadOnlyView(root, {
    onToggleGroup: id => controller.toggleGroup(id), onAllGroups: () => controller.allGroups(),
    canEditLevel: target => session.canEditLevelTarget(target),
    onSelectLevel: target => controller.selectLevel(target),
    onBeginLevel: () => session.beginLevelGesture(),
    onPreviewLevel: (token, value) => session.previewLevelGesture(token, value),
    onCommitLevel: (token, value) => session.commitLevelGesture(token, value),
    onCancelLevel: () => session.cancelLevelGesture(),
    nudgeUnavailable: target => session.levelTargetUnavailableReason(target),
    onNudgeLevel: (target, opening, up) => controller.nudgeLevel(target, opening, up),
  });
  ui = createLiveConnectionUI(root, { levels: true, dialogOwner });
  controller = mountLiveController({ session, repository, ui, view, window, document });
  await controller.ready;
  session.connect('192.168.0.60');
  const [writer, receiver] = sockets;
  receiver.open(); writer.open(); receiver.receive(frame);
  assert.ok(controller.selectAux(8));
  const click = button => root.emit('click', { target: button });
  const panel = root.querySelector('.mm-nudge-preview');
  const rows = () => panel.querySelectorAll('.mm-nudge-preview-row');
  return {
    session, controller, repository, writer, receiver, root, document, panel, dialogOwner, click,
    open() { click(root.querySelector('.mm-open-nudge')); assert.equal(panel.hidden, false); },
    names: () => rows().map(row => row.querySelector('.mm-nudge-preview-name').textContent),
    card: name => rows().find(row => row.querySelector('.mm-nudge-preview-name').textContent === name),
    button(name, direction) { return this.card(name).querySelector(`[data-nudge="${direction}"]`); },
    value(name) { return this.card(name).querySelector('.mm-nudge-preview-value').textContent; },
    writes() {
      const commands = writer.sent.filter(message => !['3:::INIT', '3:::ALIVE', '2::'].includes(message));
      return commands.map(message => {
        const match = /^3:::SETD\^([^\^]+)\^([^\^]+)$/.exec(message);
        assert.ok(match, message);
        return [match[1], Number(match[2])];
      });
    },
    back() { click(panel.querySelector('.mm-nudge-preview-head button')); assert.equal(panel.hidden, true); },
    async close() {
      await controller.whenNavigationIdle();
      await controller.whenRigIdle();
      controller.destroy();
      await repository.close();
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
      }
    },
  };
}

test('Nudge uses the ordered cards from both origins and restores fader scroll and focus', async () => {
  const app = await fixture();
  try {
    const open = app.root.querySelector('.mm-open-nudge'), bank = app.root.querySelector('.mm-strip-scroll');
    for (const expanded of [false, true]) {
      if (expanded) app.controller.toggleGroup('band');
      const strips = [...bank.children];
      bank.scrollLeft = 80;
      app.document.scrollingElement.scrollTop = 215;
      app.open();
      assert.deepEqual(app.names(), expanded ? [...stereoNames, 'Keys', 'Voice'] : stereoNames);
      assert.equal(app.document.scrollingElement.scrollTop, 0);
      assert.equal(app.value('Band'), positionDbText(0.6));
      app.panel.emit('scroll');
      app.button('SPARE', 'up').emit('pointerdown', { pointerId: 1, pointerType: 'touch' });
      app.button('SPARE', 'up').emit('pointermove', { pointerId: 1, pointerType: 'touch', clientY: 40 });
      app.button('SPARE', 'up').emit('pointercancel', { pointerId: 1, pointerType: 'touch' });
      app.receiver.receive(levelFrame(master.map(path => [path, 0.55])));
      assert.equal(app.value('SPARE'), positionDbText(0.55));
      bank.scrollLeft = 0;
      app.back();
      assert.deepEqual(bank.children, strips);
      assert.equal(bank.scrollLeft, 80);
      assert.equal(app.document.scrollingElement.scrollTop, 215);
      assert.equal(app.document.activeElement, open);
      assert.equal(app.controller.context().expandedGroupId, expanded ? 'band' : null);
    }
    assert.deepEqual(app.writes(), []);
  } finally { await app.close(); }
});

test('Nudge taps write one qualified step in each direction through the master, group and channel closures', async () => {
  const app = await fixture();
  try {
    let readbacks = new Map(initial);
    const press = (name, direction, paths) => {
      const count = app.writes().length, button = app.button(name, direction);
      assert.equal(button.disabled, false);
      const prior = app.value(name);
      app.click(button);
      const written = app.writes().slice(count);
      assert.deepEqual(written.map(([path]) => path), paths);
      if (name !== 'Band') assert.equal(app.value(name), prior, 'individual cards still show received levels');
      const step = direction === 'up' ? NUDGE_UP_DB : -NUDGE_DOWN_DB;
      for (const [path, value] of written) {
        assert.ok(Math.abs(positionToScale(value) - positionToScale(readbacks.get(path)) - step) < 1e-9, path);
        readbacks.set(path, value);
      }
      app.receiver.receive(levelFrame(written));
      assert.equal(app.value(name), positionDbText(Math.max(...written.map(([, value]) => value))));
    };
    app.open();
    press('SPARE', 'up', master);
    press('Band', 'down', [...keys, ...vocal]);
    app.back();
    app.controller.toggleGroup('band');
    app.open();
    press('SPARE', 'down', master);
    press('Band', 'up', [...keys, ...vocal]);
    press('Voice', 'up', vocal);
    press('Voice', 'down', vocal);
    assert.equal(app.receiver.sent.some(message => message.startsWith('3:::SETD')), false);
  } finally { await app.close(); }
});

test('Nudge explains missing and unequal targets and waits for a fresh group basis', async () => {
  const app = await fixture();
  try {
    app.controller.toggleGroup('missing');
    app.open();
    assert.deepEqual(app.names(), [...stereoNames, 'Input 24 · Unresolved', 'Unequal']);
    for (const [name, why] of [['Empty', /no members|empty/i], ['Input 24 · Unresolved', /no received/i], ['Unequal', /unequal|differ/i]]) {
      const button = app.button(name, 'down');
      assert.equal(button.disabled, true, name);
      assert.match(app.card(name).querySelector('.mm-nudge-reason').textContent, why, name);
      app.click(button);
      assert.equal(app.writes().length, 0);
    }
    assert.match(app.value('Unequal'), /\/.*dB/);
    app.receiver.receive(levelFrame([[master[0], 0.6]]));
    assert.equal(app.button('SPARE', 'up').disabled, true);
    assert.match(app.card('SPARE').querySelector('.mm-nudge-reason').textContent, /unequal|differ/i);
    app.click(app.button('SPARE', 'up'));
    assert.equal(app.writes().length, 0);
    app.click(app.button('Band', 'up'));
    const writes = app.writes();
    assert.equal(writes.length, 4);
    assert.equal(app.button('Band', 'down').disabled, true);
    assert.match(app.card('Band').querySelector('.mm-nudge-reason').textContent, /report the last change/i);
    app.receiver.receive(levelFrame(writes.slice(0, 3)));
    assert.equal(app.button('Band', 'down').disabled, true);
    app.receiver.receive(levelFrame(writes.slice(3)));
    assert.equal(app.button('Band', 'down').disabled, false);
    assert.deepEqual(app.writes(), writes);
  } finally { await app.close(); }
});

test('Nudge rejects obsolete cards after returning, changing AUX or group, replacing definitions, recalling a rig and losing a socket', async () => {
  const app = await fixture();
  try {
    async function reject(name, change, reopen = true) {
      app.open();
      const old = app.button(name, 'up');
      assert.equal(old.disabled, false);
      await change();
      assert.equal(app.panel.hidden, true);
      if (reopen) app.open();
      app.click(old);
      assert.deepEqual(app.writes(), []);
      if (reopen) app.back();
    }
    await reject('SPARE', () => app.back());
    await reject('SPARE', () => app.controller.selectAux(0));
    app.controller.selectAux(8);
    await reject('Band', () => app.controller.toggleGroup('band'));
    await reject('Voice', () => app.repository.update(draft => { draft.profiles[0].groups[0].members = ['i.2']; }));
    await reject('Voice Group', () => app.repository.update(draft => { draft.profiles[0].groups.splice(1, 1); }));
    await reject('Band', () => app.receiver.receive('3:::SETS^var.currentSnapshot^Show B'));
    app.open();
    const card = app.button('SPARE', 'up');
    app.writer.readyState = 3; // stale enabled DOM until the session notices the writer has dropped
    app.click(card);
    assert.deepEqual(app.writes(), []);
    assert.equal(app.panel.hidden, true);
  } finally { await app.close(); }
});

test('Nudge rejects modal and EQ overlays and handles a modal opened during gesture begin', async () => {
  const app = await fixture();
  try {
    app.open();
    const button = app.button('SPARE', 'up');
    const lease = app.dialogOwner.claim('pan', () => {});
    app.click(button);
    app.dialogOwner.release(lease);
    app.root.dataset.eqOpen = 'true';
    app.click(button);
    app.root.dataset.eqOpen = 'false';
    const stop = app.session.subscribe(snapshot => {
      if (snapshot.control.gestureActive && !app.dialogOwner.active()) app.dialogOwner.claim('detail', () => {});
    });
    app.click(button);
    assert.deepEqual(app.writes(), []);
    assert.equal(app.session.snapshot().control.gestureActive, false);
    stop();
    app.dialogOwner.release(app.dialogOwner.active());
    app.click(button);
    assert.equal(app.writes().length, 2);
  } finally { await app.close(); }
});

test('Nudge cancels the old gesture if its screen closes and reopens in the same context during begin', async () => {
  const app = await fixture();
  try {
    app.open();
    let reopened = false;
    const stop = app.session.subscribe(snapshot => {
      if (!snapshot.control.gestureActive || reopened) return;
      reopened = true;
      app.back();
      app.open();
    });
    app.click(app.button('SPARE', 'up'));
    stop();
    assert.equal(reopened, true);
    assert.deepEqual(app.writes(), []);
    assert.equal(app.session.snapshot().control.gestureActive, false);
    app.click(app.button('SPARE', 'up'));
    assert.equal(app.writes().length, 2, 'a deliberate tap from the new opening works');
  } finally { await app.close(); }
});

test('Nudge cancels a held Space, then accepts the next deliberate press', async () => {
  const app = await fixture();
  try {
    app.open();
    const button = app.button('SPARE', 'up');
    let prevented = 0;
    button.emit('keydown', { key: ' ', repeat: false, preventDefault() { prevented++; } });
    button.emit('keydown', { key: ' ', repeat: true, preventDefault() { prevented++; } });
    button.emit('keyup', { key: ' ', preventDefault() { prevented++; } });
    assert.equal(prevented, 2);
    assert.deepEqual(app.writes(), [], 'preventing keyup cancels the native release click');
    app.click(button);
    assert.equal(app.writes().length, 2, 'the next deliberate tap writes once');
  } finally { await app.close(); }
});


test('F08-S04 expanded groups retain the keyed AUX master and write only deliberate master gestures for the selected logical mix', async () => {
  const app = await fixture();
  try {
    const bank = app.root.querySelector('.mm-strip-scroll'), pinned = app.root.querySelector('.mm-pinned');
    const band = app.root.querySelector('.mm-group-shortcut[data-toggle-group="band"]');
    const voice = app.root.querySelector('.mm-group-shortcut[data-toggle-group="voice"]');
    const strip = pinned.children[0], input = strip.querySelector('input');
    const cap = strip.querySelector('.mm-fader-hit'), meter = strip.querySelector('.mm-meter-pair');
    assert.equal(strip.dataset.id, 'a.8');
    assert.equal(strip.querySelector('.mm-value').textContent, positionDbText(0.4));

    app.click(band);
    assert.deepEqual(bank.children.slice(1).map(node => node.dataset.id), ['i.2@8', 'i.0@8']);
    const memberTrack = bank.children[1].querySelector('.mm-fader-control');
    const touch = clientY => ({ pointerId: 1, pointerType: 'touch', button: 0, clientX: 20, clientY });
    memberTrack.emit('pointerdown', touch(70));
    memberTrack.emit('pointermove', touch(140));
    memberTrack.emit('pointerup', touch(140));
    app.click(voice);
    assert.deepEqual(bank.children.slice(1).map(node => node.dataset.id), ['i.0@8']);
    app.click(voice);
    assert.equal(app.controller.context().expandedGroupId, null);
    app.click(band);
    assert.deepEqual(app.writes(), []);
    assert.deepEqual(pinned.children, [strip]);
    assert.equal(strip.querySelector('input'), input);
    assert.equal(strip.querySelector('.mm-fader-hit'), cap);
    assert.equal(strip.querySelector('.mm-meter-pair'), meter);

    assert.equal(input.disabled, false);
    cap.emit('pointerdown', touch(100));
    cap.emit('pointermove', touch(80));
    cap.emit('pointerup', touch(80));
    const afterDrag = app.writes();
    assert.deepEqual(afterDrag.map(([path]) => path), master);
    assert.equal(afterDrag[0][1], afterDrag[1][1]);
    assert.ok(afterDrag[0][1] > 0.4);
    app.receiver.receive(levelFrame(afterDrag));
    assert.equal(strip.querySelector('.mm-value').textContent, positionDbText(afterDrag[0][1]));
    assert.equal(strip.querySelector('.mm-fader-hit'), cap);

    assert.ok(app.controller.selectAux(0));
    app.click(band);
    const mono = pinned.children[0], raise = mono.querySelector('.mm-nudge-up');
    assert.equal(mono.dataset.id, 'a.0');
    assert.equal(mono.querySelector('.mm-value').textContent, positionDbText(0.5));
    assert.equal(raise.disabled, false);
    assert.deepEqual(app.writes(), afterDrag);
    app.click(raise);
    assert.deepEqual(app.writes().slice(afterDrag.length), [['a.0.mix', scaleToPosition(positionToScale(0.5) + NUDGE_UP_DB)]]);
    assert.ok(app.receiver.sent.every(message => ['3:::INIT', '3:::ALIVE', '2::'].includes(message)));
  } finally { await app.close(); }
});
