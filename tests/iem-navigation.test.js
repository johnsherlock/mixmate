import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import { SettingsRepository, emptySettings, validateSettings } from '../src/settings.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { mountLiveController } from '../src/iem/live-controller.js';
import { projectGroupNavigation, resolveGroupNavigation } from '../src/iem/group-navigation.js';
import { mountGroupEditor } from '../src/iem/group-editor.js';
const vu = JSON.parse(await readFile(new URL('./fixtures/iem-vu2.json', import.meta.url))).frame;
const state = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.0.mix^0.5\nSETD^a.1.matrix^0\nSETD^a.1.mix^0.6\nSETD^i.0.aux.0.value^0.2\nSETS^i.0.name^<img src=x>\nSETD^l.0.aux.0.value^0.3\nSETD^p.1.aux.0.value^0.4\nSETD^f.1.aux.0.value^0.5\nSETD^i.2.aux.0.value^0.6\nSETS^i.23.name^Name only';
class Events {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, [...this.handlers.get(type) || [], fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item !== fn)); }
  emit(type, event = {}) { for (const fn of [...this.handlers.get(type) || []]) fn({ preventDefault() {}, ...event }); }
}
class Clock {
  now = 0; jobs = new Map(); next = 1;
  setTimeout = (fn, delay) => this.add(fn, delay, false);
  setInterval = (fn, delay) => this.add(fn, delay, true);
  clearTimeout = id => this.jobs.delete(id);
  clearInterval = id => this.jobs.delete(id);
  add(fn, delay, repeat) { const id = this.next++; this.jobs.set(id, { fn, delay, repeat, at: this.now + delay }); return id; }
  tick(amount) { const end = this.now + amount; while (true) { const pair = [...this.jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!pair) break; const [id, job] = pair; this.now = job.at; if (job.repeat) job.at += job.delay; else this.jobs.delete(id); job.fn(); } this.now = end; }
}
function definitions() {
  const settings = emptySettings();
  settings.profiles = ['rig-a', 'rig-b'].map((id, n) => ({ id, name: `Rig ${n + 1}`, address: '192.168.0.60',
    groups: n ? [{ id: 'other', name: 'Other rig group', members: ['p.1'] }] : [{ id: '7_group-Z', name: '<b>Band [one]</b>', members: ['f.1', 'i.20', 'l.0', 'i.0'] }, { id: 'empty', name: 'Empty', members: [] }],
    navigation: { mixId: null, view: 'channels', expandedGroupId: null } }));
  settings.selectedProfileId = 'rig-a'; return settings;
}
const field = value => Object.assign(new Events(), { value, textContent: '', disabled: false, setCustomValidity(value) { this.validity = value; }, reportValidity() {} });
async function fixture({ settings = definitions(), memory = false, repository: provided, factory = new IDBFactory() } = {}) {
  const repository = provided || new SettingsRepository({ indexedDB: memory ? undefined : factory });
  if (!provided) await repository.replace(settings);
  const sockets = [], timers = new Clock();
  class FakeSocket {
    readyState = 0; sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(value) { assert.ok(['3:::INIT', '3:::ALIVE', '2::'].includes(value)); this.sent.push(value); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
  }
  const session = createReadOnlySession({ WebSocketClass: FakeSocket, timers, now: () => timers.now, wallNow: () => timers.now });
  const ui = { address: field('192.168.0.60'), profile: field(''), connect: field(''), disconnect: field(''), note: field(''), settings: field(''), form: new Events(), navigation: [new Events()], close() {}, profiles(rows, id = '') { this.profile.value = id; } };
  const view = { renders: 0, meterRenders: 0, render(model) { this.last = model; this.renders++; }, renderMeters(model) { this.meters = model; this.meterRenders++; }, preferences() {}, destroy() {} };
  const document = Object.assign(new Events(), { hidden: false }), window = new Events();
  const controller = mountLiveController({ session, repository, view, ui, document, window });
  await controller.ready;
  return { factory, repository, session, sockets, timers, ui, view, controller, document, window,
    connect(frame = state) { ui.form.emit('submit'); const socket = sockets.at(-1); socket.open(); if (frame) socket.receive(frame); return socket; },
    async close() { controller.destroy(); if (!provided) await repository.close(); } };
}

test('group projection preserves exact ordered IDs with unresolved placeholders, empty groups and all-source inventory', () => {
  const profile = definitions().profiles[0], sources = ['i.0', 'l.0', 'p.1', 'f.1'].map(sourceId => ({ id: `${sourceId}@0`, sourceId, name: sourceId, position: 0.4 }));
  const base = { selectedAux: 0, selectedMix: { id: 'a.0' }, sources, mixes: [] };
  const groups = projectGroupNavigation(base, profile, null);
  assert.equal(groups.view, 'groups'); assert.equal(groups.showAuxMaster, true); assert.equal(groups.sources.length, 2);
  assert.ok(groups.sources.every(item => item.kind === 'group' && item.position === undefined && item.meter === undefined));
  const expanded = projectGroupNavigation(base, profile, { view: 'groups', expandedGroupId: '7_group-Z' });
  assert.equal(expanded.showAuxMaster, false); assert.deepEqual(expanded.sources.slice(1).map(source => source.sourceId), profile.groups[0].members);
  assert.equal(expanded.sources[2].unresolved, true); assert.equal(expanded.sources[2].position, undefined); assert.equal(expanded.sources[2].meter, undefined);
  assert.equal(expanded.sources[0].kind, 'group'); assert.match(expanded.sources[0].stateText, /unavailable/);
  const all = projectGroupNavigation(base, profile, { view: 'channels' }); assert.equal(all.sources, sources);
  const empty = projectGroupNavigation(base, profile, { view: 'groups', expandedGroupId: 'empty' }); assert.equal(empty.sources.length, 1); assert.equal(empty.showAuxMaster, false);
  assert.equal(projectGroupNavigation({ ...base, selectedAux: null }, profile, null).view, 'overview');
});
test('unsupported EQ/missing group preferences fall back without mutating saved definitions', () => {
  const groups = definitions().profiles[0].groups, preference = { view: 'eq', expandedGroupId: '7_group-Z' }, before = structuredClone(preference);
  assert.equal(resolveGroupNavigation(groups, preference).view, 'groups'); assert.match(resolveGroupNavigation(groups, preference).notice, /EQ.*unavailable/);
  assert.deepEqual(preference, before);
  assert.deepEqual(resolveGroupNavigation(groups, { view: 'groups', expandedGroupId: 'missing' }).expandedGroupId, null);
  assert.equal(resolveGroupNavigation([], null).view, 'channels');
  const bad = definitions(); bad.profiles[0].groups[0].id = 'bad["id"]'; assert.throws(() => validateSettings(bad));
});
test('explicit group toggle/All Channels/overview persist only canonical profile navigation and restore after current AUX evidence', async () => {
  const app = await fixture(); app.connect(); app.controller.selectAux(0); await app.controller.whenNavigationIdle();
  assert.equal(app.view.last.view, 'groups'); assert.equal(app.controller.context().sources.length, 5);
  app.controller.toggleGroup('7_group-Z'); await app.controller.whenNavigationIdle();
  assert.equal(app.view.last.expandedGroupId, '7_group-Z'); assert.equal(app.view.last.showAuxMaster, false);
  assert.equal(app.controller.context().sources.length, 5); // Editor catalog stays full while visible bank is filtered.
  assert.deepEqual(app.repository.snapshot().settings.profiles[0].navigation, { mixId: 'a.0', view: 'groups', expandedGroupId: '7_group-Z' });
  app.controller.toggleGroup('7_group-Z'); await app.controller.whenNavigationIdle(); assert.equal(app.view.last.expandedGroupId, null); assert.equal(app.view.last.view, 'groups');
  app.controller.allChannels(); await app.controller.whenNavigationIdle(); assert.deepEqual(app.view.last.sources.map(source => source.sourceId), ['i.0', 'i.2', 'l.0', 'p.1', 'f.1']);
  app.ui.disconnect.emit('click'); assert.equal(app.view.last.mixes.length, 0); assert.equal(app.sockets.length, 1);
  const socket = app.connect(null); assert.equal(app.view.last.selectedAux, null); socket.receive('3:::SETD^a.0.matrix^0'); assert.equal(app.view.last.selectedAux, null);
  socket.receive(state); assert.equal(app.view.last.selectedAux, 0); assert.equal(app.view.last.view, 'channels');
  app.controller.overview(); await app.controller.whenNavigationIdle(); assert.equal(app.repository.snapshot().settings.profiles[0].navigation.mixId, null);
  assert.equal(app.repository.snapshot().settings.profiles[0].groups[0].name, '<b>Band [one]</b>'); await app.close();
});
test('startup/invalid/missing AUX or unsupported saved EQ never connect or silently rewrite preferences', async () => {
  for (const navigation of [{ mixId: 'a.8', view: 'groups', expandedGroupId: '7_group-Z' }, { mixId: 'a.0', view: 'eq', expandedGroupId: null }]) {
    const settings = definitions(); settings.profiles[0].navigation = navigation;
    const app = await fixture({ settings }); let writes = 0; const update = app.repository.update.bind(app.repository); app.repository.update = change => { writes++; return update(change); };
    assert.equal(app.sockets.length, 0); assert.equal(app.view.last.selectedAux, null); app.connect();
    assert.equal(app.view.last.selectedAux, navigation.mixId === 'a.0' ? 0 : null);
    if (navigation.view === 'eq') assert.match(app.view.last.status, /EQ view is unavailable/);
    assert.equal(writes, 0); assert.deepEqual(app.repository.snapshot().settings.profiles[0].navigation, navigation); await app.close();
  }
});
test('queued older navigation cannot reset a later user choice or write after context/profile/mode changes', async () => {
  for (const action of ['new-choice', 'profile', 'hide', 'mode-drop']) {
    const app = await fixture(); const socket = app.connect(); app.controller.selectAux(0); await app.controller.whenNavigationIdle();
    const before = structuredClone(app.repository.snapshot().settings.profiles[0].navigation), pending = [];
    const update = app.repository.update.bind(app.repository);
    app.repository.update = change => new Promise(resolve => pending.push(resolve)).then(() => update(change));
    app.controller.toggleGroup('7_group-Z'); const old = app.controller.whenNavigationIdle();
    if (action === 'new-choice') app.controller.allChannels();
    if (action === 'profile') { app.ui.profile.value = 'rig-b'; app.ui.profile.emit('change'); }
    if (action === 'hide') { app.document.hidden = true; app.document.emit('visibilitychange'); }
    if (action === 'mode-drop') socket.receive('3:::SETD^a.0.matrix^1');
    for (const release of pending) release(); await old; await app.controller.whenNavigationIdle();
    if (action === 'new-choice') { assert.equal(app.view.last.view, 'channels'); assert.equal(app.repository.snapshot().settings.profiles[0].navigation.view, 'channels'); }
    else { assert.deepEqual(app.repository.snapshot().settings.profiles[0].navigation, before); assert.equal(app.view.last.selectedAux, null); }
    assert.equal(app.repository.snapshot().settings.profiles[1].navigation.mixId, null); await app.close();
  }
});
test('same-address profiles remain isolated and late accepted saves never retarget a newer view/profile', async () => {
  const app = await fixture(); app.connect(); app.controller.selectAux(0); await app.controller.whenNavigationIdle();
  const update = app.repository.update.bind(app.repository); let release, accepted;
  const committed = new Promise(resolve => { accepted = resolve; });
  app.repository.update = change => update(change).then(result => { accepted(); return new Promise(resolve => { release = () => resolve(result); }); });
  app.controller.toggleGroup('7_group-Z'); const old = app.controller.whenNavigationIdle(); await committed;
  app.ui.profile.value = 'rig-b'; app.ui.profile.emit('change'); app.connect();
  assert.equal(app.controller.context().profileId, 'rig-b'); assert.equal(app.view.last.selectedAux, null);
  release(); await old;
  assert.equal(app.controller.context().profileId, 'rig-b'); assert.equal(app.view.last.selectedAux, null); assert.equal(app.sockets.length, 2);
  assert.equal(app.repository.snapshot().settings.profiles[0].navigation.expandedGroupId, '7_group-Z'); assert.equal(app.repository.snapshot().settings.profiles[1].navigation.mixId, null); await app.close();
});
test('navigation updater preserves concurrent groups/preferences and memory-only status stays visibly temporary', async () => {
  for (const memory of [false, true]) {
    const app = await fixture({ memory }); app.connect();
    const concurrent = app.repository.update(settings => { settings.preferences.showMeters = false; settings.profiles[0].groups[0].members = ['l.0', 'f.1']; settings.profiles[1].groups[0].name = 'Other edit'; });
    app.controller.selectAux(0); await concurrent; await app.controller.whenNavigationIdle();
    const settings = app.repository.snapshot().settings;
    assert.equal(settings.preferences.showMeters, false); assert.deepEqual(settings.profiles[0].groups[0].members, ['l.0', 'f.1']); assert.equal(settings.profiles[1].groups[0].name, 'Other edit');
    assert.match(app.view.last.status, memory ? /temporary.*not saved/ : /View saved/); await app.close();
  }
});
test('incoming state/meters never save navigation or override a chosen group, and editor opens its current stable ID', async () => {
  const app = await fixture(); const socket = app.connect(); app.controller.selectAux(0); await app.controller.whenNavigationIdle(); app.controller.toggleGroup('empty'); await app.controller.whenNavigationIdle();
  let writes = 0; const update = app.repository.update.bind(app.repository); app.repository.update = change => { writes++; return update(change); };
  const before = app.view.renders;
  for (let n = 0; n < 25; n++) { socket.receive(vu); app.timers.tick(4); }
  assert.equal(writes, 0); assert.equal(app.view.renders, before); assert.equal(app.view.meters.expandedGroupId, 'empty');
  socket.receive('3:::SETS^i.0.name^Synthetic rename'); assert.equal(writes, 0); assert.equal(app.view.last.expandedGroupId, 'empty');
  const ui = { name: field(''), cancel: field(''), save: field(''), message: field(''), status: field(''), show() {}, hide() {}, members() {}, choices(groups, id) { this.selected = id; }, busy() {}, saved() {}, bind(actions) { this.actions = actions; }, destroy() {} };
  const editor = mountGroupEditor({ repository: app.repository, controller: app.controller, ui });
  editor.open(); assert.equal(ui.selected, 'empty'); ui.name.value = 'Renamed empty'; await ui.actions.save();
  assert.equal(app.view.last.expandedGroupId, 'empty'); assert.equal(app.view.last.sources[0].name, 'Renamed empty'); assert.equal(app.controller.context().profileId, 'rig-a'); assert.equal(app.sockets.length, 1);
  editor.destroy(); await app.close();
});
