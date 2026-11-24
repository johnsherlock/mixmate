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
const state = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.0.mix^0.5\nSETD^a.1.matrix^0\nSETD^a.1.mix^0.6\nSETD^i.0.aux.0.value^0.2\nSETS^i.0.name^<img src=x>\nSETD^l.0.aux.0.value^0.3\nSETD^p.1.aux.0.value^0.4\nSETD^f.1.aux.0.value^0.5\nSETD^i.2.aux.0.value^0.6\nSETS^i.23.name^Name only\nSETS^var.currentSnapshot^Rig 1';
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
  settings.profiles = ['rig-a', 'rig-b'].map((id, n) => ({ id, name: `Rig ${n + 1}`,
    groups: n ? [{ id: 'other', name: 'Other rig group', members: ['p.1'] }] : [{ id: '7_group-Z', name: '<b>Band [one]</b>', members: ['f.1', 'i.20', 'l.0', 'i.0'] }, { id: 'empty', name: 'Empty', members: [] }],
    navigation: { mixId: null, view: 'channels', expandedGroupId: null } }));
  settings.selectedProfileId = 'rig-a'; settings.knownAddresses = ['192.168.0.60']; return settings;
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
  const ui = { feedback: field(''), address: field('192.168.0.60'), connect: field(''), disconnect: field(''), note: field(''), settings: field(''), form: new Events(), navigation: [new Events()], close() {} };
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
  assert.equal(groups.view, 'groups'); assert.equal(groups.sources.length, 2);
  assert.ok(groups.sources.every(item => item.kind === 'group' && item.position === undefined && item.meter === undefined));
  const expanded = projectGroupNavigation(base, profile, { view: 'groups', expandedGroupId: '7_group-Z' });
  assert.equal(expanded.selectedMix, base.selectedMix); assert.deepEqual(expanded.sources.slice(1).map(source => source.sourceId), profile.groups[0].members);
  assert.equal(expanded.sources[2].unresolved, true); assert.equal(expanded.sources[2].position, undefined); assert.equal(expanded.sources[2].meter, undefined);
  assert.equal(expanded.sources[0].kind, 'group'); assert.match(expanded.sources[0].stateText, /unavailable/);
  const all = projectGroupNavigation(base, profile, { view: 'channels' }); assert.equal(all.sources, sources);
  const empty = projectGroupNavigation(base, profile, { view: 'groups', expandedGroupId: 'empty' }); assert.equal(empty.sources.length, 1); assert.equal(empty.selectedMix, base.selectedMix);
  assert.equal(projectGroupNavigation({ ...base, selectedAux: null }, profile, null).view, 'overview');
});

test('F02-S05 the desk snapshot name selects, creates and follows rigs exactly; an address never binds a rig', async () => {
  const app = await fixture(); let enabled;
  const ui = { name: field(''), cancel: field(''), message: field(''), status: field(''), show(label) { this.label = label; }, hide() {}, members(catalog) { this.catalog = catalog; }, choices(groups) { this.groups = groups; }, busy() {}, bind() {}, destroy() {} };
  const editor = mountGroupEditor({ repository: app.repository, controller: app.controller, ui, setEnabled: value => { enabled = value; } });
  try {
    assert.equal(enabled, true); assert.equal(app.controller.context().profileId, 'rig-a', 'offline: last-used rig');
    app.ui.address.emit('input'); assert.equal(app.controller.context().profileId, 'rig-a', 'address edits are not identity');
    const socket = app.connect(state.replace('Rig 1', 'Rig 2')); assert.equal(app.session.snapshot().phase, 'live');
    assert.equal(app.controller.context().profileId, 'rig-b');
    assert.equal(editor.open(), true); assert.deepEqual(ui.groups.map(group => group.id), ['other']); assert.match(ui.label, /Snapshot: Rig 2/);
    // All Mixes (no AUX selected): union of sources received on available AUXes.
    assert.equal(app.controller.context().selectedAux, null);
    assert.deepEqual(ui.catalog.map(source => source.id), ['i.0', 'i.2', 'l.0', 'p.1', 'f.1']);
    assert.equal(ui.catalog[0].name, '<img src=x>');
    // A desk recall of another snapshot follows live: the editor closes, the socket stays.
    socket.receive('3:::SETS^var.currentSnapshot^New show');
    assert.equal(app.controller.context().profileId, null); assert.equal(enabled, false);
    await app.controller.whenRigIdle();
    const created = app.repository.snapshot().settings.profiles.find(rig => rig.name === 'New show');
    assert.ok(created && !['rig-a', 'rig-b'].includes(created.id)); assert.deepEqual(created.groups, []);
    assert.equal(app.controller.context().profileId, created.id); assert.equal(enabled, true);
    assert.equal(app.repository.snapshot().settings.selectedProfileId, created.id);
    assert.equal(socket.readyState, 1); assert.equal(app.sockets.length, 1);
    // Exact, case-sensitive identity: a differently cased name is another rig.
    socket.receive('3:::SETS^var.currentSnapshot^rig 2'); await app.controller.whenRigIdle();
    assert.notEqual(app.controller.context().profileId, 'rig-b');
    assert.deepEqual(app.repository.snapshot().settings.profiles.map(rig => rig.name), ['Rig 1', 'Rig 2', 'New show', 'rig 2']);
    // Recalling a known snapshot returns to its rig and groups.
    socket.receive('3:::SETS^var.currentSnapshot^Rig 1'); assert.equal(app.controller.context().profileId, 'rig-a');
    assert.deepEqual(app.repository.snapshot().settings.profiles[0].groups.map(group => group.id), ['7_group-Z', 'empty']);
  } finally { editor.destroy(); await app.close(); }
});

test('F04-S05 All Mixes union excludes matrix outputs and name-only sources; selecting an AUX narrows the catalog', async () => {
  const app = await fixture();
  try {
    app.ui.address.emit('input');
    app.connect(`${state}\nSETD^a.1.matrix^0\nSETD^i.7.aux.1.value^0.2\nSETD^a.2.matrix^1\nSETD^i.9.aux.2.value^0.1`);
    const all = app.controller.context();
    assert.equal(all.selectedAux, null); assert.deepEqual(all.sources, []);
    assert.deepEqual(all.catalog.map(source => source.sourceId), ['i.0', 'i.2', 'i.7', 'l.0', 'p.1', 'f.1']);
    assert.equal(app.controller.selectAux(1), true);
    assert.deepEqual(app.controller.context().catalog.map(source => source.sourceId), ['i.7']);
    app.ui.disconnect.emit('click');
    assert.deepEqual(app.controller.context().catalog, []);
  } finally { await app.close(); }
});

const focusable = (name, log) => Object.assign(field(''), { focus() { log.push(name); } });
const editorUI = (log = []) => ({ focusLog: log, name: focusable('name', log), cancel: focusable('cancel', log), message: field(''), status: field(''), show() { this.visible = true; }, hide() { this.visible = false; }, members() {}, choices() {}, busy() {}, bind(h) { this.actions = h; }, destroy() {}, saved(m) { this.savedMessage = m; }, deletable() {}, confirmDelete() {}, scope() {} });
for (const memory of [false, true]) test(`F04-S05 deleting the expanded group reports its ${memory ? 'temporary' : 'saved'} outcome instead of silently closing`, async () => {
  const app = await fixture({ memory }), ui = editorUI();
  const editor = mountGroupEditor({ repository: app.repository, controller: app.controller, ui });
  try {
    app.connect(); app.controller.selectAux(0); app.controller.toggleGroup('7_group-Z'); await app.controller.whenNavigationIdle();
    assert.equal(app.controller.context().expandedGroupId, '7_group-Z');
    assert.equal(ui.actions.open(), true); assert.equal(editor.snapshot().id, '7_group-Z');
    ui.actions.requestDelete(); await ui.actions.confirmDelete();
    assert.deepEqual(app.repository.snapshot().settings.profiles[0].groups.map(group => group.id), ['empty']);
    assert.equal(app.controller.context().expandedGroupId, null);
    assert.doesNotMatch(app.view.last.status, /unavailable/, 'a deliberate delete is not reported as a missing saved group');
    if (memory) {
      assert.equal(ui.visible, true, 'temporary delete stays open with its warning');
      assert.match(ui.message.textContent, /deletion is temporary.*lost when this page closes/); assert.doesNotMatch(ui.message.textContent, /Export/);
      assert.equal(ui.focusLog.at(-1), 'name', 'temporary delete returns focus to the name field');
    } else {
      assert.equal(ui.visible, false);
      assert.match(ui.savedMessage, /^Group deleted\./);
    }
  } finally { editor.destroy(); await app.close(); }
});
test('F04-S05 a real context change during a pending delete still closes the editor', async () => {
  const app = await fixture(), ui = editorUI();
  const editor = mountGroupEditor({ repository: app.repository, controller: app.controller, ui });
  try {
    app.connect(); app.controller.selectAux(0); app.controller.toggleGroup('7_group-Z'); await app.controller.whenNavigationIdle();
    editor.open(); ui.actions.requestDelete();
    const pending = ui.actions.confirmDelete();
    app.ui.disconnect.emit('click');
    await pending;
    assert.equal(ui.visible, false); assert.equal(ui.savedMessage, undefined);
  } finally { editor.destroy(); await app.close(); }
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
  assert.equal(app.view.last.expandedGroupId, '7_group-Z'); assert.equal(app.view.last.selectedMix.id, 'a.0');
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
  for (const action of ['new-choice', 'snapshot', 'hide', 'mode-drop']) {
    const app = await fixture(); const socket = app.connect(); app.controller.selectAux(0); await app.controller.whenNavigationIdle();
    const before = structuredClone(app.repository.snapshot().settings.profiles[0].navigation), pending = [];
    const update = app.repository.update.bind(app.repository);
    app.repository.update = change => new Promise(resolve => pending.push(resolve)).then(() => update(change));
    app.controller.toggleGroup('7_group-Z'); const old = app.controller.whenNavigationIdle();
    if (action === 'new-choice') app.controller.allChannels();
    if (action === 'snapshot') socket.receive('3:::SETS^var.currentSnapshot^Rig 2');
    if (action === 'hide') { app.document.hidden = true; app.document.emit('visibilitychange'); }
    if (action === 'mode-drop') socket.receive('3:::SETD^a.0.matrix^1');
    for (const release of pending) release(); await old; await app.controller.whenNavigationIdle();
    if (action === 'new-choice') { assert.equal(app.view.last.view, 'channels'); assert.equal(app.repository.snapshot().settings.profiles[0].navigation.view, 'channels'); }
    else { assert.deepEqual(app.repository.snapshot().settings.profiles[0].navigation, before); assert.equal(app.view.last.selectedAux, action === 'snapshot' ? 0 : null); }
    if (action === 'snapshot') assert.equal(app.controller.context().profileId, 'rig-b');
    assert.equal(app.repository.snapshot().settings.profiles[1].navigation.mixId, null); await app.close();
  }
});
test('snapshot rigs remain isolated and a late accepted save never retargets the newer rig after a desk recall', async () => {
  const app = await fixture(); const socket = app.connect(); app.controller.selectAux(0); await app.controller.whenNavigationIdle();
  const update = app.repository.update.bind(app.repository); let release, accepted;
  const committed = new Promise(resolve => { accepted = resolve; });
  app.repository.update = change => update(change).then(result => { accepted(); return new Promise(resolve => { release = () => resolve(result); }); });
  app.controller.toggleGroup('7_group-Z'); const old = app.controller.whenNavigationIdle(); await committed;
  app.repository.update = update;
  socket.receive('3:::SETS^var.currentSnapshot^Rig 2');
  assert.equal(app.controller.context().profileId, 'rig-b'); assert.equal(app.view.last.expandedGroupId, null);
  release(); await old;
  assert.equal(app.controller.context().profileId, 'rig-b'); assert.equal(app.view.last.expandedGroupId, null); assert.equal(app.sockets.length, 1);
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
  const ui = { name: field(''), cancel: field(''), save: field(''), message: field(''), status: field(''), show() {}, hide() {}, members(sources, members) { this.catalog = sources; this.ordered = members; }, choices(groups, id) { this.selected = id; }, busy() {}, saved() {}, bind(actions) { this.actions = actions; }, destroy() {} };
  const editor = mountGroupEditor({ repository: app.repository, controller: app.controller, ui });
  ui.actions.open(); assert.equal(ui.selected, 'empty'); assert.deepEqual(ui.catalog.map(source => source.id), ['i.0', 'i.2', 'l.0', 'p.1', 'f.1']); assert.deepEqual(ui.ordered, []); ui.name.value = 'Renamed empty'; await ui.actions.save();
  assert.equal(app.view.last.expandedGroupId, 'empty'); assert.equal(app.view.last.sources[0].name, 'Renamed empty'); assert.equal(app.controller.context().profileId, 'rig-a'); assert.equal(app.sockets.length, 1);
  editor.destroy(); await app.close();
});


test('a reopened repository restores an expanded group only after explicit Connect and current model/AUX observations', async () => {
  const factory = new IDBFactory(), first = await fixture({ factory });
  first.connect(); first.controller.selectAux(0); await first.controller.whenNavigationIdle();
  first.controller.toggleGroup('7_group-Z'); await first.controller.whenNavigationIdle(); await first.close();
  const repository = new SettingsRepository({ indexedDB: factory });
  const reopened = await fixture({ repository });
  try {
    assert.equal(reopened.sockets.length, 0); assert.equal(reopened.view.last.selectedAux, null); assert.equal(reopened.view.last.sources.length, 0);
    const socket = reopened.connect(null);
    assert.equal(reopened.view.last.expandedGroupId, null); assert.equal(reopened.view.last.sources.length, 0);
    socket.receive('3:::SETS^var.currentSnapshot^Rig 1\nSETD^a.0.mix^0.5\nSETD^a.0.matrix^0');
    assert.equal(reopened.view.last.selectedAux, null); // Unknown model cannot restore a Ui24 view.
    socket.receive('3:::SETS^model^ui24');
    assert.equal(reopened.view.last.selectedAux, 0); assert.equal(reopened.view.last.expandedGroupId, '7_group-Z');
    assert.equal(reopened.view.last.sources[0].kind, 'group'); assert.ok(reopened.view.last.sources.slice(1).every(source => source.unresolved));
    assert.equal(reopened.view.last.selectedMix.id, 'a.0'); assert.equal(reopened.sockets.length, 1);
    socket.receive(state);
    assert.deepEqual(reopened.view.last.sources.slice(1).map(source => source.sourceId), ['f.1', 'i.20', 'l.0', 'i.0']);
    assert.equal(reopened.view.last.sources[2].unresolved, true);
  } finally { await reopened.close(); await repository.close(); }
});

test('legacy either-side preferences restore one logical identity and migrate only on explicit navigation', async () => {
  for (const oldSide of [0, 1]) {
    const settings = definitions(); settings.profiles[0].navigation = { mixId: `a.${oldSide}`, view: 'groups', expandedGroupId: 'empty' };
    const app = await fixture({ settings });
    try {
      let writes = 0; const update = app.repository.update.bind(app.repository); app.repository.update = change => { writes++; return update(change); };
      const socket = app.connect(state + '\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETS^a.0.name^DARA’S\nSETS^a.1.name^MIX');
      assert.equal(app.view.last.selectedAux, 0); assert.equal(app.view.last.selectedMix.id, 'a.0');
      assert.equal(app.view.last.selectedMix.name, 'DARA’S MIX'); assert.equal(app.view.last.expandedGroupId, 'empty');
      assert.equal(writes, 0); assert.equal(app.repository.snapshot().settings.profiles[0].navigation.mixId, `a.${oldSide}`);
      assert.equal(app.controller.selectAux(1), false);
      socket.receive('3:::SETD^a.0.stereoIndex^-1\nSETD^a.1.stereoIndex^-1');
      assert.equal(app.view.last.selectedAux, 0); assert.equal(writes, 0);
      socket.receive('3:::SETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1');
      assert.equal(app.view.last.selectedMix.id, 'a.0'); assert.equal(writes, 0);
      app.controller.allChannels(); await app.controller.whenNavigationIdle();
      assert.equal(writes, 1); assert.equal(app.repository.snapshot().settings.profiles[0].navigation.mixId, 'a.0');
      assert.equal(app.repository.snapshot().settings.profiles[1].navigation.mixId, null);
    } finally { await app.close(); }
  }
});


test('F09-S08: the live setup and Edit Groups dialogs have no Export settings control (user decision 2026-11-20)', async () => {
  const source = await Promise.all(['../src/iem/live-controller.js', '../src/iem/group-editor-ui.js', '../src/iem/group-editor.js', '../connection-test.html', '../src/settings-recovery.js'].map(file => readFile(new URL(file, import.meta.url), 'utf8')));
  for (const text of source) { assert.doesNotMatch(text, /Export settings'|>Export settings<|exportSettings|export-settings|import-settings/); }
  const app = await fixture({ memory: true });
  try {
    assert.equal(app.controller.exportSettings, undefined);
    app.connect(); await app.controller.whenRigIdle();
    let bound;
    const ui = { name: field(''), cancel: field(''), message: field(''), status: field(''), show() {}, hide() {}, members() {}, choices() {}, busy() {}, bind(actions) { bound = actions; this.actions = actions; }, destroy() {} };
    const editor = mountGroupEditor({ repository: app.repository, controller: app.controller, ui, createID: () => 'offline-group' });
    editor.open(); ui.name.value = 'Temporary live group'; await ui.actions.save();
    assert.equal(bound.exportSettings, undefined); assert.match(ui.message.textContent, /temporary.*lost when this page closes/);
    assert.equal(app.sockets.length, 1); editor.destroy();
  } finally { await app.close(); }
});

// F09-S12 (user request 2026-11-22): All Groups and Create/Edit Group.
test('F09-S12 All Groups returns to the group fader view like collapsing, saves only navigation and sends nothing', async () => {
  const app = await fixture();
  try {
    const socket = app.connect(); app.controller.selectAux(0); app.controller.toggleGroup('7_group-Z'); await app.controller.whenNavigationIdle();
    assert.equal(app.controller.context().expandedGroupId, '7_group-Z');
    const sent = [...socket.sent];
    app.controller.allGroups(); await app.controller.whenNavigationIdle();
    assert.equal(app.controller.context().expandedGroupId, null); assert.equal(app.view.last.view, 'groups'); assert.equal(app.view.last.expandedGroupId, null);
    assert.deepEqual(app.repository.snapshot().settings.profiles[0].navigation, { mixId: 'a.0', view: 'groups', expandedGroupId: null });
    app.controller.allChannels(); await app.controller.whenNavigationIdle(); assert.equal(app.view.last.view, 'channels');
    app.controller.allGroups(); await app.controller.whenNavigationIdle(); assert.equal(app.view.last.view, 'groups');
    const renders = app.view.renders; app.controller.allGroups(); await app.controller.whenNavigationIdle(); assert.equal(app.view.renders, renders, 'already there: no change');
    assert.deepEqual(socket.sent, sent, 'navigation writes nothing to the mixer');
    app.controller.overview(); app.controller.allGroups(); await app.controller.whenNavigationIdle(); assert.equal(app.controller.context().selectedAux, null, 'no AUX: nothing to show');
  } finally { await app.close(); }
});

test('F09-S12 the header button opens the editor on a NEW group unless a group is expanded (Edit Group)', async () => {
  const app = await fixture(), ui = editorUI();
  const editor = mountGroupEditor({ repository: app.repository, controller: app.controller, ui });
  try {
    app.connect(); app.controller.selectAux(0); await app.controller.whenNavigationIdle();
    assert.equal(ui.actions.open(), true, 'Create Group'); assert.equal(editor.snapshot().name, ''); assert.deepEqual(editor.snapshot().members, []);
    assert.ok(!['7_group-Z', 'empty'].includes(editor.snapshot().id), 'a new group id, not an existing group');
    ui.actions.close();
    assert.equal(editor.open(), true); assert.deepEqual(editor.snapshot().members, [], 'programmatic open without an id is also a new group');
    ui.actions.close();
    app.controller.toggleGroup('7_group-Z'); await app.controller.whenNavigationIdle();
    assert.equal(ui.actions.open(), true, 'Edit Group'); assert.equal(editor.snapshot().id, '7_group-Z');
    ui.actions.close();
    app.controller.allGroups(); await app.controller.whenNavigationIdle();
    assert.equal(ui.actions.open(), true); assert.equal(editor.snapshot().members.length, 0, 'back to Create Group after All Groups');
  } finally { editor.destroy(); await app.close(); }
});
