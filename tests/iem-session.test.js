import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { createLiveProvider, projectLiveState } from '../src/iem/live-provider.js';
import { mountLiveController } from '../src/iem/live-controller.js';
import { readFile } from 'node:fs/promises';
import { emptySettings, SettingsRepository } from '../src/settings.js';
import { mountGroupEditor } from '../src/iem/group-editor.js';
const ALLOWED = new Set(['3:::INIT', '3:::ALIVE', '2::']);
const LIVE = '3:::SETS^model^ui24\nSETS^a.0.name^Synthetic <img src=x>\nSETD^a.0.matrix^0\nSETD^a.0.mix^0\nSETD^a.0.stereoIndex^-1';
class Clock {
  now = 0; next = 1; jobs = new Map();
  setTimeout = (callback, delay) => this.add(callback, delay, false);
  setInterval = (callback, delay) => this.add(callback, delay, true);
  clearTimeout = id => this.jobs.delete(id);
  clearInterval = id => this.jobs.delete(id);
  add(callback, delay, repeat) { const id = this.next++; this.jobs.set(id, { callback, delay, repeat, at: this.now + delay }); return id; }
  tick(amount) {
    const end = this.now + amount;
    while (true) {
      const found = [...this.jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!found) break;
      const [id, job] = found; this.now = job.at;
      if (job.repeat) job.at += job.delay; else this.jobs.delete(id);
      job.callback();
    }
    this.now = end;
  }
}
function setup(options = {}) {
  const sockets = [], timers = new Clock();
  class FakeSocket {
    readyState = 0; sent = []; throwSend = false;
    constructor(url) { this.url = url; sockets.push(this); }
    send(message) { assert.ok(ALLOWED.has(message), 'read-only transport cannot send parameter frames'); if (this.throwSend) throw Error('send failed'); this.sent.push(message); }
    close() { this.readyState = 3; if (this.throwClose) throw Error('close failed'); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
  }
  return { sockets, timers, session: createReadOnlySession({ WebSocketClass: FakeSocket, timers, now: () => timers.now, wallNow: () => timers.now, ...options }) };
}
test('read-only session starts inert, owns no public socket/sender, and sends exactly the three connection literals', () => {
  const { sockets, timers, session } = setup();
  assert.equal(sockets.length, 0);
  assert.deepEqual(Object.keys(session).sort(), ['connect', 'disconnect', 'snapshot', 'subscribe']);
  session.connect('192.168.0.60'); const socket = sockets[0]; socket.open(); socket.receive('2::');
  assert.equal(session.snapshot().phase, 'connected');
  socket.receive(LIVE); timers.tick(1001);
  assert.equal(session.snapshot().phase, 'live');
  assert.deepEqual(socket.sent, ['3:::INIT', '2::', '3:::ALIVE']);
  const snapshot = session.snapshot(); snapshot.observations.set('a.0.mix', 1);
  assert.equal(session.snapshot().observations.get('a.0.mix'), 0);
  session.disconnect(); assert.equal(timers.jobs.size, 0); assert.equal(session.snapshot().observations.size, 0);
});
test('private targets are validated before construction and every new attempt clears its previous session', () => {
  const { session, sockets } = setup(); session.connect('10.0.0.1'); sockets[0].open(); sockets[0].receive(LIVE);
  for (const target of ['8.8.8.8', '192.168.00.60', 'ws://192.168.0.60', '192.168.0.60/path']) {
    assert.equal(session.connect(target), false); assert.equal(session.snapshot().phase, 'invalid'); assert.equal(session.snapshot().observations.size, 0);
  }
  assert.equal(sockets.length, 1); assert.equal(sockets[0].readyState, 3);
});
test('socket open, model unknown, model verified, partial AUX and actual AUX state remain distinct', () => {
  const { session, sockets } = setup(); session.connect('192.168.0.60'); const socket = sockets[0]; socket.open();
  assert.equal(session.snapshot().phase, 'connected');
  socket.receive('3:::SETD^a.0.mix^0.3\nSETD^a.0.matrix^0');
  assert.equal(session.snapshot().phase, 'partial'); assert.equal(projectLiveState(session.snapshot()).mixes.length, 0);
  socket.receive('3:::SETS^model^ui24'); assert.equal(session.snapshot().phase, 'live');
  assert.equal(projectLiveState(session.snapshot()).mixes[0].position, 0.3);
  session.disconnect(); session.connect('192.168.0.60'); sockets[1].open();
  sockets[1].receive('3:::SETS^model^ui24\nSETD^a.0.mix^0.3');
  const partial = projectLiveState(session.snapshot());
  assert.equal(session.snapshot().phase, 'partial'); assert.equal(partial.mixes[0].browsable, false); assert.equal(partial.mixes[0].position, undefined);
  session.disconnect();
});
test('unsupported known models clear observations without claiming Ui24 capabilities', () => {
  const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); sockets[0].open();
  sockets[0].receive('3:::SETS^model^ui16\nSETD^a.0.matrix^0\nSETD^a.0.mix^0.3');
  assert.equal(session.snapshot().phase, 'unsupported'); assert.equal(session.snapshot().observations.size, 0); assert.equal(timers.jobs.size, 0);
});
test('initial-open/state deadline and silent live socket timeout clear rather than reconnect or replay', () => {
  const { session, sockets, timers } = setup({ timeoutMs: 1500, idleMs: 3000 });
  session.connect('192.168.0.60'); timers.tick(1501);
  assert.equal(session.snapshot().phase, 'timeout'); assert.equal(sockets.length, 1);
  session.connect('192.168.0.60'); sockets[1].open(); sockets[1].receive(LIVE); timers.tick(3001);
  assert.equal(session.snapshot().phase, 'timeout'); assert.equal(session.snapshot().observations.size, 0);
  timers.tick(100000); assert.equal(sockets.length, 2); assert.equal(timers.jobs.size, 0);
});
test('stale callbacks, closed-state messages and repeated connect cannot repopulate or send heartbeat', () => {
  const { session, sockets } = setup(); session.connect('192.168.0.60'); const old = sockets[0]; old.open(); old.receive(LIVE);
  const callbacks = { open: old.onopen, message: old.onmessage, error: old.onerror, close: old.onclose };
  session.connect('192.168.1.60'); const current = sockets[1]; current.open();
  callbacks.open(); callbacks.message({ data: LIVE }); callbacks.message({ data: '2::' }); callbacks.error(); callbacks.close();
  assert.equal(session.snapshot().phase, 'connected'); assert.equal(session.snapshot().observations.size, 0);
  const message = current.onmessage; current.readyState = 3; message({ data: LIVE }); message({ data: '2::' });
  assert.equal(session.snapshot().phase, 'closed'); assert.equal(session.snapshot().observations.size, 0); assert.deepEqual(current.sent, ['3:::INIT']);
});
test('disconnect from a connected observer invalidates INIT and timer setup synchronously', () => {
  const { session, sockets, timers } = setup(); session.subscribe(state => { if (state.phase === 'connected') session.disconnect(); });
  session.connect('192.168.0.60'); sockets[0].open();
  assert.deepEqual(sockets[0].sent, []); assert.equal(timers.jobs.size, 0); assert.equal(session.snapshot().phase, 'disconnected');
});
test('constructor, send and close errors stay terminal and never retain state or retry', () => {
  const bad = setup({ WebSocketClass: class { constructor() { throw Error('blocked'); } } });
  assert.equal(bad.session.connect('192.168.0.60'), false); assert.equal(bad.session.snapshot().phase, 'blocked'); assert.equal(bad.timers.jobs.size, 0);
  for (const trigger of ['init', 'alive', 'heartbeat']) {
    const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); const socket = sockets[0];
    if (trigger === 'init') { socket.throwSend = true; socket.open(); }
    else { socket.open(); socket.receive(LIVE); socket.throwSend = true; if (trigger === 'alive') timers.tick(1001); else socket.receive('2::'); }
    assert.equal(session.snapshot().phase, 'error'); assert.equal(session.snapshot().observations.size, 0); assert.equal(timers.jobs.size, 0);
    socket.throwClose = true; assert.doesNotThrow(() => session.disconnect());
  }
});
test('projection preserves unequal outputs, source families, literal names, false/zero and explicit mode/link unknowns', () => {
  const provider = createLiveProvider();
  provider.receive(LIVE + '\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.1.matrix^0\nSETD^a.1.mix^0.8\nSETD^a.2.matrix^1\nSETD^a.2.mix^0.6\nSETS^a.3.name^Mode unknown\nSETD^i.0.aux.0.value^0\nSETD^i.0.aux.0.pan^0.375\nSETD^i.0.aux.0.mute^0\nSETD^i.0.aux.0.post^0\nSETD^i.0.aux.0.postproc^1\nSETS^i.0.name^<img src=x>\nSETD^l.0.aux.0.value^0.25\nSETD^p.1.aux.0.value^0.5\nSETD^f.3.aux.0.value^0.75\nSETS^i.23.name^Name only');
  const model = projectLiveState({ phase: 'live', detail: 'Received', observations: provider.snapshot() }, 0);
  assert.equal(model.mixes.length, 4); assert.equal(model.mixes[0].position, 0); assert.equal(model.mixes[1].position, 0.8);
  assert.equal(model.mixes[0].levelText, '−∞ dB'); assert.equal(model.mixes[2].browsable, false); assert.equal(model.mixes[3].browsable, false);
  assert.deepEqual(model.sources.map(source => source.sourceId), ['i.0', 'l.0', 'p.1', 'f.3']);
  assert.equal(model.sources[0].name, '<img src=x>'); assert.equal(model.sources[0].panText, 'Pan 0.375 · normalized');
  assert.match(model.sources[0].stateText, /Unmuted.*Pre-fader.*Post-processing/); assert.match(model.sources[3].detail, /Stereo FX/);
  assert.equal(projectLiveState({ phase: 'live', detail: '', observations: provider.snapshot() }, 2).selectedAux, null);
});

class Events {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, [...this.handlers.get(type) || [], fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item !== fn)); }
  emit(type, additions = {}) { for (const fn of [...this.handlers.get(type) || []]) fn({ preventDefault() {}, ...additions }); }
}
const field = value => Object.assign(new Events(), { value, textContent: '', disabled: false, setCustomValidity(value) { this.validity = value; }, reportValidity() {} });
function controllerFixture(repository, transportOptions = {}) {
  const transport = setup(transportOptions), ui = {
    address: field('192.168.0.60'), profile: field(''), connect: field(''), disconnect: field(''), note: field(''), settings: field(''), form: new Events(), navigation: [new Events()],
    close() { this.closed = true; }, profiles(profiles, selected = '') { this.profileOptions = structuredClone(profiles); this.profile.value = selected; },
  };
  const view = { renders: [], render(model) { this.renders.push(model); }, preferences(value) { this.preferred = value; }, destroy() { this.destroyed = true; } };
  const document = Object.assign(new Events(), { hidden: false }), window = new Events();
  const controller = mountLiveController({ session: transport.session, repository, view, ui, document, window });
  return { ...transport, ui, view, document, window, controller };
}
function localSettings() {
  const settings = emptySettings();
  settings.profiles = [{ id: 'rigA', name: '<img src=x>', address: '192.168.1.60', groups: [], navigation: { mixId: null, view: 'channels', expandedGroupId: null } }, { id: 'rigB', name: 'Other rig', address: '10.0.0.2', groups: [], navigation: { mixId: null, view: 'channels', expandedGroupId: null } }];
  settings.selectedProfileId = 'rigA'; settings.preferences.orientation = 'portrait';
  return { settings, status: { mode: 'persistent' } };
}
test('saved rigs/preferences fill untouched controls without connecting; profile or address edits clear synchronously', async () => {
  const app = controllerFixture({ initialize: async () => localSettings(), update() { throw Error('IEM must not persist mixer/profile changes'); } });
  await app.controller.ready;
  assert.equal(app.ui.address.value, '192.168.1.60'); assert.equal(app.sockets.length, 0); assert.equal(app.ui.profileOptions[0].name, '<img src=x>'); assert.equal(app.view.preferred.orientation, 'portrait');
  app.ui.form.emit('submit'); const first = app.sockets[0]; first.open(); first.receive(LIVE); app.controller.selectAux(0);
  assert.equal(app.view.renders.at(-1).selectedAux, 0);
  app.ui.profile.value = 'rigB'; app.ui.profile.emit('change');
  assert.equal(first.readyState, 3); assert.equal(app.session.snapshot().observations.size, 0); assert.equal(app.ui.address.value, '10.0.0.2'); assert.equal(app.sockets.length, 1);
  app.ui.form.emit('submit'); app.sockets[1].open(); app.sockets[1].receive(LIVE);
  app.ui.address.value = '192.168.0.61'; app.ui.address.emit('input');
  assert.equal(app.sockets[1].readyState, 3); assert.equal(app.ui.profile.value, ''); assert.equal(app.view.renders.at(-1).mixes.length, 0); assert.equal(app.sockets.length, 2);
  app.controller.destroy();
});
test('manual Connect remains available while settings load, and late settings cannot retarget/repopulate a session', async () => {
  let finish;
  const app = controllerFixture({ initialize: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(app.ui.connect.disabled, false);
  app.ui.address.value = '10.10.1.2'; app.ui.address.emit('input'); app.ui.form.emit('submit'); app.sockets[0].open(); app.sockets[0].receive(LIVE);
  finish(localSettings()); await app.controller.ready;
  assert.equal(app.ui.address.value, '10.10.1.2'); assert.equal(app.ui.profile.value, ''); assert.equal(app.sockets[0].url, 'ws://10.10.1.2/'); assert.equal(app.sockets.length, 1);
  app.controller.destroy(); assert.equal(app.timers.jobs.size, 0);
});
test('hide, pagehide and mode navigation clear current state and never reconnect on return or late settings', async () => {
  for (const action of ['hide', 'pagehide', 'navigation']) {
    let finish;
    const app = controllerFixture({ initialize: () => new Promise(resolve => { finish = resolve; }) });
    app.ui.form.emit('submit'); const socket = app.sockets[0]; socket.open(); socket.receive(LIVE);
    const callback = socket.onmessage;
    if (action === 'hide') { app.document.hidden = true; app.document.emit('visibilitychange'); }
    else if (action === 'pagehide') app.window.emit('pagehide');
    else app.ui.navigation[0].emit('click');
    callback({ data: LIVE }); finish(localSettings()); await app.controller.ready;
    app.document.hidden = false; app.document.emit('visibilitychange'); app.timers.tick(100000);
    assert.equal(app.sockets.length, 1); assert.equal(socket.readyState, 3); assert.equal(app.view.renders.at(-1).mixes.length, 0); assert.equal(app.ui.address.value, '192.168.0.60');
    assert.ok(socket.sent.every(message => ALLOWED.has(message))); app.controller.destroy();
  }
});
test('closing view before settings complete prevents late DOM/target changes and hidden submit never connects', async () => {
  let finish;
  const app = controllerFixture({ initialize: () => new Promise(resolve => { finish = resolve; }) });
  app.document.hidden = true; app.ui.form.emit('submit'); assert.equal(app.sockets.length, 0);
  app.controller.destroy(); const count = app.view.renders.length;
  finish(localSettings()); await app.controller.ready;
  assert.equal(app.view.renders.length, count); assert.equal(app.ui.address.value, '192.168.0.60'); assert.equal(app.view.destroyed, true);
});
test('partial and contradictory source/output metadata remains visible without fabricated levels or pair merging', () => {
  const provider = createLiveProvider();
  provider.receive(LIVE + '\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.1.matrix^1\nSETS^a.2.name^\nSETD^a.2.matrix^0\nSETD^i.1.aux.0.mute^0\nSETD^i.1.stereoIndex^0\nSETD^i.2.stereoIndex^-1');
  const result = projectLiveState({ phase: 'live', detail: '', observations: provider.snapshot() }, 0);
  assert.match(result.mixes[0].detail, /Link\/mode conflict/); assert.equal(result.mixes[2].name, 'Output 3 — unnamed'); assert.equal(result.mixes[2].position, undefined);
  assert.equal(result.sources[0].position, undefined); assert.match(result.sources[0].detail, /metadata conflict/); assert.equal(result.sources[0].stateText.includes('Unmuted'), true);
  assert.equal(result.mixes[0].themeIndex, 0); assert.equal(result.mixes[1].themeIndex, 1); // Contradictory modes do not theme a fabricated valid pair.
});


test('browser connection failure does not invalidate a valid target and prevent explicit same-address retry', async () => {
  const app = controllerFixture({ initialize: async () => localSettings() }, { WebSocketClass: class { constructor() { throw Error('blocked'); } } });
  await app.controller.ready;
  app.ui.form.emit('submit'); assert.equal(app.session.snapshot().phase, 'blocked'); assert.equal(app.ui.address.validity, '');
  app.ui.form.emit('submit'); assert.equal(app.session.snapshot().phase, 'blocked'); assert.equal(app.ui.address.validity, '');
  app.controller.destroy();
});


const meterFixture = JSON.parse(await readFile(new URL('./fixtures/iem-vu2.json', import.meta.url)));
const vu = meterFixture.frame;
const packetFrame = bytes => '3:::VU2^' + Buffer.from(bytes).toString('base64');

test('meter receipt requires current Ui24 model and never manufactures output/source availability or AUX readiness', () => {
  const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); const socket = sockets[0]; socket.open();
  socket.receive(vu); assert.equal(session.snapshot().meters.size, 0);
  socket.receive('3:::SETS^model^ui24'); socket.receive(vu);
  assert.equal(session.snapshot().meterState, 'fresh');
  assert.equal(projectLiveState(session.snapshot()).mixes.length, 0);
  assert.equal(session.snapshot().phase, 'partial'); // Meter counts are not state/AUX readiness.
  timers.tick(15001); assert.equal(session.snapshot().phase, 'timeout');
  assert.equal(session.snapshot().meters.size, 0);
});

test('meter burst notifications are bounded while keeping the latest whole packet and independent copies', () => {
  const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); const socket = sockets[0]; socket.open(); socket.receive(LIVE);
  const events = []; session.subscribe((snapshot, kind) => { if (kind === 'meters') events.push(snapshot); });
  for (let n = 0; n < 100; n++) {
    const bytes = new Uint8Array(14); bytes[0] = 1; bytes[10] = n;
    socket.receive(packetFrame(bytes));
  }
  assert.equal(events.length, 0); assert.equal(session.snapshot().meters.size, 1);
  timers.tick(99); assert.equal(events.length, 0); timers.tick(1); assert.equal(events.length, 1);
  assert.equal(events[0].meters.get('i.0').vuPostFader, 99 * 0.004167508166392142);
  events[0].meters.clear(); assert.equal(session.snapshot().meters.size, 1);
  assert.throws(() => { session.snapshot().meters.get('i.0').vuPostFader = 123; }, TypeError);
  for (let n = 0; n < 100; n++) socket.receive(vu);
  timers.tick(100); assert.equal(events.length, 2);
  session.disconnect(); assert.equal(timers.jobs.size, 0);
});

test('projection labels source taps, encoded floor and separate FX/output values without pretending AUX contribution', () => {
  const { session, sockets } = setup(); session.connect('192.168.0.60'); const socket = sockets[0]; socket.open();
  socket.receive(LIVE + '\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.1.matrix^0\nSETD^a.1.mix^0.8\nSETD^a.2.matrix^1\nSETS^a.3.name^Unknown mode\nSETD^i.0.aux.0.value^0.4\nSETD^i.0.aux.0.mute^1\nSETD^i.0.aux.0.post^0\nSETD^p.0.aux.0.value^0.5\nSETD^f.0.aux.0.value^0.6');
  socket.receive(vu);
  const model = projectLiveState(session.snapshot(), 0);
  assert.equal(model.mixes[0].meter.status, 'fresh');
  assert.notEqual(model.mixes[0].meter.values[0].position, model.mixes[1].meter.values[0].position);
  assert.equal(model.mixes[0].meter.channelCount, 1); // Individual linked output readbacks, never averaged.
  assert.equal(model.mixes[2].meter.status, 'missing'); // Matrix array slot is not proof of normal AUX meter semantics.
  assert.equal(model.mixes[3].meter.status, 'missing');
  assert.match(model.sources[0].meter.label, /Source post-fader.*NOT AUX send/);
  assert.equal(model.sources[0].meter.values[0].position, 120 * 0.004167508166392142);
  assert.match(model.sources[0].stateText, /Muted.*Pre-fader/); // Does not alter the independent source meter.
  assert.equal(model.sources[1].meter.values[0].db, -80); assert.equal(model.sources[1].meter.values[0].floor, true);
  assert.equal(model.sources[2].meter.channelCount, 2);
  assert.notEqual(model.sources[2].meter.values[0].position, model.sources[2].meter.values[1].position);
  assert.match(model.sources[2].meter.provenance, /firmware unverified/);
  session.disconnect();
});

test('malformed meters cannot refresh freshness, omitted families replace prior samples, and zero is not unknown/stale', () => {
  const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); const socket = sockets[0]; socket.open();
  socket.receive(LIVE); socket.receive(vu); timers.tick(1000);
  for (const frame of ['3:::VU2^!!!', '3:::VU2^A', packetFrame(new Uint8Array(307))]) socket.receive(frame);
  timers.tick(999); assert.equal(session.snapshot().meterState, 'fresh');
  timers.tick(1); assert.equal(session.snapshot().meterState, 'stale');
  const stale = projectLiveState(session.snapshot());
  assert.equal(stale.mixes[0].meter.status, 'stale'); assert.deepEqual(stale.mixes[0].meter.values, []);
  const partial = new Uint8Array(14); partial[0] = 1;
  socket.receive(packetFrame(partial));
  assert.equal(session.snapshot().meterState, 'fresh'); assert.equal(session.snapshot().meters.size, 1);
  assert.equal(projectLiveState(session.snapshot()).mixes[0].meter.status, 'missing');
  assert.equal(session.snapshot().meters.get('i.0').vuPostFader, 0);
  socket.receive(packetFrame(new Uint8Array(8))); assert.equal(session.snapshot().meters.size, 0);
  session.disconnect();
});

test('wrapped base64 and logical state/VU batches work without accepting malformed payload fragments', () => {
  const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); const socket = sockets[0]; socket.open();
  socket.receive(LIVE + '\n' + vu.slice(4)); assert.equal(session.snapshot().meters.size, 50);
  socket.receive(vu.slice(0, 30) + '\n' + vu.slice(30)); assert.equal(session.snapshot().meters.size, 50);
  timers.tick(1000);
  socket.receive(packetFrame(new Uint8Array(8)) + '\nAAAA'); // Complete decode invalid; no partial first-line refresh.
  assert.equal(session.snapshot().meters.size, 50);
  timers.tick(1000); assert.equal(session.snapshot().meterState, 'stale');
  session.disconnect();
});

test('disconnect/reconnect cancels pending meter renders/expiry and stale callbacks cannot refresh a new generation', () => {
  const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); const first = sockets[0]; first.open(); first.receive(LIVE); first.receive(vu);
  const old = first.onmessage, events = []; session.subscribe((value, kind) => { if (kind === 'meters') events.push(value); });
  timers.tick(50); session.disconnect(); assert.equal(timers.jobs.size, 0);
  session.connect('192.168.0.60'); const second = sockets[1]; second.open(); second.receive(LIVE);
  old({ data: vu }); timers.tick(2001);
  assert.equal(session.snapshot().meters.size, 0); assert.equal(session.snapshot().meterState, 'missing');
  assert.equal(events.length, 0); assert.equal(sockets.length, 2);
  session.disconnect(); assert.equal(timers.jobs.size, 0);
});

test('unchanged legitimate parameter state remains live while heartbeat traffic continues, with independent meter expiry', () => {
  const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); const socket = sockets[0]; socket.open(); socket.receive(LIVE); socket.receive(vu);
  for (let n = 0; n < 5; n++) { timers.tick(10000); socket.receive('2::'); }
  assert.equal(session.snapshot().phase, 'live');
  assert.equal(session.snapshot().observations.get('a.0.mix'), 0);
  assert.equal(session.snapshot().meterState, 'stale');
  session.disconnect();
});

test('elapsed/clock guards run before late packets or timer-free snapshots can revive a suspended session', () => {
  for (const observation of ['snapshot', 'packet', 'heartbeat']) for (const jump of ['both', 'wall-only', 'mono-only', 'wall-backward']) {
    let mono = 0, wall = 100000;
    const { session, sockets, timers } = setup({ now: () => mono, wallNow: () => wall });
    session.connect('192.168.0.60'); const socket = sockets[0]; socket.open(); socket.receive(LIVE); socket.receive(vu);
    if (jump === 'both' || jump === 'mono-only') mono += 32000;
    if (jump === 'both' || jump === 'wall-only') wall += 32000;
    if (jump === 'wall-backward') wall -= 1001;
    if (observation === 'packet') socket.receive(vu);
    if (observation === 'heartbeat') socket.receive('2::');
    const snapshot = session.snapshot();
    assert.equal(snapshot.phase, 'timeout', jump + ':' + observation);
    assert.equal(snapshot.observations.size, 0); assert.equal(snapshot.meters.size, 0);
    assert.equal(timers.jobs.size, 0); assert.equal(socket.readyState, 3); assert.equal(sockets.length, 1);
  }
});

test('meter snapshots expire without timer callbacks, while small wall-clock skew does not disconnect a healthy socket', () => {
  let mono = 0, wall = 10000;
  const { session, sockets } = setup({ now: () => mono, wallNow: () => wall });
  session.connect('192.168.0.60'); const socket = sockets[0]; socket.open(); socket.receive(LIVE); socket.receive(vu);
  mono = 500; wall -= 500; socket.receive('2::');
  assert.equal(session.snapshot().phase, 'live'); assert.equal(session.snapshot().meterState, 'fresh');
  mono = 2100; wall += 2000;
  assert.equal(session.snapshot().meterState, 'stale'); assert.equal(session.snapshot().phase, 'live');
  session.disconnect();
});


test('an already-queued old flush cannot discard the new generation pending handle or duplicate its cadence', () => {
  const { session, sockets, timers } = setup(); session.connect('192.168.0.60'); sockets[0].open(); sockets[0].receive(LIVE); sockets[0].receive(vu);
  const oldFlush = [...timers.jobs.values()].find(job => !job.repeat && job.delay === 100).callback;
  session.connect('192.168.0.60'); sockets[1].open(); sockets[1].receive(LIVE); sockets[1].receive(vu);
  const count = timers.jobs.size; oldFlush(); sockets[1].receive(vu);
  assert.equal(timers.jobs.size, count);
  session.disconnect(); assert.equal(timers.jobs.size, 0);
});


test('group binding uses only selected stable rig identity and detaches on manual or early-touched targets', async () => {
  const settings = localSettings(); settings.settings.profiles[1].address = settings.settings.profiles[0].address;
  const app = controllerFixture({ initialize: async () => settings }); await app.controller.ready;
  assert.equal(app.controller.context().profileId, 'rigA');
  app.ui.profile.value = 'rigB'; app.ui.profile.emit('change');
  assert.equal(app.controller.context().profileId, 'rigB'); // Same address, different explicit identity.
  app.ui.address.emit('input'); assert.equal(app.controller.context().profileId, null);
  app.controller.destroy();
  let finish;
  const early = controllerFixture({ initialize: () => new Promise(resolve => { finish = resolve; }) });
  early.ui.address.value = '192.168.1.60'; early.ui.address.emit('input'); early.ui.form.emit('submit');
  finish(settings); await early.controller.ready;
  assert.equal(early.controller.context().profileId, null);
  assert.equal(early.ui.profile.value, '');
  early.controller.destroy();
});

test('live group draft survives names/meters but closes when incoming output mode invalidates its AUX', async () => {
  const repository = new SettingsRepository({ indexedDB: undefined }); await repository.replace(localSettings().settings);
  const app = controllerFixture({ initialize: async () => repository.snapshot() }); await app.controller.ready;
  app.ui.form.emit('submit'); const socket = app.sockets[0]; socket.open();
  socket.receive(LIVE + '\nSETD^a.1.matrix^0\nSETD^a.1.mix^0.4\nSETD^i.0.aux.0.value^0.3\nSETD^l.0.aux.0.value^0.2\nSETD^p.1.aux.0.value^0.1\nSETD^f.0.aux.0.value^0.5');
  app.controller.selectAux(0);
  const ui = { name: {}, cancel: {}, save: {}, message: {}, status: {}, bind(actions) { this.actions = actions; },
    show() { this.visible = true; }, hide() { this.visible = false; }, choices() {}, members(catalog, selected) { this.catalog = catalog; this.selected = [...selected]; this.paints = (this.paints || 0) + 1; }, busy() {}, saved() {}, destroy() {} };
  const editor = mountGroupEditor({ repository, controller: app.controller, ui }); editor.open(); ui.name.value = 'User draft';
  assert.deepEqual(ui.catalog.map(source => source.id), ['i.0', 'l.0', 'p.1', 'f.0']);
  ui.actions.toggle('f.0'); ui.actions.toggle('i.0');
  socket.receive('3:::SETS^i.0.name^Renamed <img src=x>');
  assert.deepEqual(editor.snapshot().members, ['f.0', 'i.0']); assert.equal(ui.name.value, 'User draft');
  assert.equal(ui.catalog[0].name, 'Renamed <img src=x>');
  const paints = ui.paints, revision = app.controller.context().revision;
  for (let n = 0; n < 20; n++) socket.receive(vu);
  app.timers.tick(100);
  assert.equal(ui.paints, paints); assert.equal(app.controller.context().revision, revision);
  socket.receive('3:::SETD^a.0.matrix^1');
  assert.equal(app.session.snapshot().phase, 'live'); // The other AUX is still valid.
  assert.equal(app.controller.context().selectedAux, null);
  assert.ok(app.controller.context().revision > revision);
  assert.equal(ui.visible, false); assert.equal(editor.snapshot(), null);
  assert.deepEqual(repository.snapshot().settings.profiles[0].groups, []);
  assert.ok(socket.sent.every(message => ALLOWED.has(message)));
  editor.destroy(); app.controller.destroy(); await repository.close();
});


test('lifecycle/target changes cancel queued group Save before it can persist or retarget', async () => {
  for (const action of ['hide', 'pagehide', 'navigation', 'disconnect', 'profile', 'address', 'aux']) {
    const repository = new SettingsRepository({ indexedDB: undefined }); await repository.replace(localSettings().settings);
    const app = controllerFixture({ initialize: async () => repository.snapshot() }); await app.controller.ready;
    app.ui.form.emit('submit'); const socket = app.sockets[0]; socket.open(); socket.receive(LIVE + '\nSETD^a.1.matrix^0\nSETD^a.1.mix^0.5'); app.controller.selectAux(0);
    const ui = { name: {}, cancel: {}, save: {}, message: {}, status: {}, bind(value) { this.actions = value; }, show() {}, hide() {}, choices() {}, members() {}, busy() {}, saved() {}, destroy() {} };
    const editor = mountGroupEditor({ repository, controller: app.controller, ui }); editor.open(); ui.name.value = 'Queued group';
    let release; const gate = new Promise(resolve => { release = resolve; }), update = repository.update.bind(repository);
    repository.update = change => gate.then(() => update(change));
    const pending = ui.actions.save();
    if (action === 'hide') { app.document.hidden = true; app.document.emit('visibilitychange'); }
    if (action === 'pagehide') app.window.emit('pagehide');
    if (action === 'navigation') app.ui.navigation[0].emit('click');
    if (action === 'disconnect') app.ui.disconnect.emit('click');
    if (action === 'profile') { app.ui.profile.value = 'rigB'; app.ui.profile.emit('change'); }
    if (action === 'address') { app.ui.address.value = '10.0.0.2'; app.ui.address.emit('input'); }
    if (action === 'aux') app.controller.selectAux(1);
    assert.equal(editor.snapshot(), null, action);
    release(); await pending;
    assert.ok(repository.snapshot().settings.profiles.every(profile => profile.groups.length === 0), action);
    assert.equal(app.sockets.length, 1); assert.ok(socket.sent.every(message => ALLOWED.has(message)));
    editor.destroy(); app.controller.destroy(); await repository.close();
  }
});
