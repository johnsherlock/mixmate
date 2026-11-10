import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuxLevelSession } from '../src/iem/aux-level-session.js';
import { mountLiveController } from '../src/iem/live-controller.js';
import { emptySettings } from '../src/settings.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
const master = { kind: 'master', auxIndex: 0 }, send = { kind: 'send', auxIndex: 0, sourceId: 'i.0' };
const LIVE = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^-1\nSETD^a.1.stereoIndex^-1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\nSETD^i.0.stereoIndex^-1\nSETD^i.1.stereoIndex^-1\nSETD^i.0.aux.0.value^0.4\nSETD^i.1.aux.0.value^0.4\nSETD^i.0.aux.1.value^0.4\nSETD^i.1.aux.1.value^0.4';
function setup(factory = createAuxLevelSession) {
  let clock = 0, wall = 0, next = 0; const jobs = new Map(), sockets = [];
  const timers = { setTimeout(fn, delay) { const id = ++next; jobs.set(id, { fn, at: clock + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, setInterval() { return ++next; }, clearInterval() {} };
  class Socket {
    readyState = 0; sent = []; hook = null; throws = false;
    constructor(url) { this.url = url; sockets.push(this); }
    send(message) {
      assert.ok(['3:::INIT', '3:::ALIVE', '2::'].includes(message) || /^3:::SETD\^(?:a\.[0-9]\.mix|(?:i\.(?:[0-9]|1[0-9]|2[0-3])|[lp]\.[01]|f\.[0-3])\.aux\.[0-9]\.value)\^(?:0(?:\.\d+)?|1)$/.test(message), message);
      if (this.throws) throw Error('Unknown delivery'); this.sent.push(message); this.hook?.(message);
    }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
  }
  const session = factory({ WebSocketClass: Socket, timers, now: () => clock, wallNow: () => wall, controlEnabled: true, write: true });
  return { session, sockets, jobs, move(ms, wallMs = ms) { clock += ms; wall += wallMs; }, flush() { for (const [id, job] of [...jobs]) if (job.at <= clock) { jobs.delete(id); job.fn(); } },
    connect(frame = LIVE) { session.connect('192.168.0.60'); const socket = sockets.at(-1); socket.open(); socket.receive(frame); return socket; },
    begin(target = master) { session.selectLevelTarget(target); assert.equal(session.armLevel(), true); return session.beginLevelGesture(); } };
}
const writes = socket => socket.sent.filter(message => message.startsWith('3:::SETD'));
test('literal read-only factory cannot be upgraded by options and no session exposes a socket/raw sender', () => {
  const read = setup(createReadOnlySession); read.connect(); assert.deepEqual(Object.keys(read.session).sort(), ['connect', 'disconnect', 'snapshot', 'subscribe']);
  const control = setup(); control.connect(); assert.equal(control.session.socket, undefined); assert.equal(control.session.send, undefined); assert.equal(control.session.setd, undefined);
  const snapshot = control.session.snapshot(); snapshot.observations.set('a.0.mix', 1); assert.equal(control.session.snapshot().observations.get('a.0.mix'), 0.4);
});
test('selection and explicit arm never write; only current opaque gesture release commits, never preview/receive', () => {
  const app = setup(), socket = app.connect(); app.session.selectLevelTarget(master); assert.equal(writes(socket).length, 0);
  assert.equal(app.session.beginLevelGesture(), null); assert.equal(app.session.armLevel(), true); assert.equal(writes(socket).length, 0);
  const token = app.session.beginLevelGesture(); assert.ok(token); assert.equal(app.session.commitLevelGesture({}, 0.5), false); assert.equal(writes(socket).length, 0);
  assert.equal(app.session.commitLevelGesture(token, 0.5), true); assert.deepEqual(writes(socket), ['3:::SETD^a.0.mix^0.5']);
  assert.equal(app.session.snapshot().observations.get('a.0.mix'), 0.4); assert.equal(app.session.snapshot().control.pending, true);
  assert.equal(app.session.beginLevelGesture(), null); assert.equal(app.session.commitLevelGesture(token, 0.6), false);
  socket.receive('3:::SETD^a.0.mix^0.5'); assert.match(app.session.snapshot().control.status, /Observed matching/); assert.equal(app.session.snapshot().control.armed, true);
  assert.ok(app.session.beginLevelGesture()); assert.equal(writes(socket).length, 1);
});
test('both stereo dimensions dispatch exactly four source-send paths and wait for all fresh echoes', () => {
  const app = setup(), socket = app.connect(); socket.receive('3:::SETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^i.0.stereoIndex^0\nSETD^i.1.stereoIndex^1');
  assert.equal(app.session.commitLevelGesture(app.begin(send), 0.6), true);
  assert.deepEqual(writes(socket), ['i.0.aux.0', 'i.0.aux.1', 'i.1.aux.0', 'i.1.aux.1'].map(path => `3:::SETD^${path}.value^0.6`));
  for (const [index, message] of writes(socket).entries()) { socket.receive(message); assert.equal(app.session.snapshot().control.pending, index !== 3); }
  assert.equal(app.session.snapshot().control.dispatched, 4);
});
test('unknown/matrix/unequal/conflicting/partial current metadata blocks arming without input fallback', () => {
  for (const frame of ['3:::SETD^a.0.matrix^1', '3:::SETD^a.0.stereoIndex^0', '3:::SETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^i.0.aux.1.value^0.7', '3:::SETD^i.0.stereoIndex^0', '3:::SETD^i.0.stereoIndex^0\nSETD^i.1.stereoIndex^1\nSETD^i.1.aux.0.value^0.8']) {
    const app = setup(), socket = app.connect(); socket.receive(frame); app.session.selectLevelTarget(send); assert.equal(app.session.armLevel(), false); assert.equal(writes(socket).length, 0);
  }
});
test('native actual change, away/back, topology, selection, context and cancel disarm a fixed gesture baseline', () => {
  for (const action of [app => app.sockets[0].receive('3:::SETD^a.0.mix^0.6'), app => app.sockets[0].receive('3:::SETD^a.0.mix^0.6\nSETD^a.0.mix^0.4'), app => app.sockets[0].receive('3:::SETD^a.1.matrix^1'), app => app.session.selectLevelTarget(send), app => app.session.invalidateLevelContext(), app => app.session.cancelLevelGesture(), app => app.session.disconnect()]) {
    const app = setup(), socket = app.connect(), token = app.begin(); action(app); assert.equal(app.session.snapshot().control.armed, false); assert.equal(app.session.commitLevelGesture(token, 0.8), false); assert.equal(writes(socket).length, 0);
  }
});
test('names, meters and identical receipts preserve a gesture without writing, changed levels never do', () => {
  const app = setup(), socket = app.connect(), token = app.begin(); socket.receive('3:::SETS^a.0.name^Synthetic <img>\nSETD^a.0.mix^0.4');
  assert.equal(app.session.snapshot().control.gestureActive, true); assert.equal(writes(socket).length, 0); assert.equal(app.session.commitLevelGesture(token, 0), true);
  assert.equal(writes(socket)[0], '3:::SETD^a.0.mix^0');
});
test('unconfirmed deadline is checked even with held timers before late echo, snapshot and arm entry', () => {
  for (const action of ['echo', 'snapshot', 'arm', 'backward']) {
    const app = setup(), socket = app.connect(); app.session.commitLevelGesture(app.begin(), 0.5);
    app.move(action === 'backward' ? -1 : 2600);
    if (action === 'echo') socket.receive('3:::SETD^a.0.mix^0.5');
    if (action === 'arm') assert.equal(app.session.armLevel(), true); // Explicit re-arm after expired operation is allowed.
    const state = app.session.snapshot(); assert.equal(state.control.pending, false);
    if (action !== 'arm') assert.equal(state.control.armed, false);
    assert.doesNotMatch(state.control.status, /Observed matching/); assert.equal(writes(socket).length, 1);
  }
});
test('fresh wrong echo conflicts, same-value preauthorization receipts cannot confirm and no timeout retries', () => {
  const app = setup(), socket = app.connect(), token = app.begin(); socket.receive('3:::SETD^a.0.mix^0.4'); app.session.commitLevelGesture(token, 0.4);
  assert.equal(app.session.snapshot().control.pending, true); socket.receive('3:::SETD^a.0.mix^0.41');
  assert.equal(app.session.snapshot().control.armed, false); assert.match(app.session.snapshot().control.status, /changed|Conflicting/);
  app.move(3000); app.flush(); assert.equal(writes(socket).length, 1);
});
test('reentrant cancellation/close/new connection after a send prevents all remaining ordinals and counts returned sends honestly', () => {
  for (const action of ['cancel', 'disconnect', 'connect', 'native']) {
    const app = setup(), socket = app.connect(); socket.receive('3:::SETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1');
    const token = app.begin(); socket.hook = message => { if (!message.startsWith('3:::SETD')) return;
      if (action === 'cancel') app.session.invalidateLevelContext();
      if (action === 'disconnect') app.session.disconnect();
      if (action === 'connect') app.connect();
      if (action === 'native') socket.receive('3:::SETD^a.0.mix^0.5');
    };
    assert.equal(app.session.commitLevelGesture(token, 0.5), false); assert.equal(writes(socket).length, 1);
    const control = app.session.snapshot().control;
    assert.equal(control.dispatched, ['cancel', 'native'].includes(action) ? 1 : 0); assert.equal(control.armed, false);
    if (action === 'connect') assert.equal(writes(app.sockets[1]).length, 0);
  }
});
test('send throws leave unknown delivery/partial counts, clear state and never resume after callback or reconnect', () => {
  const app = setup(), socket = app.connect(); socket.receive('3:::SETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1'); const token = app.begin();
  socket.hook = message => { if (message.startsWith('3:::SETD')) socket.throws = true; };
  assert.equal(app.session.commitLevelGesture(token, 0.5), false); const state = app.session.snapshot();
  assert.equal(state.phase, 'error'); assert.equal(state.observations.size, 0); assert.equal(state.control.authorized, 2); assert.equal(state.control.dispatched, 1); assert.match(state.detail, /unknown/);
  app.connect(); assert.equal(app.session.commitLevelGesture(token, 0.7), false); assert.equal(writes(app.sockets[1]).length, 0);
});
test('reentrant observers cannot retain an arm or gesture token after cancellation', () => {
  const app = setup(); app.connect(); app.session.selectLevelTarget(master);
  const unsub = app.session.subscribe(snapshot => { if (snapshot.control?.armed) app.session.disarmLevel(); });
  assert.equal(app.session.armLevel(), false); unsub(); app.session.armLevel();
  const off = app.session.subscribe(snapshot => { if (snapshot.control?.gestureActive) app.session.invalidateLevelContext(); });
  assert.equal(app.session.beginLevelGesture(), null); off();
});


class Events {
  handlers = new Map(); value = ''; textContent = ''; disabled = false;
  addEventListener(type, fn) { this.handlers.set(type, [...this.handlers.get(type) || [], fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item !== fn)); }
  emit(type, event = {}) { for (const fn of [...this.handlers.get(type) || []]) fn({ preventDefault() {}, ...event }); }
  setCustomValidity() {} reportValidity() {}
}
test('controller selection/profile/group/editor/dialog/hide/navigation contexts cancel and never restore arming', async () => {
  for (const action of ['group', 'all', 'overview', 'address', 'profile', 'hide', 'pagehide', 'navigate', 'dialog-editor', 'definitions']) {
    const app = setup(), settings = emptySettings(); let publish;
    settings.profiles = ['one', 'two'].map(id => ({ id, name: id, address: '192.168.0.60', groups: [{ id: 'band', name: 'Band', members: ['i.0'] }], navigation: { mixId: null, view: 'channels', expandedGroupId: null } })); settings.selectedProfileId = 'one';
    const repository = { initialize: async () => ({ settings, status: { mode: 'persistent' } }), snapshot: () => ({ settings, status: { mode: 'persistent' } }), subscribe(fn) { publish = fn; return () => {}; } };
    const field = value => Object.assign(new Events(), { value });
    const ui = { address: field('192.168.0.60'), profile: field(''), connect: field(''), disconnect: field(''), note: field(''), settings: field(''), form: new Events(), navigation: [new Events()], close() {}, profiles(rows, id = '') { this.profile.value = id; } };
    const view = { render() {}, renderMeters() {}, preferences() {}, destroy() {} }, document = Object.assign(new Events(), { hidden: false }), window = new Events();
    const controller = mountLiveController({ session: app.session, repository, view, ui, document, window });
    await controller.ready; app.connect(); controller.selectAux(0);
    if (action === 'all') controller.toggleGroup('band');
    controller.selectLevel(send); app.session.armLevel(); const token = app.session.beginLevelGesture(); assert.ok(token);
    if (action === 'group') controller.toggleGroup('band');
    if (action === 'all') controller.allChannels();
    if (action === 'overview') controller.overview();
    if (action === 'address') { ui.address.value = '192.168.1.60'; ui.address.emit('input'); }
    if (action === 'profile') { ui.profile.value = 'two'; ui.profile.emit('change'); }
    if (action === 'hide') { document.hidden = true; document.emit('visibilitychange'); }
    if (action === 'pagehide') window.emit('pagehide');
    if (action === 'navigate') ui.navigation[0].emit('click');
    if (action === 'dialog-editor') controller.clearLevelContext();
    if (action === 'definitions') { settings.profiles[0].groups[0].members = ['i.1']; publish({ settings }); }
    assert.equal(app.session.snapshot().control.armed, false, action); assert.equal(app.session.commitLevelGesture(token, 0.7), false, action); assert.equal(writes(app.sockets[0]).length, 0);
    controller.destroy();
  }
});

test('closed socket or hidden document discovered before callbacks clears authority and cannot commit a stale token', () => {
  const previous = globalThis.document;
  try {
    for (const mode of ['closed', 'hidden']) {
      const app = setup(), socket = app.connect(), token = app.begin();
      if (mode === 'closed') socket.readyState = 3; else globalThis.document = { hidden: true };
      assert.equal(app.session.commitLevelGesture(token, 0.7), false);
      const snapshot = app.session.snapshot(); assert.equal(snapshot.observations.size, 0); assert.equal(snapshot.control.armed, false); assert.equal(writes(socket).length, 0);
      globalThis.document = previous;
    }
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});
