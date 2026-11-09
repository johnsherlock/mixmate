import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { SettingsRepository, emptySettings } from '../src/settings.js';
import { mountGroupEditor } from '../src/iem/group-editor.js';
import { createGroupEditorUI } from '../src/iem/group-editor-ui.js';

function definitions() {
  const settings = emptySettings();
  settings.profiles = ['rig-a', 'rig-b'].map((id, index) => ({ id, name: `Local rig ${index + 1}`, address: '192.168.0.60', groups: index ? [] : [{ id: 'existing', name: 'Original', members: ['i.9', 'f.0', 'i.2'] }], navigation: { mixId: null, view: 'channels', expandedGroupId: null } }));
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
    bind(handlers) { this.actions = handlers; }, busy(value) { this.busyValue = value; this.save.disabled = value; }, saved(message) { this.savedMessage = message; }, destroy() {},
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
  app.editor.open(); assert.deepEqual(app.editor.snapshot().members, ['i.9', 'f.0', 'i.2']);
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
  const app = await fixture(); app.editor.open();
  app.ui.actions.clear(); assert.equal(app.editor.snapshot().members.length, 3);
  app.allowClear(true); app.ui.actions.clear(); assert.deepEqual(app.editor.snapshot().members, []);
  assert.equal(app.repository.snapshot().settings.profiles[0].groups[0].members.length, 3);
  app.ui.actions.close(); app.editor.open(); assert.equal(app.editor.snapshot().members.length, 3);
  app.ui.actions.clear(); await app.ui.actions.save();
  assert.deepEqual(app.repository.snapshot().settings.profiles[0].groups[0].members, []);
  assert.equal(app.ui.visible, false); assert.match(app.ui.savedMessage, /saved on this device/);
  await app.close();
});

test('new groups save stable source IDs/order while preserving concurrent preferences and unrelated groups', async () => {
  const app = await fixture(); app.editor.open(); app.ui.actions.selectGroup(null);
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
  const app = await fixture(); app.context({ selectedAux: null, sources: [] }); app.editor.open();
  assert.equal(app.ui.catalog.length, 3); assert.ok(app.ui.catalog.every(source => source.unresolved));
  app.ui.name.value = 'Offline rename'; await app.ui.actions.save();
  assert.deepEqual(app.repository.snapshot().settings.profiles[0].groups[0].members, ['i.9', 'f.0', 'i.2']);
  app.context({ profileId: null, revision: 2 }); assert.equal(app.enabled, false); assert.equal(app.editor.open(), false);
  await app.close();
});

test('queued Save is invalidated by rig/session changes and cannot write another same-address profile', async () => {
  for (const next of [{ profileId: 'rig-b', revision: 2 }, { profileId: 'rig-a', revision: 2 }, { profileId: null, revision: 2 }]) {
    const app = await fixture(); app.editor.open(); app.ui.name.value = 'Must not apply';
    let release; const gate = new Promise(resolve => { release = resolve; });
    const original = app.repository.update.bind(app.repository); app.repository.update = updater => gate.then(() => original(updater));
    const pending = app.ui.actions.save(); app.context(next); assert.equal(app.ui.visible, false);
    release(); await pending;
    assert.deepEqual(app.repository.snapshot().settings, definitions());
    await app.close();
  }
});

test('temporary/conflicting group saves remain visibly unsaved and never overwrite newer durable definitions', async () => {
  const memory = await fixture({ memory: true }); memory.editor.open(); memory.ui.name.value = 'Temporary edit'; await memory.ui.actions.save();
  assert.equal(memory.ui.visible, true); assert.equal(memory.ui.cancel.textContent, 'Close'); assert.match(memory.ui.message.textContent, /temporary/);
  await memory.close();
  const app = await fixture(), other = new SettingsRepository({ indexedDB: app.factory }); await other.initialize();
  app.editor.open(); app.ui.name.value = 'Conflicting local edit';
  await other.update(settings => { settings.profiles[0].groups[0].name = 'Other window'; });
  await app.ui.actions.save(); assert.equal(app.ui.visible, true); assert.match(app.ui.status.textContent, /another window.*temporary/);
  assert.equal(app.repository.snapshot().settings.profiles[0].groups[0].name, 'Conflicting local edit');
  const reopened = new SettingsRepository({ indexedDB: app.factory });
  assert.equal((await reopened.initialize()).settings.profiles[0].groups[0].name, 'Other window');
  await reopened.close(); await other.close(); await app.close();
});

test('invalid names, duplicate Save and stale same-repository edits cannot silently replace groups', async () => {
  const app = await fixture(); app.editor.open(); app.ui.name.value = ' ';
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


test('repeated Save during persistence cannot create multiple groups or mutate a newer editor context', async () => {
  const app = await fixture(); app.editor.open(); app.ui.name.value = 'Saved once';
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
