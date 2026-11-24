import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domFixture, Node } from './helpers/fake-dom.js';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';
import { projectLiveState } from '../src/iem/live-provider.js';
import { projectGroupNavigation } from '../src/iem/group-navigation.js';
import { parseIemStateFrame } from '../src/iem/protocol.js';
import { installFaderGestures } from '../src/iem/gestures.js';
import { NUDGE_UP_DB, NUDGE_DOWN_DB } from '../src/iem/nudge-config.js';
import { positionToScale, scaleToPosition, positionDbText, FADER_FLOOR_POSITION, FADER_SCALE_MIN, FADER_SCALE_FLOOR_DB } from '../src/iem/fader-scale.js';
import { SettingsRepository, emptySettings } from '../src/settings.js';

// F09-S12 UI tweaks (user request 2026-11-22). Fake transports, fake timers and
// the fake DOM only: no desk, browser or network.
const SOURCES = { 'i.0': 0.35, 'f.0': 0.65, 'i.1': 0.02, 'i.2': FADER_FLOOR_POSITION, 'i.3': 0, 'i.4': 1, 'i.5': 0.99, 'i.6': 0.5, 'i.10': 0.005 };
const FRAME = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\n' +
  Object.entries(SOURCES).map(([id, value]) => `${id.startsWith('i') ? `SETD^${id}.stereoIndex^-1\n` : ''}SETD^${id}.aux.0.value^${value}\nSETD^${id}.aux.1.value^${value}`).join('\n') +
  // i.7 has a pan only (no level); i.8 is a mono source whose two linked sends differ (read-only).
  '\nSETD^i.7.stereoIndex^-1\nSETD^i.7.aux.0.pan^0.5\nSETD^i.7.aux.1.pan^0.5\nSETD^i.8.stereoIndex^-1\nSETD^i.8.aux.0.value^0.3\nSETD^i.8.aux.1.value^0.4' +
  '\nSETS^f.0.name^\nSETD^f.0.fxtype^0\nSETS^f.1.name^\nSETD^f.1.fxtype^2\nSETS^f.2.name^\nSETD^f.2.fxtype^9\nSETS^f.3.name^Plate';

async function rig({ members = ['i.0', 'f.0'], nav = { view: 'groups', expandedGroupId: null }, handlers = {} } = {}) {
  const repository = new SettingsRepository({ indexedDB: undefined }), settings = emptySettings();
  const profile = { id: 'rig', name: 'rig', groups: [{ id: 'band', name: 'Band', members }], navigation: { mixId: null, view: 'groups', expandedGroupId: null } };
  settings.profiles = [profile]; await repository.replace(settings);
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
  const dom = domFixture(), { root } = dom;
  const previous = Object.fromEntries(['document', 'window', 'matchMedia', 'innerHeight', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { document: dom.document, window: new Node(dom.document), matchMedia: () => ({ matches: true }), innerHeight: 844, ResizeObserver: class { observe() {} disconnect() {} } });
  let navigation = nav, view;
  const render = () => view.render(projectGroupNavigation(projectLiveState(session.snapshot(), 0), profile, navigation));
  view = mountReadOnlyView(root, { canEditLevel: target => session.canEditLevelTarget(target), onSelectGroupLevel: id => session.selectGroupTarget(id, 0), onSelectLevel: target => session.selectLevelTarget(target),
    onBeginLevel: () => session.beginLevelGesture(), onPreviewLevel: (token, value) => session.previewLevelGesture(token, value), onCommitLevel: (token, value) => session.commitLevelGesture(token, value), onCancelLevel: () => session.cancelLevelGesture(),
    onMessage: text => app.messages.push(text), ...handlers });
  session.subscribe(() => render()); render();
  const app = { session, writer, receiver, writes, root, view, messages: [], render, jobs,
    setNavigation(value) { navigation = value; render(); },
    advance(ms) { clock += ms; for (const [id, job] of [...jobs].sort((a, b) => a[1].at - b[1].at)) if (job.at <= clock && jobs.has(id)) { jobs.delete(id); job.fn(); } },
    strips: () => root.querySelectorAll('.mm-strip'),
    strip: id => root.querySelectorAll('.mm-strip').find(strip => strip.dataset.id === id || strip.dataset.id?.startsWith(`${id}@`) ),
    nudge: (strip, direction) => strip.querySelector(`[data-nudge="${direction}"]`),
    click: button => root.emit('click', { target: button }),
    close() { view.destroy(); session.disconnect(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } } };
  return app;
}
const value = message => Number(message.split('^')[2]);
// The same absolute-position gesture the cap drag takes (typed API only).
function drag(app, target, position) {
  if (target.kind === 'group') app.session.selectGroupTarget(target.groupId, 0); else app.session.selectLevelTarget(target);
  const token = app.session.beginLevelGesture(); assert.ok(token); app.session.previewLevelGesture(token, position); app.session.commitLevelGesture(token, position);
}

test('nudge amounts live in one tiny module and every nudge label is built from it', async () => {
  assert.equal(NUDGE_UP_DB, 3); assert.equal(NUDGE_DOWN_DB, 1.5);
  const source = await readFile(new URL('../src/iem/nudge-config.js', import.meta.url), 'utf8');
  assert.match(source, /export const NUDGE_UP_DB = 3;/); assert.match(source, /export const NUDGE_DOWN_DB = 1\.5;/);
  const view = await readFile(new URL('../src/iem/live-view.js', import.meta.url), 'utf8');
  assert.match(view, /from '\.\/nudge-config\.js'/); assert.doesNotMatch(view, /\b3 dB\b|1\.5 dB/, 'no duplicated literal amounts');
  const app = await rig({ nav: { view: 'channels' } });
  try {
    const strip = app.strip('i.0');
    assert.equal(app.nudge(strip, 'up').attributes['aria-label'], `Raise ${strip.querySelector('.mm-strip-name').textContent} by ${NUDGE_UP_DB} dB`);
    assert.equal(app.nudge(strip, 'down').attributes['aria-label'], `Lower ${strip.querySelector('.mm-strip-name').textContent} by ${NUDGE_DOWN_DB} dB`);
    assert.equal(app.nudge(strip, 'up').textContent, '▲'); assert.equal(app.nudge(strip, 'down').textContent, '▼');
    const head = strip.children.map(node => node.className.split(' ')[0]);
    assert.ok(head.indexOf('mm-nudge') === head.indexOf('mm-value') + 1, 'buttons sit directly below the dB readout, side by side in one row');
    assert.deepEqual(strip.querySelector('.mm-nudge').children.map(node => node.dataset.nudge), ['up', 'down']);
  } finally { app.close(); }
});

test('channel nudge: +3 / -1.5 dB in the display scale through the typed gesture, exactly the same SETDs as an equal fader move', async () => {
  for (const [direction, db] of [['up', NUDGE_UP_DB], ['down', -NUDGE_DOWN_DB]]) {
    const app = await rig({ nav: { view: 'channels' } }), twin = await rig({ nav: { view: 'channels' } });
    try {
      app.click(app.nudge(app.strip('i.0'), direction));
      const sent = app.writes().map(value);
      assert.equal(sent.length, 2, 'one step to both linked AUX sides, no extra release write'); assert.equal(sent[0], sent[1]);
      assert.ok(Math.abs(positionToScale(sent[0]) - (positionToScale(0.35) + db)) < 1e-9, `${db} dB on the display scale`);
      drag(twin, { kind: 'send', auxIndex: 0, sourceId: 'i.0' }, scaleToPosition(positionToScale(0.35) + db));
      assert.deepEqual(app.writes(), twin.writes(), 'identical outbound messages to an equivalent fader move');
      app.advance(5000); assert.equal(app.writes().length, 2, 'no repeat, no queued step');
    } finally { twin.close(); app.close(); }
  }
});

test('nudge boundaries: -inf up goes to the -70 dB floor, down below the floor goes to -inf, +10 dB clamps, the top stays', async () => {
  const app = await rig({ nav: { view: 'channels' } });
  try {
    const press = (id, direction) => { const before = app.writes().length; app.click(app.nudge(app.strip(id), direction)); app.advance(3000); return app.writes().slice(before).map(value); };
    assert.deepEqual(press('i.3', 'up'), [FADER_FLOOR_POSITION, FADER_FLOOR_POSITION], 'silent source rises to exactly the -70 dB floor');
    assert.deepEqual(press('i.1', 'up'), [FADER_FLOOR_POSITION, FADER_FLOOR_POSITION], 'a bottom-segment level below -70 dB goes to the floor');
    assert.deepEqual(press('i.2', 'down'), [0, 0], 'lowering from the -70 dB floor reaches -inf (position 0)');
    assert.deepEqual(press('i.4', 'up'), [], 'already at +10 dB: nothing to send');
    assert.deepEqual(press('i.5', 'up'), [1, 1], '+3 dB from near the top clamps at +10 dB (position 1)');
    assert.deepEqual(press('i.4', 'down').map(positionToScale).map(v => Math.round(v * 1e6) / 1e6), [10 - NUDGE_DOWN_DB, 10 - NUDGE_DOWN_DB]);
    assert.equal(FADER_SCALE_FLOOR_DB, -70); assert.equal(FADER_SCALE_MIN, -75);
  } finally { app.close(); }
});

test('AUX master nudge uses the same display-scale steps for the master (both sides of the verified pair)', async () => {
  const app = await rig({ nav: { view: 'channels' } });
  try {
    const master = app.root.querySelectorAll('.mm-pinned .mm-strip')[0];
    app.click(app.nudge(master, 'up'));
    assert.deepEqual(app.writes().map(message => message.split('^')[1]), ['a.0.mix', 'a.1.mix']);
    for (const message of app.writes()) assert.ok(Math.abs(positionToScale(value(message)) - (positionToScale(0.4) + NUDGE_UP_DB)) < 1e-9);
    app.advance(3000);
    app.click(app.nudge(master, 'down'));
    assert.ok(app.writes().length === 2 || app.writes().length === 4, 'a second press is a fresh deliberate gesture or refused for the echo window, never a queue');
  } finally { app.close(); }
});

test('group nudge applies one common display-scale delta to every member exactly like a group fader move; first-member clamps hold', async () => {
  const app = await rig({ members: ['i.0', 'f.0'] }), twin = await rig({ members: ['i.0', 'f.0'] });
  try {
    const group = app.root.querySelector('.mm-strip-scroll').children[0], reference = 0.65;
    assert.equal(group.querySelector('.mm-value').textContent, positionDbText(reference), 'readout = loudest member');
    app.click(app.nudge(group, 'up'));
    const sent = app.writes().map(message => [message.split('^')[1], value(message)]);
    assert.deepEqual(sent.map(item => item[0]).sort(), ['f.0.aux.0.value', 'f.0.aux.1.value', 'i.0.aux.0.value', 'i.0.aux.1.value']);
    for (const [path, v] of sent) assert.ok(Math.abs(positionToScale(v) - (positionToScale(path.startsWith('i') ? 0.35 : 0.65) + NUDGE_UP_DB)) < 1e-9, `${path} moved by the same +3 dB`);
    drag(twin, { kind: 'group', groupId: 'band', auxIndex: 0 }, scaleToPosition(positionToScale(reference) + NUDGE_UP_DB));
    assert.deepEqual(app.writes(), twin.writes(), 'identical to the equivalent group fader move');
  } finally { twin.close(); app.close(); }
  // Top: the loudest member lands at max, every member moves by the same (smaller) delta. Bottom: the quietest reaches -inf.
  const top = await rig({ members: ['i.0', 'i.5'] }), bottom = await rig({ members: ['i.0', 'i.10'] });
  try {
    top.click(top.nudge(top.root.querySelector('.mm-strip-scroll').children[0], 'up'));
    const topValues = top.writes().map(message => [message.split('^')[1], value(message)]);
    assert.ok(topValues.some(([path, v]) => path === 'i.5.aux.0.value' && v === 1), 'loudest member at max');
    const delta = positionToScale(1) - positionToScale(0.99);
    assert.ok(delta < NUDGE_UP_DB);
    for (const [path, v] of topValues.filter(([path]) => path.startsWith('i.0'))) assert.ok(Math.abs(positionToScale(v) - positionToScale(0.35) - delta) < 1e-9);
    // i.10 sits just above -inf (about -74 on the scale). -1.5 would drive it below -75 in scale units: clamp at the first member limit, quietest at position 0.
    const quietest = positionToScale(0.005), room = quietest - FADER_SCALE_MIN;
    assert.ok(room < NUDGE_DOWN_DB);
    bottom.click(bottom.nudge(bottom.root.querySelector('.mm-strip-scroll').children[0], 'down'));
    const bottomValues = bottom.writes().map(message => [message.split('^')[1], value(message)]);
    assert.ok(bottomValues.some(([path, v]) => path === 'i.10.aux.0.value' && v === 0), 'quietest member reaches position 0 (-inf)');
    for (const [path, v] of bottomValues.filter(([path]) => path.startsWith('i.0'))) assert.ok(Math.abs(positionToScale(v) - positionToScale(0.35) + room) < 1e-9, 'others move by the same clamped delta');
  } finally { bottom.close(); top.close(); }
});

test('group readout is the loudest member received level, the requested preview during a gesture, and an em dash when unknown', async () => {
  const app = await rig({ members: ['i.0', 'f.0'] });
  try {
    const group = app.root.querySelector('.mm-strip-scroll').children[0], output = group.querySelector('.mm-value');
    assert.equal(output.textContent, positionDbText(0.65)); assert.equal(group.querySelector('.mm-delta-prefix'), null, 'the always-0.0 delta text is gone');
    // During a group gesture the readout shows the loudest member's requested preview level.
    app.session.selectGroupTarget('band', 0); const token = app.session.beginLevelGesture();
    const reference = app.session.previewLevelGesture(token, 0.8);
    app.render(); assert.equal(output.textContent, positionDbText(reference), 'requested preview of the loudest member');
    assert.notEqual(reference, 0.65);
    app.session.cancelLevelGesture(); app.advance(3000);
    // No known member level: em dash (unresolved member only).
    const unknown = await rig({ members: ['i.9'] });
    try { assert.equal(unknown.root.querySelector('.mm-strip-scroll').children[0].querySelector('.mm-value').textContent, '—'); } finally { unknown.close(); }
  } finally { app.close(); }
});

test('nudge buttons are disabled with a reason when a level cannot be edited and a click then writes nothing', async () => {
  const app = await rig({ nav: { view: 'channels' } });
  try {
    for (const id of ['i.7', 'i.8']) {
      const strip = app.strip(id);
      for (const direction of ['up', 'down']) {
        const button = app.nudge(strip, direction);
        assert.equal(button.disabled, true, `${id} ${direction}`); assert.match(button.attributes.title, /unavailable: /);
        app.click(button);
      }
    }
    assert.match(app.nudge(app.strip('i.7'), 'up').attributes.title, /No received level/);
    assert.equal(app.writes().length, 0, 'disabled buttons never write');
    // Disconnect: nothing is editable and the buttons stay disabled.
    app.session.disconnect(); app.render();
    assert.ok(app.strips().every(strip => !strip.querySelector('[data-nudge]') || strip.querySelector('[data-nudge]').disabled));
  } finally { app.close(); }
});

test('a refused begin shows the reason, starts nothing and never writes', async () => {
  const app = await rig({ nav: { view: 'channels' }, handlers: { onBeginLevel: () => null } });
  try {
    app.click(app.nudge(app.strip('i.0'), 'up'));
    assert.equal(app.writes().length, 0); assert.match(app.messages.at(-1), /^Level not changed: /);
    assert.match(app.root.querySelector('.mm-feedback').textContent, /^Level not changed: /);
  } finally { app.close(); }
});

test('touch or scroll over nudge buttons never starts a gesture or writes; only a click nudges, once, with no repeat on hold', async () => {
  const app = await rig({ nav: { view: 'channels' } });
  try {
    const button = app.nudge(app.strip('i.0'), 'up'), content = app.root.querySelector('.mm-content');
    const event = { target: button, pointerId: 1, button: 0, clientX: 5, clientY: 5, preventDefault() {} };
    content.emit('pointerdown', event); content.emit('pointermove', { ...event, clientY: 60 }); content.emit('pointerup', { ...event, clientY: 60 });
    for (let n = 0; n < 5; n++) content.emit('pointermove', { ...event, clientY: 60 + n });
    app.advance(5000);
    assert.equal(app.writes().length, 0, 'pointer travel over the button is not a gesture');
    app.click(button); app.advance(2000);
    assert.equal(app.writes().length, 2, 'one click, one write per linked side; holding does not repeat');
  } finally { app.close(); }
});

test('FX returns: unnamed returns show FX<n> <Type> from the received fxtype; unknown type is FX<n>; a received name wins; IDs are unchanged', async () => {
  const app = await rig({ nav: { view: 'channels' }, members: ['f.0'] });
  try {
    const name = id => app.strip(id)?.querySelector('.mm-strip-name').textContent;
    const frame = FRAME;
    assert.ok(frame.includes('f.0.fxtype^0'));
    const state = app.session.snapshot().observations;
    assert.equal(state.get('f.0.fxtype'), 0); assert.equal(state.get('f.1.fxtype'), 2); assert.equal(state.has('f.2.fxtype'), false, 'fxtype 9 is out of bounds and ignored');
    for (const id of ['f.1', 'f.2', 'f.3']) app.receiver.receive(`3:::SETD^${id}.aux.0.value^0.5\nSETD^${id}.aux.1.value^0.5`);
    assert.equal(name('f.0'), 'FX1 Reverb'); assert.equal(name('f.1'), 'FX2 Chorus'); assert.equal(name('f.2'), 'FX3', 'unknown type');
    assert.equal(name('f.3'), 'Plate', 'a received non-empty name wins');
    app.receiver.receive('3:::SETD^f.2.fxtype^1\nSETD^f.3.fxtype^3'); assert.equal(name('f.2'), 'FX3 Delay'); assert.equal(name('f.3'), 'Plate');
    app.receiver.receive('3:::SETS^f.3.name^\nSETD^f.3.fxtype^3'); assert.equal(name('f.3'), 'FX4 Room');
    assert.ok(app.strip('f.0').dataset.id.startsWith('f.0@'), 'group-membership identity stays f.<n>');
  } finally { app.close(); }
});

test('FX type parser accepts only integers 0..3 as SETD, never SETS or other values or other families', () => {
  const type = text => parseIemStateFrame(`3:::${text}`).filter(update => update.field === 'fxtype').map(update => [update.path, update.value]);
  assert.deepEqual(type('SETD^f.0.fxtype^0\nSETD^f.1.fxtype^1\nSETD^f.2.fxtype^2\nSETD^f.3.fxtype^3'), [['f.0.fxtype', 0], ['f.1.fxtype', 1], ['f.2.fxtype', 2], ['f.3.fxtype', 3]]);
  for (const bad of ['SETD^f.0.fxtype^4', 'SETD^f.0.fxtype^-1', 'SETD^f.0.fxtype^1.5', 'SETD^f.0.fxtype^x', 'SETS^f.0.fxtype^1', 'SETD^f.4.fxtype^1', 'SETD^i.0.fxtype^1', 'SETD^f.0.fxtype^', 'SETD^f.0.fxtype^1e0x']) assert.deepEqual(type(bad), [], bad);
  assert.deepEqual(type('SETD^f.0.fxtype^1.0\nSETD^f.1.fxtype^ 2 '), [['f.0.fxtype', 1], ['f.1.fxtype', 2]], 'numeric text normalises like other SETD fields');
});

test('fader fill: the track fill ratio follows the cap (including drag previews), yellow by default and light blue for FX', async () => {
  const app = await rig({ nav: { view: 'channels' } });
  try {
    const css = await readFile(new URL('../src/iem/iem.css', import.meta.url), 'utf8');
    const strips = id => app.strip(id);
    const inputOf = id => strips(id).querySelector('input');
    assert.equal(strips('f.0').dataset.fx, 'true'); assert.equal(strips('i.0').dataset.fx, 'false'); assert.equal(app.root.querySelectorAll('.mm-pinned .mm-strip')[0].dataset.fx, 'false', 'AUX masters are yellow');
    assert.match(css, /\.mm-strip\[data-fx="true"\]\{--mm-fill-colour:#7fd0f5\}/, 'FX light blue'); assert.match(css, /\.mm-strip\{--mm-fill-colour:var\(--mm-yellow\)\}/, 'everything else yellow');
    assert.match(css, /::-webkit-slider-runnable-track\{background:linear-gradient\(to top,var\(--mm-fill-colour\) var\(--mm-fill-stop\),transparent var\(--mm-fill-stop\)\)/);
    assert.match(css, /--mm-fill-stop:calc\(14\.5px \+ \(100% - 29px\) \* var\(--mm-fill, 0\)\)/);
    assert.ok(inputOf('i.0') && inputOf('f.0'));
    // The ratio is written in the same pass that places the cap (gestures.sync), so a drag preview moves it too.
    const input = inputOf('i.0'); input.min = '-75'; input.max = '10'; input.value = '-32.5'; input.style = { values: {}, setProperty(name, v) { this.values[name] = v; } };
    const wrap = input.parentElement; assert.ok(wrap.classList.contains('mm-fader-control'));
    const gestures = installFaderGestures(app.root.querySelector('.mm-content'), { onBegin: () => ({}), onPreview: (_, __, v) => v });
    try { gestures.sync(); assert.ok(Math.abs(Number(input.style.values['--mm-fill']) - 0.5) < 1e-9); input.value = '10'; gestures.sync(); assert.equal(input.style.values['--mm-fill'], '1'); input.value = '-75'; gestures.sync(); assert.equal(input.style.values['--mm-fill'], '0'); } finally { gestures.destroy(); }
  } finally { app.close(); }
});

test('header snapshot name box is 50% wider on the landscape grids and the clock keeps its own column; portrait keeps clock on its own row', async () => {
  const css = await readFile(new URL('../src/iem/iem.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns: 90px minmax\(135px, 255px\) minmax\(120px, 1fr\) auto;/, 'was 90..170, now 135..255');
  assert.match(css, /grid-template-columns: 83px minmax\(120px, 210px\) minmax\(100px, 1fr\) auto;/, 'was 80..140');
  assert.match(css, /grid-template-columns: 72px 143px minmax\(90px, 1fr\) auto;/, 'was 95px');
  assert.doesNotMatch(css, /grid-template-columns: 90px minmax\(90px, 170px\)/);
});

test('shell: Create Group replaces Edit Groups and All Groups is created by the view, immediately before All Channels', async () => {
  const shell = await readFile(new URL('../src/iem/shell.html', import.meta.url), 'utf8');
  assert.match(shell, /data-action="edit-groups" aria-label="Create a new group">\s*Create Group\s*</); assert.doesNotMatch(shell, /Edit Groups/);
  const app = await rig({ nav: { view: 'groups', expandedGroupId: null } });
  try {
    const edit = app.root.querySelector('[data-action="edit-groups"]');
    assert.equal(edit.textContent, 'Create Group'); assert.equal(edit.attributes['aria-label'], 'Create a new group');
    const switches = app.root.querySelector('.mm-group-switches');
    assert.deepEqual(switches.children.map(node => node.textContent), ['Nudge', 'Band', 'All Groups', 'Create Group', 'All Channels']);
    assert.equal(switches.children[2].attributes['aria-pressed'], 'true', 'active while the group fader view is current');
    assert.equal(switches.children[4].attributes['aria-pressed'], 'false');
    app.setNavigation({ view: 'groups', expandedGroupId: 'band' });
    assert.equal(edit.textContent, 'Edit Group'); assert.equal(edit.attributes['aria-label'], 'Edit group Band');
    // F09-S13: Edit Group stays immediately right of All Groups, before All Channels; same node (keyed).
    assert.deepEqual(switches.children.map(node => node.textContent), ['Nudge', 'Band', 'All Groups', 'Edit Group', 'All Channels']);
    assert.equal(switches.children[3], edit);
    assert.equal(switches.children[2].attributes['aria-pressed'], 'false'); assert.equal(switches.children[1].attributes['aria-pressed'], 'true');
    app.setNavigation({ view: 'channels' });
    assert.equal(edit.textContent, 'Create Group'); assert.equal(switches.children[3].attributes['aria-pressed'], 'true'); assert.equal(switches.children[1].attributes['aria-pressed'], 'false');
    assert.deepEqual(switches.children.map(node => node.textContent), ['Band', 'All Groups', 'Create Group', 'All Channels']); assert.equal(switches.children[2], edit);
  } finally { app.close(); }
});

test('All Groups button calls only the navigation handler; no session write', async () => {
  const calls = [], app = await rig({ nav: { view: 'groups', expandedGroupId: 'band' }, handlers: { onAllGroups: () => calls.push('groups'), onAllChannels: () => calls.push('channels'), onToggleGroup: id => calls.push(`toggle:${id}`) } });
  try {
    const buttons = app.root.querySelector('.mm-group-switches').children;
    app.click(buttons[2]); app.click(buttons[4]);
    assert.deepEqual(calls, ['groups', 'channels']); assert.equal(app.writes().length, 0);
  } finally { app.close(); }
});

test('review: keyboard auto-repeat on a nudge button never stacks gestures; a Space release after a held repeat fires nothing extra', async () => {
  const app = await rig({ nav: { view: 'channels' } });
  try {
    const button = app.nudge(app.strip('i.0'), 'up'); let prevented = 0;
    // Enter: the first keydown activates (one click); every repeat keydown is cancelled so no more clicks are generated.
    app.root.emit('keydown', { target: button, key: 'Enter', repeat: false, preventDefault() { prevented++; } });
    app.click(button);
    for (let n = 0; n < 5; n++) app.root.emit('keydown', { target: button, key: 'Enter', repeat: true, preventDefault() { prevented++; } });
    assert.equal(prevented, 5, 'repeat keydowns are cancelled');
    app.advance(3000); assert.equal(app.writes().length, 2, 'exactly one nudge (both linked sides)');
    // Space held: repeats cancelled, and the release click after a repeat is swallowed.
    app.advance(3000); app.receiver.receive('3:::' + app.writes().map(m => m.slice(4)).join('\n'));
    const before = app.writes().length;
    for (let n = 0; n < 3; n++) app.root.emit('keydown', { target: button, key: ' ', repeat: n > 0, preventDefault() {} });
    app.root.emit('keyup', { target: button, key: ' ', preventDefault() {} });
    app.click(button); app.advance(3000);
    assert.equal(app.writes().length, before, 'no extra nudge after a held Space');
    app.click(button); assert.ok(app.writes().length > before, 'a later deliberate press works');
  } finally { app.close(); }
});

test('review: a stale "Group not editable" message never hides a new, different refusal reason', async () => {
  const app = await rig({ nav: { view: 'channels' }, handlers: { onBeginLevel: () => null } });
  try {
    // A refused nudge shows its own reason every time, even after the group-refusal text was shown earlier.
    app.root.querySelector('.mm-feedback').textContent = 'Group not editable yet: waiting for the desk to report the last member change. Try again in a moment.';
    app.click(app.nudge(app.strip('i.0'), 'up'));
    assert.match(app.messages.at(-1), /^Level not changed: /); assert.match(app.root.querySelector('.mm-feedback').textContent, /^Level not changed: /);
  } finally { app.close(); }
});
