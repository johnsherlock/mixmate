import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { SettingsRepository, emptySettings } from '../src/settings.js';
import { mountGroupEditor } from '../src/iem/group-editor.js';
import { createGroupEditorUI } from '../src/iem/group-editor-ui.js';

function definitions() {
  const settings = emptySettings();
  settings.profiles = ['rig-a', 'rig-b'].map((id, index) => ({ id, name: `Local rig ${index + 1}`, groups: index ? [] : [{ id: 'existing', name: 'Original', members: ['i.9', 'f.0', 'i.2'] }], navigation: { mixId: null, view: 'channels', expandedGroupId: null } }));
  settings.selectedProfileId = 'rig-a'; return settings;
}
async function fixture(options = {}) {
  const factory = options.factory || new IDBFactory(), repository = new SettingsRepository({ indexedDB: options.memory ? undefined : factory });
  await repository.replace(options.settings || definitions());
  let context = { profileId: 'rig-a', revision: 1, ready: true, selectedAux: 0, sources: [{ sourceId: 'i.2', name: '<img src=x> Literal' }, { sourceId: 'f.0', name: 'Synthetic FX' }] };
  const listeners = new Set(), ui = {
    name: { value: '' }, save: { disabled: false }, cancel: {}, message: {}, status: {},
    show(name) { this.visible = true; this.rigName = name; }, hide() { this.visible = false; },
    members(catalog, selected) { this.catalog = structuredClone(catalog); this.selected = [...selected]; this.memberPaints = (this.memberPaints || 0) + 1; },
    choices(groups, id) { this.groups = structuredClone(groups); this.selectedGroup = id; },
    deletable(value) { this.deletableValue = value; }, confirmDelete(name) { this.confirming = name; }, scope(aux, count) { this.scopeValue = [aux, count]; }, bind(handlers) { this.actions = handlers; }, busy(value) { this.busyValue = value; this.save.disabled = value; }, saved(message) { this.savedMessage = message; }, destroy() {},
  };
  const controller = { context: () => context, subscribeContext(listener) { listeners.add(listener); listener(context); return () => listeners.delete(listener); } };
  let id = 0, allowClear = false, enabled;
  const editor = mountGroupEditor({ repository, controller, ui, setEnabled: value => { enabled = value; }, createID: () => `new-${++id}`, confirmClear: () => allowClear });
  return { factory, repository, editor, ui, get enabled() { return enabled; }, allowClear(value) { allowClear = value; },
    context(change) { context = { ...context, ...change }; for (const listener of listeners) listener(context); },
    async close() { editor.destroy(); await repository.close(); } };
}

test('ordered membership is draft-only, unresolved IDs remain explicit, and Cancel never persists live names or edits', async () => {
  const app = await fixture();
  app.editor.open('existing'); assert.deepEqual(app.editor.snapshot().members, ['i.9', 'f.0', 'i.2']);
  assert.equal(app.ui.catalog.find(item => item.id === 'i.9').unresolved, true);
  assert.equal(app.ui.catalog.find(item => item.id === 'f.0').unresolved, false);
  app.ui.actions.toggle('f.0'); app.ui.actions.toggle('f.0');
  assert.deepEqual(app.editor.snapshot().members, ['i.9', 'i.2', 'f.0']);
  app.context({ sources: [{ sourceId: 'i.2', name: 'Renamed <svg onload=alert(1)>' }, { sourceId: 'f.0', name: 'FX renamed' }] });
  assert.deepEqual(app.editor.snapshot().members, ['i.9', 'i.2', 'f.0']);
  assert.equal(app.ui.catalog.find(item => item.id === 'i.2').name, 'Renamed <svg onload=alert(1)>');
  assert.deepEqual(app.repository.snapshot().settings.profiles[0].groups[0].members, ['i.9', 'f.0', 'i.2']);
  app.ui.actions.close(); assert.equal(app.editor.snapshot(), null);
  assert.deepEqual(app.repository.snapshot().settings, definitions());
  await app.close();
});

test('Clear requires confirmation and changes only the draft until Save; durable Save closes', async () => {
  const app = await fixture(); app.editor.open('existing');
  app.ui.actions.clear(); assert.equal(app.editor.snapshot().members.length, 3);
  app.allowClear(true); app.ui.actions.clear(); assert.deepEqual(app.editor.snapshot().members, []);
  assert.equal(app.repository.snapshot().settings.profiles[0].groups[0].members.length, 3);
  app.ui.actions.close(); app.editor.open('existing'); assert.equal(app.editor.snapshot().members.length, 3);
  app.ui.actions.clear(); await app.ui.actions.save();
  assert.deepEqual(app.repository.snapshot().settings.profiles[0].groups[0].members, []);
  assert.equal(app.ui.visible, false); assert.match(app.ui.savedMessage, /saved on this device/);
  await app.close();
});

test('new groups save stable source IDs/order while preserving concurrent preferences and unrelated groups', async () => {
  const app = await fixture(); app.editor.open('existing'); app.ui.actions.selectGroup(null);
  app.ui.name.value = '<b>Local name</b>'; app.ui.actions.toggle('f.0'); app.ui.actions.toggle('i.2');
  const preference = app.repository.update(settings => { settings.preferences.orientation = 'landscape'; settings.profiles[0].groups.push({ id: 'other', name: 'Other', members: ['l.1'] }); });
  const saved = app.ui.actions.save(); await preference; await saved;
  const settings = app.repository.snapshot().settings, group = settings.profiles[0].groups.find(group => group.id.startsWith('new-'));
  assert.deepEqual(group, { id: group.id, name: '<b>Local name</b>', members: ['f.0', 'i.2'] });
  assert.equal(settings.preferences.orientation, 'landscape'); assert.equal(settings.profiles[0].groups.length, 3);
  assert.deepEqual(Object.keys(group).sort(), ['id', 'members', 'name']);
  assert.ok(!JSON.stringify(settings).includes('Synthetic FX'));
  assert.deepEqual(settings.profiles[1].groups, []);
  const reopened = new SettingsRepository({ indexedDB: app.factory });
  assert.deepEqual((await reopened.initialize()).settings.profiles[0].groups, settings.profiles[0].groups);
  await reopened.close(); await app.close();
});

test('offline unresolved groups can be edited without replacing IDs or inventing sources', async () => {
  const app = await fixture(); app.context({ selectedAux: null, sources: [] }); app.editor.open('existing');
  assert.equal(app.ui.catalog.length, 3); assert.ok(app.ui.catalog.every(source => source.unresolved));
  app.ui.name.value = 'Offline rename'; await app.ui.actions.save();
  assert.deepEqual(app.repository.snapshot().settings.profiles[0].groups[0].members, ['i.9', 'f.0', 'i.2']);
  app.context({ profileId: null, revision: 2 }); assert.equal(app.enabled, false); assert.equal(app.editor.open(), false);
  await app.close();
});

test('queued Save is invalidated by rig/session changes and cannot write another same-address profile', async () => {
  for (const next of [{ profileId: 'rig-b', revision: 2 }, { profileId: 'rig-a', revision: 2 }, { profileId: null, revision: 2 }]) {
    const app = await fixture(); app.editor.open('existing'); app.ui.name.value = 'Must not apply';
    let release; const gate = new Promise(resolve => { release = resolve; });
    const original = app.repository.update.bind(app.repository); app.repository.update = updater => gate.then(() => original(updater));
    const pending = app.ui.actions.save(); app.context(next); assert.equal(app.ui.visible, false);
    release(); await pending;
    assert.deepEqual(app.repository.snapshot().settings, definitions());
    await app.close();
  }
});

test('temporary/conflicting group saves remain visibly unsaved and never overwrite newer durable definitions', async () => {
  const memory = await fixture({ memory: true }); memory.editor.open('existing'); memory.ui.name.value = 'Temporary edit'; await memory.ui.actions.save();
  assert.equal(memory.ui.visible, true); assert.equal(memory.ui.cancel.textContent, 'Close'); assert.match(memory.ui.message.textContent, /temporary/);
  await memory.close();
  const app = await fixture(), other = new SettingsRepository({ indexedDB: app.factory }); await other.initialize();
  app.editor.open('existing'); app.ui.name.value = 'Conflicting local edit';
  await other.update(settings => { settings.profiles[0].groups[0].name = 'Other window'; });
  await app.ui.actions.save(); assert.equal(app.ui.visible, true); assert.match(app.ui.status.textContent, /another window.*temporary/);
  assert.equal(app.repository.snapshot().settings.profiles[0].groups[0].name, 'Conflicting local edit');
  const reopened = new SettingsRepository({ indexedDB: app.factory });
  assert.equal((await reopened.initialize()).settings.profiles[0].groups[0].name, 'Other window');
  await reopened.close(); await other.close(); await app.close();
});

test('F08-S03 editor reports transaction abort after put success as temporary and reopen retains durable group', async () => {
  const factory = new IDBFactory(), open = factory.open.bind(factory); let fail = false;
  factory.open = (...args) => {
    const request = open(...args);
    request.addEventListener('success', () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = (...args) => {
        const tx = transaction(...args);
        if (fail && tx.mode === 'readwrite') {
          const objectStore = tx.objectStore.bind(tx);
          tx.objectStore = (...args) => {
            const store = objectStore(...args), put = store.put.bind(store);
            store.put = (...args) => {
              const request = put(...args);
              request.addEventListener('success', () => tx.abort());
              return request;
            };
            return store;
          };
        }
        return tx;
      };
    });
    return request;
  };
  const app = await fixture({ factory }); let reopened;
  try {
    app.editor.open('existing'); app.ui.name.value = 'Accepted only in memory'; fail = true;
    await app.ui.actions.save();
    assert.equal(app.ui.visible, true); assert.equal(app.ui.cancel.textContent, 'Close');
    assert.match(app.ui.message.textContent, /temporary.*not saved/);
    assert.equal(app.ui.savedMessage, undefined);
    assert.equal(app.repository.snapshot().settings.profiles[0].groups[0].name, 'Accepted only in memory');
    reopened = new SettingsRepository({ indexedDB: factory });
    assert.equal((await reopened.initialize()).settings.profiles[0].groups[0].name, 'Original');
  } finally { await reopened?.close(); await app.close(); }
});

test('invalid names, duplicate Save and stale same-repository edits cannot silently replace groups', async () => {
  const app = await fixture(); app.editor.open('existing'); app.ui.name.value = ' ';
  await app.ui.actions.save(); assert.match(app.ui.message.textContent, /not saved/);
  await app.repository.update(settings => { settings.profiles[0].groups[0].members = ['l.0']; });
  app.ui.name.value = 'Stale'; await app.ui.actions.save(); assert.match(app.ui.message.textContent, /changed while/);
  assert.deepEqual(app.repository.snapshot().settings.profiles[0].groups[0].members, ['l.0']);
  await app.close();
});

class Element {
  children = []; className = ''; textContent = ''; attributes = {}; dataset = {}; handlers = new Map();
  constructor(document) { this.ownerDocument = document; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  insertBefore(node, reference) { node.remove(); node.parentElement = this; this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, node); }
  classList = { add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; }, remove: name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); }, contains: name => this.className.split(' ').includes(name), toggle: (name, yes) => yes ? this.classList.add(name) : this.classList.remove(name) };
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { this.handlers.set(type, [...this.handlers.get(type) || [], callback]); }
  removeEventListener(type, callback) { this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item !== callback)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  querySelectorAll(selector) { const nodes = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]); return selector === '*' ? nodes : nodes.filter(node => node.tag === selector); }
  focus() { this.ownerDocument.activeElement = this; }
}
test('editor DOM keeps source names inert and member buttons stable through rename/order updates', () => {
  const document = { createElement(tag) { return Object.assign(new Element(this), { tag }); } }, root = new Element(document), nodes = {};
  for (const selector of ['.mm-layer', '.mm-dialog', '.mm-dialog-body', '.mm-dialog-head', '#mm-dialog-title', '.mm-feedback', '[data-action="edit-groups"]']) nodes[selector] = document.createElement('div');
  nodes['.mm-dialog-head'].append(document.createElement('button'));
  root.querySelector = selector => nodes[selector];
  const ui = createGroupEditorUI(root, { close() {}, beforeOpen() {} });
  ui.bind({}); ui.show('<svg onload=alert(1)>');
  const catalog = [{ id: 'i.0', name: '<img src=x>', unresolved: false }, { id: 'f.0', name: 'FX', unresolved: true }];
  ui.members(catalog, ['f.0', 'i.0']);
  const content = nodes['.mm-dialog-body'].children[0], buttons = content.querySelectorAll('button').filter(button => button.dataset.sourceId);
  assert.equal(buttons[0].children[1].textContent, 'Input 1 · <img src=x>');
  assert.equal(buttons[0].children[1].innerHTML, undefined); assert.equal(buttons[1].children[0].textContent, '1');
  ui.name.value = 'Unsaved user draft'; ui.members([{ ...catalog[0], name: 'Renamed' }, catalog[1]], ['i.0', 'f.0']);
  assert.equal(content.querySelectorAll('button').find(button => button.dataset.sourceId === 'i.0'), buttons[0]);
  assert.equal(buttons[0].children[0].textContent, '1'); assert.equal(ui.name.value, 'Unsaved user draft');
  ui.hide(); ui.destroy();
});


test('F04-S05 delete confirmation keeps keyboard focus inside the editor when it closes', () => {
  const document = { activeElement: null, createElement(tag) { return Object.assign(new Element(this), { tag }); } }, root = new Element(document), nodes = {};
  for (const selector of ['.mm-layer', '.mm-dialog', '.mm-dialog-body', '.mm-dialog-head', '#mm-dialog-title', '.mm-feedback', '[data-action="edit-groups"]']) nodes[selector] = document.createElement('div');
  nodes['.mm-dialog-head'].append(document.createElement('button'));
  root.querySelector = selector => nodes[selector];
  const ui = createGroupEditorUI(root, { close() {}, beforeOpen() {} });
  ui.bind({}); ui.show('Saved rig: A'); ui.deletable(true);
  const content = nodes['.mm-dialog-body'].children[0], remove = content.querySelectorAll('button').find(button => button.textContent === 'Delete group' && !button.parentElement.className.includes('confirm'));
  ui.confirmDelete('Band');
  assert.equal(document.activeElement.textContent, 'Keep group');
  ui.confirmDelete(null);
  assert.equal(document.activeElement, remove, 'Keep/Escape returns focus to the Delete group button');
  ui.confirmDelete('Band'); ui.deletable(false); ui.confirmDelete(null);
  assert.equal(document.activeElement, ui.name, 'a hidden Delete button falls back to the name field');
  ui.busy(true); ui.busy(false); ui.focusEditor();
  assert.equal(document.activeElement, ui.name, 'temporary/failed delete refocuses the open editor');
  ui.hide(); document.activeElement = null; ui.focusEditor();
  assert.equal(document.activeElement, null, 'a closed editor never steals focus');
  ui.destroy();
});

test('repeated Save during persistence cannot create multiple groups or mutate a newer editor context', async () => {
  const app = await fixture(); app.editor.open('existing'); app.ui.name.value = 'Saved once';
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; }), update = app.repository.update.bind(app.repository);
  app.repository.update = change => { calls++; return gate.then(() => update(change)); };
  const first = app.ui.actions.save(); const second = app.ui.actions.save();
  assert.equal(calls, 1); assert.equal(app.ui.busyValue, true); assert.equal(app.ui.cancel.textContent, 'Close');
  release(); await first; await second;
  assert.equal(app.repository.snapshot().settings.profiles[0].groups[0].name, 'Saved once');
  assert.equal(app.ui.visible, false);
  await app.close();
});

test('F04-S05 All Mixes editor offers the received union catalog while keeping retained IDs and per-AUX scope', async () => {
  const app = await fixture();
  app.context({ selectedAux: null, sources: [], catalog: [{ sourceId: 'i.2', name: 'Vox' }, { sourceId: 'l.0', name: 'Line' }, { sourceId: 'a.0', name: 'not a source' }] });
  assert.equal(app.editor.open('existing'), true);
  assert.deepEqual(app.ui.catalog.map(item => [item.id, item.unresolved]), [['i.2', false], ['l.0', false], ['i.9', true], ['f.0', true]]);
  assert.deepEqual(app.ui.scopeValue, [null, 3]);
  app.ui.actions.toggle('l.0'); assert.deepEqual(app.editor.snapshot().members, ['i.9', 'f.0', 'i.2', 'l.0']);
  // Selecting an AUX restores the existing per-AUX catalog rather than the union.
  app.context({ selectedAux: 0, sources: [{ sourceId: 'f.0', name: 'FX' }], catalog: [{ sourceId: 'f.0', name: 'FX' }] });
  assert.deepEqual(app.ui.catalog.map(item => [item.id, item.unresolved]), [['f.0', false], ['i.9', true], ['i.2', true], ['l.0', true]]);
  assert.deepEqual(app.ui.scopeValue, [0, null]);
  await app.close();
});

test('F04-S05 Delete group needs an in-dialog confirmation; cancel and new drafts change nothing', async () => {
  const app = await fixture(); app.editor.open('existing');
  assert.equal(app.ui.deletableValue, true);
  assert.equal(app.ui.actions.requestDelete(), true); assert.equal(app.ui.confirming, 'Original');
  app.ui.actions.toggle('f.0'); assert.deepEqual(app.editor.snapshot().members, ['i.9', 'f.0', 'i.2'], 'membership is locked while confirming');
  await app.ui.actions.save(); assert.deepEqual(app.repository.snapshot().settings, definitions(), 'Save is unavailable while confirming');
  app.ui.actions.cancelDelete(); assert.equal(app.ui.confirming, null); assert.match(app.ui.message.textContent, /cancelled/);
  assert.deepEqual(app.repository.snapshot().settings, definitions());
  await app.ui.actions.confirmDelete(); assert.deepEqual(app.repository.snapshot().settings, definitions(), 'confirm without request is inert');
  app.ui.actions.selectGroup(null); assert.equal(app.ui.deletableValue, false); assert.equal(app.ui.actions.requestDelete(), false);
  app.ui.actions.selectGroup('existing'); app.ui.actions.requestDelete(); app.ui.actions.close();
  assert.equal(app.ui.confirming, null); await app.ui.actions.confirmDelete();
  assert.deepEqual(app.repository.snapshot().settings, definitions());
  await app.close();
});

test('F04-S05 confirmed delete removes only the captured saved-rig group and clears its saved expanded view', async () => {
  const settings = definitions();
  settings.profiles[0].groups.push({ id: 'keep', name: 'Keep', members: ['l.0'] });
  settings.profiles[0].navigation = { mixId: 'a.0', view: 'groups', expandedGroupId: 'existing' };
  settings.profiles[1].groups = [{ id: 'existing', name: 'Same ID other rig', members: [] }];
  const app = await fixture({ settings }); app.editor.open('existing');
  app.ui.actions.requestDelete(); await app.ui.actions.confirmDelete();
  const result = app.repository.snapshot().settings;
  assert.deepEqual(result.profiles[0].groups, [{ id: 'keep', name: 'Keep', members: ['l.0'] }]);
  assert.equal(result.profiles[0].navigation.expandedGroupId, null); assert.equal(result.profiles[0].navigation.mixId, 'a.0');
  assert.deepEqual(result.profiles[1].groups, settings.profiles[1].groups);
  assert.equal(app.ui.visible, false); assert.match(app.ui.savedMessage, /Group deleted.*saved on this device/);
  const reopened = new SettingsRepository({ indexedDB: app.factory });
  assert.deepEqual((await reopened.initialize()).settings, result);
  await reopened.close(); await app.close();
});

test('F04-S05 delete rejects stale groups, stays visibly temporary in memory and cannot follow a changed owner', async () => {
  const stale = await fixture(); stale.editor.open('existing'); stale.ui.actions.requestDelete();
  await stale.repository.update(settings => { settings.profiles[0].groups[0].name = 'Edited elsewhere'; });
  await stale.ui.actions.confirmDelete(); assert.match(stale.ui.message.textContent, /not deleted.*changed while/);
  assert.equal(stale.repository.snapshot().settings.profiles[0].groups.length, 1);
  await stale.close();
  const memory = await fixture({ memory: true }); memory.editor.open('existing'); memory.ui.actions.requestDelete();
  await memory.ui.actions.confirmDelete();
  assert.equal(memory.ui.visible, true); assert.equal(memory.ui.cancel.textContent, 'Close'); assert.match(memory.ui.message.textContent, /deletion is temporary/);
  assert.deepEqual(memory.repository.snapshot().settings.profiles[0].groups, []); assert.equal(memory.editor.snapshot().name, '');
  await memory.close();
  const app = await fixture(); app.editor.open('existing'); app.ui.actions.requestDelete();
  let release; const gate = new Promise(resolve => { release = resolve; });
  const update = app.repository.update.bind(app.repository); app.repository.update = change => gate.then(() => update(change));
  const pending = app.ui.actions.confirmDelete(); app.context({ profileId: 'rig-b', revision: 2 });
  release(); await pending;
  assert.deepEqual(app.repository.snapshot().settings, definitions());
  await app.close();
});

test('F02-S05 groups belong only to the bound snapshot rig; no rig means unavailable with its one-line reason', async () => {
  const app = await fixture();
  let reason = null; app.ui.unavailable = text => { reason = text; };
  app.editor.open('existing'); assert.equal(app.ui.rigName, 'Snapshot: Local rig 1 — groups kept on this device'); app.ui.actions.close();
  app.context({ profileId: null, owner: null, unavailableReason: 'Groups unavailable: the desk reported no usable snapshot name.', revision: 2 });
  assert.equal(app.enabled, false); assert.equal(app.editor.open(), false);
  assert.equal(reason, 'Groups unavailable: the desk reported no usable snapshot name.'); assert.equal(app.ui.visible, false);
  // The removed device-local owner kind addresses nothing.
  app.context({ owner: { kind: 'local', id: 'rig-a' }, revision: 3 }); assert.equal(app.enabled, false); assert.equal(app.editor.open(), false);
  // Switching rigs edits that rig's own groups; nothing moves implicitly.
  app.context({ profileId: 'rig-b', owner: { kind: 'profile', id: 'rig-b' }, revision: 4 });
  assert.equal(app.editor.open(), true); assert.deepEqual(app.ui.groups, []); assert.equal(app.ui.rigName, 'Snapshot: Local rig 2 — groups kept on this device');
  app.ui.name.value = 'Snapshot B band'; app.ui.actions.toggle('i.2'); await app.ui.actions.save();
  const saved = app.repository.snapshot().settings;
  assert.deepEqual(saved.profiles[1].groups.map(group => group.name), ['Snapshot B band']);
  assert.deepEqual(saved.profiles[0].groups, definitions().profiles[0].groups);
  await app.close();
});

