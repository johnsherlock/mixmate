import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { MixerConnection, OUTBOUND } from '../src/protocol.js';
import { FaderIntent } from '../src/fader-intent.js';
import { observeOfflineUpdates, currentEntryRequirements } from '../src/offline.js';
import { SettingsRepository, emptySettings } from '../src/settings.js';
import { mountRigSettings } from '../src/rig-settings.js';
import { mountSettingsRecovery, parseSettingsBackup, settingsBackupText, MAX_SETTINGS_BYTES } from '../src/settings-recovery.js';
import { IDBFactory } from 'fake-indexeddb';
import { faderValueToDB } from 'soundcraft-ui-connection';

// Execute the actual app entry against a minimal DOM and fake socket. There is
// no network-capable WebSocket or fetch in this context.
const source = (await readFile(new URL('../src/main.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
class Events {
  handlers = new Map();
  addEventListener(type, callback) { this.handlers.set(type, [...(this.handlers.get(type) || []), callback]); }
  removeEventListener(type, callback) { this.handlers.set(type, (this.handlers.get(type) || []).filter(handler => handler !== callback)); }
  emit(type) { for (const callback of [...(this.handlers.get(type) || [])]) callback({ preventDefault() {} }); }
}
class Element extends Events {
  value = ''; checked = false; disabled = false; hidden = false;
  textContent = ''; dataset = {}; style = {}; attributes = {}; options = [];
  add(option) { this.options.push(option); if (!this.value) this.value = String(option.value); }
  replaceChildren() { this.options = []; this.value = ''; }
  focus() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  setCustomValidity(value) { this.validity = value; }
  checkValidity() { return !this.validity; }
  reportValidity() {}
}
function app({ offline, storage = new Map(), storageAccess, indexedDB, repository, confirmDelete = true, storageManager } = {}) {
  const elements = new Map(), sockets = [], intervals = new Map(), downloads = [], cacheOperations = [];
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  element('address').value = '192.168.0.60';
  element('offline-version').textContent = 'Offline version: not verified';
  element('update-complete').hidden = element('update-waiting').hidden = true;
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(message) { this.sent.push(message); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
    close() { this.readyState = 3; }
  }
  let client, settingsRepository, settingsController, recoveryController;
  class FakeSettingsRepository extends SettingsRepository {
    constructor() { super({ indexedDB }); settingsRepository = repository || this; return settingsRepository; }
  }
  class FakeConnection extends MixerConnection {
    constructor(options) { super({ ...options, WebSocketClass: FakeSocket }); client = this; }
  }
  const document = Object.assign(new Events(), { hidden: false, baseURI: 'https://example.test/mixmate/', getElementById: element, querySelector: element, querySelectorAll: () => [] });
  const window = Object.assign(new Events(), { isSecureContext: true, confirm: () => confirmDelete });
  const navigator = { storage: storageManager, userAgent: 'fake browser', ...(offline ? { serviceWorker: new Events() } : {}) };
  vm.runInNewContext(source, {
    document, window, navigator, location: { origin: 'https://example.test' },
    localStorage: storageAccess || { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    Option: function(text, value) { this.textContent = text; this.value = String(value); },
    MixerConnection: FakeConnection, FaderIntent, faderValueToDB, verifyOfflineCopy: offline, observeOfflineUpdates, currentEntryRequirements, SettingsRepository: FakeSettingsRepository,
    mountRigSettings: options => { settingsController = mountRigSettings(options); return settingsController; },
    mountSettingsRecovery: options => { recoveryController = mountSettingsRecovery({ ...options, download: text => downloads.push(text) }); return recoveryController; },
    caches: { delete: key => cacheOperations.push(key), keys: () => [] },
    setInterval: (callback, delay) => { const key = intervals.size; intervals.set(key, { callback, delay }); return key; },
    clearTimeout, setTimeout, URL, requestAnimationFrame: callback => callback(),
  });
  return { document, window, serviceWorker: navigator.serviceWorker, element, sockets, storage, intervals, settingsReady: () => settingsController.ready, settingsIdle: () => settingsController.whenIdle(),
    downloads, cacheOperations, recoveryIdle: () => recoveryController.whenIdle(), protectionIdle: () => recoveryController.protectionIdle(),
    repository: () => settingsRepository, close: () => { client.disconnect(); return settingsRepository.close(); } };
}

test('startup, hiding, page navigation and reopening never connect without a user action', () => {
  const view = app();
  try {
    assert.equal(view.sockets.length, 0);
    assert.equal(view.element('fader-control').disabled, true);
    view.element('connect-form').emit('submit');
    assert.equal(view.sockets.length, 1);
    const socket = view.sockets[0];
    socket.open();
    socket.receive('3:::SETS^i.0.name^<img src=x>\nSETD^i.0.mix^0.6\nSETD^i.0.mute^0\nSETD^i.0.stereoIndex^-1');
    assert.equal(view.element('channel-name').textContent, '<img src=x>');
    assert.equal(view.element('channel-name').innerHTML, undefined);
    assert.notEqual(view.element('fader').textContent, '—');
    view.element('enable-fader').checked = true;
    view.element('enable-fader').emit('change');
    assert.equal(view.element('fader-control').disabled, false);
    // Begin an uncommitted gesture, then hide. Nothing must be sent or replayed.
    view.element('fader-control').value = '0.8';
    view.element('fader-control').emit('input');
    const oldMessage = socket.onmessage;
    view.document.hidden = true;
    view.document.emit('visibilitychange');
    assert.equal(socket.readyState, 3);
    assert.equal(view.element('enable-fader').checked, false);
    assert.equal(view.element('fader-control').disabled, true);
    assert.equal(view.element('fader').textContent, '—');
    assert.equal(view.element('channel-name').textContent, 'Waiting for a name');
    view.document.hidden = false;
    view.document.emit('visibilitychange');
    view.element('fader-control').emit('change');
    oldMessage({ data: '3:::SETD^i.0.mix^0.9' });
    assert.equal(view.element('fader').textContent, '—');
    assert.equal(view.sockets.length, 1);
    assert.deepEqual(socket.sent, [OUTBOUND.init]);
    assert.deepEqual([...view.storage.keys()], []);
    view.element('connect-form').emit('submit');
    const second = view.sockets[1]; second.open();
    second.receive('3:::SETD^i.0.mix^0.4\nSETD^i.0.stereoIndex^-1');
    assert.equal(view.element('enable-fader').checked, false);
    view.window.emit('pagehide');
    assert.equal(second.readyState, 3);
    assert.equal(view.element('fader').textContent, '—');
    assert.equal(view.element('enable-fader').checked, false);
    assert.equal(view.sockets.length, 2);
    assert.ok(view.sockets.every(s => s.sent.every(message => Object.values(OUTBOUND).includes(message))));
    const reopened = app();
    assert.equal(reopened.sockets.length, 0);
    assert.equal(reopened.element('fader').textContent, '—');
    reopened.close();
  } finally { view.close(); }
});

test('late offline results cannot override a newer controller verification or connect to a mixer', async () => {
  const attempts = [];
  const view = app({ offline: () => new Promise(resolve => attempts.push(resolve)) });
  try {
    // controllerchange can overlap startup preparation; latest result owns the UI.
    view.document.hidden = true;
    view.window.emit('pagehide');
    view.serviceWorker.emit('controllerchange');
    attempts[1]({ ready: false, version: 'new' });
    await new Promise(resolve => setImmediate(resolve));
    attempts[0]({ ready: true, version: 'old' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.element('offline-status').textContent, 'Offline copy not ready');
    assert.equal(view.sockets.length, 0);
  } finally { view.close(); }
});


test('channel selector follows all received names without replacing options, changing selection or sending writes', () => {
  const view = app();
  try {
    const select = view.element('channel'), original = [...select.options];
    const fallbacks = Array.from({ length: 24 }, (_, i) => `Channel ${String(i + 1).padStart(2, '0')}`);
    assert.equal(original.length, 24);
    assert.deepEqual(original.map(option => option.value), Array.from({ length: 24 }, (_, i) => String(i + 1)));
    assert.deepEqual(original.map(option => option.textContent), fallbacks);
    select.value = '7'; select.emit('change');
    const disabled = select.disabled;
    view.element('connect-form').emit('submit');
    const socket = view.sockets[0]; socket.open();
    // Partial initialization names unselected channels too; absent/empty names stay fallback.
    const special = 'Lead <img src=x onerror=alert(1)> & "Synth" ^ R';
    socket.receive(`3:::SETS^i.0.name^Vocal A\nSETS^i.6.name^Keys\nSETS^i.23.name^${special}\nSETS^i.12.name^`);
    assert.equal(select.options[0].textContent, 'Channel 01 — Vocal A');
    assert.equal(select.options[6].textContent, 'Channel 07 — Keys');
    assert.equal(select.options[23].textContent, `Channel 24 — ${special}`);
    assert.equal(select.options[23].innerHTML, undefined);
    assert.equal(select.options[12].textContent, 'Channel 13');
    assert.equal(select.options[10].textContent, 'Channel 11');
    assert.equal(view.element('enable-fader').disabled, true);
    socket.receive('3:::SETD^i.6.mix^0.4\nSETD^i.6.stereoIndex^-1');
    view.element('enable-fader').checked = true;
    view.element('enable-fader').emit('change');
    assert.equal(view.element('fader-control').disabled, false);
    // Native-client rename of an unselected channel must refresh its option only.
    socket.receive('3:::SETS^i.0.name^Vocal Renamed\nSETS^i.6.name^');
    assert.equal(select.options[0].textContent, 'Channel 01 — Vocal Renamed');
    assert.equal(select.options[6].textContent, 'Channel 07');
    assert.equal(select.value, '7');
    assert.equal(select.disabled, disabled);
    assert.equal(view.element('enable-fader').checked, true);
    assert.equal(view.element('fader-control').disabled, false);
    for (let i = 0; i < 24; i++) {
      assert.equal(select.options[i], original[i]);
      assert.equal(select.options[i].value, String(i + 1));
    }
    socket.receive('3:::' + original.map((_, i) => `SETS^i.${i}.name^Source ${i + 1}`).join('\n'));
    assert.deepEqual(select.options.map(option => option.textContent), fallbacks.map((label, i) => `${label} — Source ${i + 1}`));
    assert.equal(select.value, '7');
    view.element('disconnect').emit('click');
    assert.deepEqual(select.options.map(option => option.textContent), fallbacks);
    assert.equal(view.element('enable-fader').checked, false);
    assert.equal(view.element('fader-control').disabled, true);
    view.element('connect-form').emit('submit');
    const fresh = view.sockets[1]; fresh.open();
    assert.deepEqual(select.options.map(option => option.textContent), fallbacks);
    fresh.receive('3:::SETS^i.1.name^Fresh source');
    assert.equal(select.options[1].textContent, 'Channel 02 — Fresh source');
    assert.equal(select.options[0].textContent, 'Channel 01');
    view.document.hidden = true; view.document.emit('visibilitychange');
    assert.deepEqual(select.options.map(option => option.textContent), fallbacks);
    assert.equal(select.value, '7');
    assert.ok(view.sockets.every(s => s.sent.every(message => Object.values(OUTBOUND).includes(message))));
    assert.ok(view.sockets.every(s => s.sent.every(message => !message.includes('SETD') && !message.includes('SETS'))));
  } finally { view.close(); }
});


const versionA = '1111111111111111', versionB = '2222222222222222';
const versionKey = 'mixmate-offline-version';
const settle = () => new Promise(resolve => setImmediate(resolve));
function registration() { return Object.assign(new Events(), { active: { state: 'activated' }, installing: null, waiting: null }); }
function offlineResult(result, reg = registration()) {
  return async options => { options.onRegistration?.(reg); return result; };
}
test('first verified version seeds history silently and same-version reopen shows no update alert', async () => {
  const storage = new Map();
  for (let open = 0; open < 2; open++) {
    const view = app({ storage, offline: offlineResult({ ready: true, version: versionA }) });
    await settle();
    assert.equal(view.element('offline-version').textContent, `Offline version: ${versionA}`);
    assert.equal(storage.get(versionKey), versionA);
    assert.equal(view.element('update-complete').hidden, true);
    assert.equal(view.sockets.length, 0);
    view.close();
  }
});
test('a newly verified activated version announces an update once and records it', async () => {
  const storage = new Map([[versionKey, versionA]]);
  const view = app({ storage, offline: offlineResult({ ready: true, version: versionB }) });
  await settle();
  assert.equal(view.element('update-complete').hidden, false);
  assert.match(view.element('update-complete').textContent, /MixMate updated/);
  assert.equal(view.element('offline-version').textContent, `Offline version: ${versionB}`);
  assert.equal(storage.get(versionKey), versionB);
  assert.equal(view.sockets.length, 0);
  view.close();
  const reopened = app({ storage, offline: offlineResult({ ready: true, version: versionB }) });
  await settle();
  assert.equal(reopened.element('update-complete').hidden, true);
  reopened.close();
});
test('failed verification, timeout and invalid versions never advance update history', async () => {
  for (const offline of [offlineResult({ ready: false, version: versionB }), async () => { throw new Error('Offline preparation timed out.'); }, offlineResult({ ready: true, version: '<invalid>' })]) {
    const storage = new Map([[versionKey, versionA]]), view = app({ storage, offline });
    await settle();
    assert.equal(storage.get(versionKey), versionA);
    assert.equal(view.element('update-complete').hidden, true);
    assert.equal(view.element('offline-version').textContent, 'Offline version: not verified');
    assert.equal(view.sockets.length, 0);
    view.close();
  }
});
test('blocked or corrupt version storage leaves readiness usable without recurring false update alerts', async () => {
  for (const storageAccess of [
    { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
    { getItem(key) { return key === versionKey ? versionA : null; }, setItem() { throw new Error('read only'); } },
  ]) {
    for (let open = 0; open < 2; open++) {
      const view = app({ storageAccess, offline: offlineResult({ ready: true, version: versionB }) });
      await settle();
      assert.equal(view.element('offline-status').textContent, 'Saved for offline use');
      assert.equal(view.element('offline-version').textContent, `Offline version: ${versionB}`);
      assert.equal(view.element('update-complete').hidden, true);
      view.close();
    }
  }
  const storage = new Map([[versionKey, '{bad history}']]);
  const view = app({ storage, offline: offlineResult({ ready: true, version: versionB }) });
  await settle();
  assert.equal(view.element('update-complete').hidden, true);
  assert.equal(storage.get(versionKey), versionB);
  view.close();
});
test('waiting updates at startup and after installation remain separate from the verified active version', async () => {
  const reg = registration();
  reg.waiting = Object.assign(new Events(), { state: 'installed' });
  const view = app({ offline: offlineResult({ ready: true, version: versionA }, reg) });
  await settle();
  assert.equal(view.element('update-waiting').hidden, false);
  assert.match(view.element('update-waiting').textContent, /Update downloaded/);
  assert.match(view.element('update-waiting').textContent, /Close all MixMate windows\/tabs/);
  assert.equal(view.element('offline-version').textContent, `Offline version: ${versionA}`);
  assert.equal(view.element('update-complete').hidden, true);
  reg.waiting.state = 'redundant'; reg.waiting.emit('statechange'); reg.waiting = null;
  assert.equal(view.element('update-waiting').hidden, true);
  reg.installing = Object.assign(new Events(), { state: 'installing' }); reg.emit('updatefound');
  assert.equal(view.element('update-waiting').hidden, true);
  const next = reg.installing;
  next.state = 'installed'; next.emit('statechange');
  assert.equal(view.element('update-waiting').hidden, true); // Not waiting yet.
  reg.waiting = next; reg.installing = null; next.emit('statechange');
  assert.equal(view.element('update-waiting').hidden, false);
  assert.equal(view.element('offline-version').textContent, `Offline version: ${versionA}`);
  assert.equal(view.element('update-complete').hidden, true);
  assert.equal(view.sockets.length, 0);
  view.close();
});
test('failed workers and superseded registrations cannot announce downloaded or activated updates', async () => {
  const storage = new Map([[versionKey, versionA]]), attempts = [], registrations = [registration(), registration()];
  const view = app({ storage, offline: options => { options.onRegistration?.(registrations[attempts.length]); return new Promise(resolve => attempts.push(resolve)); } });
  const failed = Object.assign(new Events(), { state: 'installing' });
  registrations[0].installing = failed; registrations[0].emit('updatefound');
  failed.state = 'redundant'; failed.emit('statechange');
  assert.equal(view.element('update-waiting').hidden, true);
  view.serviceWorker.emit('controllerchange');
  assert.equal(registrations[0].handlers.get('updatefound').length, 0);
  assert.equal(failed.handlers.get('statechange').length, 0);
  registrations[0].waiting = Object.assign(new Events(), { state: 'installed' }); registrations[0].emit('updatefound');
  assert.equal(view.element('update-waiting').hidden, true);
  attempts[1]({ ready: true, version: versionA }); await settle();
  attempts[0]({ ready: true, version: versionB }); await settle();
  assert.equal(storage.get(versionKey), versionA);
  assert.equal(view.element('offline-version').textContent, `Offline version: ${versionA}`);
  assert.equal(view.element('update-complete').hidden, true);
  assert.equal(view.element('update-waiting').hidden, true);
  assert.equal(view.sockets.length, 0);
  view.close();
});


test('waiting and verified update notices never reload, activate a worker or interrupt a live fake mixer', async () => {
  let version = versionA;
  const reg = registration(), view = app({ offline: async options => { options.onRegistration(reg); return { ready: true, version }; } });
  await settle();
  view.element('connect-form').emit('submit');
  const socket = view.sockets[0]; socket.open();
  socket.receive('3:::SETD^i.0.mix^0.4\nSETD^i.0.stereoIndex^-1');
  reg.waiting = Object.assign(new Events(), { state: 'installed' }); reg.emit('updatefound');
  assert.equal(view.element('update-waiting').hidden, false);
  assert.equal(view.element('offline-version').textContent, `Offline version: ${versionA}`);
  assert.equal(socket.readyState, 1);
  // Simulate browser activation after another client's lifecycle event. MixMate
  // only observes controllerchange; it never requests activation or a reload.
  reg.waiting.state = 'activated'; reg.waiting = null;
  version = versionB; view.serviceWorker.emit('controllerchange'); await settle();
  assert.equal(view.element('update-waiting').hidden, true);
  assert.equal(view.element('update-complete').hidden, false);
  assert.equal(view.element('offline-version').textContent, `Offline version: ${versionB}`);
  assert.equal(socket.readyState, 1);
  assert.equal(view.sockets.length, 1);
  assert.deepEqual(socket.sent, [OUTBOUND.init]);
  view.close();
});


function rigFixture() {
  return { version: 1, selectedProfileId: 'first-rig', preferences: { orientation: 'portrait', showMeters: false }, profiles: [
    { id: 'first-rig', name: 'Rehearsal', address: '192.168.0.60', groups: [], navigation: { mixId: null, view: 'groups', expandedGroupId: null } },
    { id: 'second-rig', name: 'Venue', address: '192.168.1.60', groups: [], navigation: { mixId: null, view: 'groups', expandedGroupId: null } },
  ] };
}
async function seedRigs(factory, settings = rigFixture()) {
  const repository = new SettingsRepository({ indexedDB: factory });
  await repository.replace(settings); await repository.close();
}

test('rig UI migrates only a validated legacy address durably, reopens and never auto-connects', async () => {
  const factory = new IDBFactory(), storage = new Map([['mixmate-address', '192.168.1.60']]);
  const view = app({ indexedDB: factory, storage });
  assert.equal(view.element('address').value, '192.168.0.60'); // Legacy resolves after durable-record detection.
  assert.match(view.element('settings-status').textContent, /Checking/);
  await view.settingsReady();
  const saved = view.repository().snapshot();
  assert.equal(saved.settings.profiles.length, 1);
  assert.equal(saved.settings.profiles[0].address, '192.168.1.60');
  assert.deepEqual(saved.settings.profiles[0].groups, []);
  assert.equal(saved.status.state, 'saved');
  assert.equal(storage.has('mixmate-address'), false);
  const id = saved.settings.profiles[0].id;
  assert.equal(view.element('rig-profile').value, id);
  assert.equal(view.sockets.length, 0);
  await view.close();
  const reopened = app({ indexedDB: factory, storage }); await reopened.settingsReady();
  assert.equal(reopened.element('rig-profile').value, id);
  assert.equal(reopened.element('address').value, '192.168.1.60');
  assert.equal(reopened.sockets.length, 0);
  await reopened.close();
  for (const invalid of ['8.8.8.8', '192.168.00.60', 'ws://192.168.0.60']) {
    const blocked = app({ storage: new Map([['mixmate-address', invalid]]) }); await blocked.settingsReady();
    assert.equal(blocked.element('address').value, '192.168.0.60');
    assert.match(blocked.element('settings-status').textContent, /temporary/);
    await blocked.close();
  }
});

test('rig create/rename/delete and display preferences persist stable IDs, inert names and duplicate addresses', async () => {
  const factory = new IDBFactory(), view = app({ indexedDB: factory }); await view.settingsReady();
  const initialID = view.element('rig-profile').value;
  view.element('rig-name').value = '<img src=x> Rehearsal'; view.element('rig-name').emit('input');
  view.element('save-rig').emit('click'); await view.settingsIdle();
  assert.equal(view.element('rig-profile').value, initialID);
  assert.equal(view.element('rig-profile').options[0].textContent, '<img src=x> Rehearsal');
  assert.equal(view.element('rig-profile').options[0].innerHTML, undefined);
  view.element('new-rig').emit('click');
  view.element('rig-name').value = 'Venue'; view.element('rig-name').emit('input');
  view.element('address').value = '192.168.0.60'; view.element('address').emit('input');
  view.element('save-rig').emit('click'); await view.settingsIdle();
  const secondID = view.element('rig-profile').value;
  assert.notEqual(secondID, initialID);
  assert.equal(view.repository().snapshot().settings.profiles.length, 2);
  view.element('preferred-orientation').value = 'landscape'; view.element('preferred-orientation').emit('change');
  view.element('show-meters').checked = false; view.element('show-meters').emit('change'); await view.settingsIdle();
  assert.deepEqual(view.repository().snapshot().settings.preferences, { orientation: 'landscape', showMeters: false });
  view.element('delete-rig').emit('click'); await view.settingsIdle();
  assert.equal(view.element('rig-profile').value, initialID);
  assert.equal(view.repository().snapshot().settings.profiles.length, 1);
  assert.equal(view.sockets.length, 0);
  await view.close();
  const reopened = app({ indexedDB: factory }); await reopened.settingsReady();
  assert.equal(reopened.element('rig-profile').value, initialID);
  assert.equal(reopened.element('preferred-orientation').value, 'landscape');
  assert.equal(reopened.element('show-meters').checked, false);
  await reopened.close();
});

test('profile selection and address changes synchronously disarm and clear an armed fake mixer without writes', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  const view = app({ indexedDB: factory }); await view.settingsReady();
  view.element('connect-form').emit('submit'); const first = view.sockets[0]; first.open();
  first.receive('3:::SETD^i.0.mix^0.5\nSETD^i.0.stereoIndex^-1');
  view.element('enable-fader').checked = true; view.element('enable-fader').emit('change');
  view.element('rig-name').value = 'Renamed while live'; view.element('rig-name').emit('input'); view.element('save-rig').emit('click');
  await view.settingsIdle();
  assert.equal(first.readyState, 1);
  assert.equal(view.element('enable-fader').checked, true);
  view.element('rig-profile').value = 'second-rig'; view.element('rig-profile').emit('change');
  assert.equal(first.readyState, 3);
  assert.equal(view.element('enable-fader').checked, false);
  assert.equal(view.element('fader').textContent, '—');
  assert.equal(view.element('address').value, '192.168.1.60');
  assert.equal(view.sockets.length, 1);
  await view.settingsIdle();
  view.element('connect-form').emit('submit'); const second = view.sockets[1]; second.open();
  second.receive('3:::SETD^i.0.mix^0.5\nSETD^i.0.stereoIndex^-1');
  view.element('enable-fader').checked = true; view.element('enable-fader').emit('change');
  view.element('address').value = '10.0.0.60'; view.element('address').emit('input');
  assert.equal(second.readyState, 3);
  assert.equal(view.element('enable-fader').checked, false);
  assert.equal(view.element('address').disabled, false);
  assert.equal(view.element('fader').textContent, '—');
  assert.deepEqual(first.sent, [OUTBOUND.init]); assert.deepEqual(second.sent, [OUTBOUND.init]);
  await view.close();
});

test('blocked settings storage remains visibly temporary and preserves the legacy source', async () => {
  const storage = new Map([['mixmate-address', '192.168.1.60']]), view = app({ storage }); await view.settingsReady();
  assert.match(view.element('settings-status').textContent, /temporary.*lost/);
  assert.equal(storage.get('mixmate-address'), '192.168.1.60');
  view.element('rig-name').value = 'Temporary rig'; view.element('save-rig').emit('click'); await view.settingsIdle();
  assert.equal(view.repository().snapshot().settings.profiles[0].name, 'Temporary rig');
  assert.match(view.element('settings-status').textContent, /temporary/);
  assert.ok(!view.element('settings-status').textContent.includes('saved on this device'));
  assert.equal(storage.get('mixmate-address'), '192.168.1.60');
  await view.close();
});

test('late settings load cannot retarget a user-entered live address', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  class DelayedRepository extends SettingsRepository { initialize() { return super.initialize().then(result => gate.then(() => result)); } }
  const repo = new DelayedRepository({ indexedDB: factory }), view = app({ repository: repo });
  view.element('address').value = '10.20.30.40'; view.element('address').emit('input');
  view.element('connect-form').emit('submit'); const socket = view.sockets[0]; socket.open();
  release(); await view.settingsReady();
  assert.equal(view.element('address').value, '10.20.30.40');
  assert.equal(view.element('rig-profile').value, '');
  assert.match(view.element('rig-feedback').textContent, /Temporary/);
  assert.equal(socket.url, 'ws://10.20.30.40/');
  assert.equal(socket.readyState, 1); assert.equal(view.sockets.length, 1);
  assert.equal(view.element('address').disabled, true);
  await view.close();
});

test('delayed profile save completion cannot overwrite a newer address draft or connection', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  class DelayedRepository extends SettingsRepository { update(updater) { return gate.then(() => super.update(updater)); } }
  const repo = new DelayedRepository({ indexedDB: factory }), view = app({ repository: repo }); await view.settingsReady();
  view.element('rig-name').value = 'Renamed'; view.element('rig-name').emit('input'); view.element('save-rig').emit('click');
  view.element('address').value = '10.0.0.70'; view.element('address').emit('input');
  view.element('connect-form').emit('submit'); const socket = view.sockets[0]; socket.open();
  release(); await view.settingsIdle();
  assert.equal(view.element('address').value, '10.0.0.70');
  assert.equal(socket.url, 'ws://10.0.0.70/'); assert.equal(socket.readyState, 1);
  assert.match(view.element('rig-feedback').textContent, /Unsaved address draft/);
  assert.equal(repo.snapshot().settings.profiles[0].address, '192.168.0.60');
  assert.deepEqual(socket.sent, [OUTBOUND.init]);
  await view.close();
});


test('display preferences preserve a new-rig draft identity and cannot overwrite the previous rig', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  const view = app({ indexedDB: factory }); await view.settingsReady();
  view.element('new-rig').emit('click');
  view.element('rig-name').value = 'New venue'; view.element('rig-name').emit('input');
  view.element('preferred-orientation').value = 'landscape'; view.element('preferred-orientation').emit('change');
  assert.equal(view.element('rig-profile').value, '');
  view.element('save-rig').emit('click'); await view.settingsIdle();
  const saved = view.repository().snapshot().settings;
  assert.equal(saved.profiles.length, 3);
  assert.equal(saved.profiles.find(profile => profile.id === 'first-rig').name, 'Rehearsal');
  assert.notEqual(view.element('rig-profile').value, 'first-rig');
  assert.equal(saved.profiles.find(profile => profile.id === view.element('rig-profile').value).name, 'New venue');
  await view.close();
});

test('late settings never infer profile identity from an already connected matching address', async () => {
  const factory = new IDBFactory(), settings = rigFixture();
  settings.profiles[1].address = settings.profiles[0].address;
  await seedRigs(factory, settings);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  class DelayedRepository extends SettingsRepository { initialize() { return super.initialize().then(result => gate.then(() => result)); } }
  const view = app({ repository: new DelayedRepository({ indexedDB: factory }) });
  view.element('connect-form').emit('submit'); view.sockets[0].open();
  release(); await view.settingsReady();
  assert.equal(view.element('address').value, '192.168.0.60');
  assert.equal(view.element('rig-profile').value, '');
  view.element('show-meters').checked = true; view.element('show-meters').emit('change'); await view.settingsIdle();
  assert.equal(view.element('rig-profile').value, '');
  assert.equal(view.sockets[0].readyState, 1);
  await view.close();
});


test('invalid rig edits and a cancelled deletion do not overwrite saved definitions', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  const view = app({ indexedDB: factory, confirmDelete: false }); await view.settingsReady();
  view.element('rig-name').value = ' '; view.element('save-rig').emit('click');
  assert.match(view.element('rig-feedback').textContent, /not saved/);
  view.element('rig-name').value = 'Valid'; view.element('address').value = '8.8.8.8'; view.element('address').emit('input');
  view.element('save-rig').emit('click');
  assert.match(view.element('rig-feedback').textContent, /not saved/);
  view.element('delete-rig').emit('click'); await view.settingsIdle();
  assert.deepEqual(view.repository().snapshot().settings, rigFixture());
  assert.equal(view.sockets.length, 0);
  await view.close();
});

test('the UI caps profiles at 32 while preserving edits to existing profiles', async () => {
  const factory = new IDBFactory(), settings = rigFixture();
  settings.profiles = Array.from({ length: 32 }, (_, i) => ({ ...settings.profiles[0], id: `rig-${i}`, name: `Rig ${i + 1}` }));
  settings.selectedProfileId = 'rig-0'; await seedRigs(factory, settings);
  const view = app({ indexedDB: factory }); await view.settingsReady();
  assert.equal(view.element('new-rig').disabled, true);
  view.element('new-rig').emit('click');
  assert.equal(view.element('rig-profile').value, 'rig-0');
  view.element('rig-name').value = 'Still editable'; view.element('save-rig').emit('click'); await view.settingsIdle();
  assert.equal(view.repository().snapshot().settings.profiles.length, 32);
  assert.equal(view.repository().snapshot().settings.profiles[0].name, 'Still editable');
  await view.close();
});

test('migration removes its durable legacy source so a later settings reset cannot revive it', async () => {
  const factory = new IDBFactory(), storage = new Map([['mixmate-address', '192.168.1.60']]);
  const view = app({ indexedDB: factory, storage }); await view.settingsReady();
  assert.equal(storage.has('mixmate-address'), false);
  await view.repository().replace(emptySettings()); await view.close();
  const reopened = app({ indexedDB: factory, storage }); await reopened.settingsReady();
  assert.equal(reopened.element('address').value, '192.168.0.60');
  assert.deepEqual(reopened.repository().snapshot().settings.profiles, []); // Deliberate empty reset stays empty.
  await reopened.close();
});

test('another window save becomes a visible temporary conflict without changing its durable profile', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  const a = app({ indexedDB: factory }), b = app({ indexedDB: factory });
  await Promise.all([a.settingsReady(), b.settingsReady()]);
  a.element('rig-name').value = 'Window A'; a.element('save-rig').emit('click'); await a.settingsIdle();
  b.element('rig-name').value = 'Window B'; b.element('save-rig').emit('click'); await b.settingsIdle();
  assert.match(b.element('settings-status').textContent, /changed in another window.*temporary/);
  assert.equal(b.repository().snapshot().settings.profiles[0].name, 'Window B');
  assert.equal(b.sockets.length, 0);
  await a.close(); await b.close();
  const reopened = app({ indexedDB: factory }); await reopened.settingsReady();
  assert.equal(reopened.element('rig-name').value, 'Window A');
  await reopened.close();
});


test('valid profile/default replacements clear a previous address custom validation error before Connect', async () => {
  for (const action of ['profile', 'new', 'delete', 'save']) {
    const factory = new IDBFactory(); await seedRigs(factory);
    const view = app({ indexedDB: factory }); await view.settingsReady();
    view.element('address').value = '8.8.8.8'; view.element('address').emit('input');
    view.element('connect-form').emit('submit');
    assert.equal(view.element('address').checkValidity(), false);
    assert.equal(view.sockets.length, 0);
    if (action === 'profile') { view.element('rig-profile').value = 'second-rig'; view.element('rig-profile').emit('change'); }
    if (action === 'new') view.element('new-rig').emit('click');
    if (action === 'delete') view.element('delete-rig').emit('click');
    if (action === 'save') { view.element('address').value = '192.168.0.60'; view.element('save-rig').emit('click'); }
    assert.equal(view.element('address').checkValidity(), true, `${action} should clear stale custom validity`);
    view.element('connect-form').emit('submit');
    assert.equal(view.sockets.length, 1);
    assert.ok(view.sockets[0].url.startsWith('ws://192.168.'));
    await view.settingsIdle(); await view.close();
  }
});

test('an untouched startup address replacement clears stale custom validity without affecting edited targets', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  class DelayedRepository extends SettingsRepository { initialize() { return super.initialize().then(result => gate.then(() => result)); } }
  const view = app({ repository: new DelayedRepository({ indexedDB: factory }) });
  view.element('address').setCustomValidity('Prior validation error');
  release(); await view.settingsReady();
  assert.equal(view.element('address').value, '192.168.0.60');
  assert.equal(view.element('address').checkValidity(), true);
  assert.equal(view.sockets.length, 0);
  await view.close();
});

function chooseBackup(view, text, options = {}) {
  view.element('import-settings-file').files = [{ size: new Blob([text]).size, text: async () => text, ...options }];
  view.element('import-settings-file').emit('change');
}
function backupFixture() {
  const data = rigFixture();
  data.profiles[0].groups = [
    { id: 'guitars', name: '<b>Guitars</b>', members: ['i.9', 'i.4', 'f.0'] },
    { id: 'keys', name: 'Keys', members: ['p.1', 'l.0', 'i.2'] },
  ];
  data.profiles[0].navigation = { mixId: 'a.2', view: 'channels', expandedGroupId: 'guitars' };
  data.profiles[1].name = '<img src=x onerror=alert(1)> Venue';
  data.selectedProfileId = 'second-rig';
  return data;
}
function armFake(view) {
  view.element('connect-form').emit('submit');
  const socket = view.sockets.at(-1); socket.open();
  socket.receive('3:::SETS^i.0.name^Desk secret name\nSETD^i.0.mix^0.5\nSETD^i.0.stereoIndex^-1');
  view.element('enable-fader').checked = true; view.element('enable-fader').emit('change');
  return socket;
}

test('export/import roundtrip preserves ordered local definitions and confirms before disconnecting or replacing', async () => {
  const factory = new IDBFactory(), data = backupFixture(); await seedRigs(factory, data);
  const view = app({ indexedDB: factory }); await view.settingsReady();
  const socket = armFake(view);
  view.element('export-settings').emit('click');
  assert.equal(view.downloads.length, 1);
  const backup = view.downloads[0];
  assert.deepEqual(parseSettingsBackup(backup), data);
  assert.ok(!backup.includes('Desk secret name'));
  assert.ok(!backup.includes('armed') && !backup.includes('mix^') && !backup.includes('channelState'));
  const replacement = backupFixture(); replacement.profiles[1].address = '10.1.2.60';
  chooseBackup(view, settingsBackupText(replacement)); await view.recoveryIdle();
  assert.equal(socket.readyState, 1); assert.equal(view.element('enable-fader').checked, true);
  assert.deepEqual(view.repository().snapshot().settings, data);
  assert.equal(view.element('settings-preview').hidden, false);
  assert.match(view.element('settings-preview-text').textContent, /2 rigs · 2 groups/);
  assert.match(view.element('settings-preview-text').textContent, /<img src=x/);
  assert.equal(view.element('settings-preview-text').innerHTML, undefined);
  view.element('confirm-settings').emit('click');
  assert.equal(socket.readyState, 3); assert.equal(view.element('enable-fader').checked, false);
  assert.equal(view.element('fader').textContent, '—');
  assert.equal(view.element('address').value, '10.1.2.60');
  assert.equal(view.element('rig-profile').value, 'second-rig');
  assert.equal(view.element('preferred-orientation').value, 'portrait');
  await view.recoveryIdle();
  assert.deepEqual(view.repository().snapshot().settings, replacement);
  assert.match(view.element('recovery-feedback').textContent, /imported and saved/);
  assert.deepEqual(socket.sent, [OUTBOUND.init]); assert.equal(view.sockets.length, 1);
  await view.close();
  const reopened = app({ indexedDB: factory }); await reopened.settingsReady();
  assert.deepEqual(reopened.repository().snapshot().settings, replacement);
  assert.equal(reopened.element('address').value, '10.1.2.60');
  assert.equal(reopened.sockets.length, 0); await reopened.close();
});

test('cancelled import/reset previews leave local settings and a live fake mixer untouched', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  const view = app({ indexedDB: factory }); await view.settingsReady(); const socket = armFake(view);
  for (const kind of ['import', 'reset']) {
    if (kind === 'import') { chooseBackup(view, settingsBackupText(backupFixture())); await view.recoveryIdle(); }
    else view.element('reset-settings').emit('click');
    view.element('cancel-settings').emit('click');
    view.element('confirm-settings').emit('click');
    assert.deepEqual(view.repository().snapshot().settings, rigFixture());
    assert.equal(view.element('settings-preview').hidden, true);
    assert.equal(socket.readyState, 1); assert.equal(view.element('enable-fader').checked, true);
    assert.match(view.element('recovery-feedback').textContent, /cancelled/);
  }
  await view.close();
});

test('invalid/unknown/newer/oversize backup files cannot change settings or produce an import preview', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  const view = app({ indexedDB: factory }); await view.settingsReady();
  const unknown = { ...rigFixture(), liveState: { 'i.0.mix': 0.5 } };
  for (const text of ['{not JSON', JSON.stringify({ ...rigFixture(), version: 9 }), JSON.stringify(unknown), JSON.stringify({ ...rigFixture(), profiles: 'bad' })]) {
    chooseBackup(view, text); await view.recoveryIdle();
    assert.equal(view.element('settings-preview').hidden, true);
    assert.match(view.element('recovery-feedback').textContent, /Nothing was changed/);
    assert.deepEqual(view.repository().snapshot().settings, rigFixture());
  }
  let reads = 0;
  chooseBackup(view, '{}', { size: MAX_SETTINGS_BYTES + 1, text: async () => { reads++; return '{}'; } });
  await view.recoveryIdle(); assert.equal(reads, 0);
  assert.match(view.element('recovery-feedback').textContent, /8 MiB/);
  chooseBackup(view, '{}', { size: 1, text: async () => ' '.repeat(MAX_SETTINGS_BYTES + 1) });
  await view.recoveryIdle(); assert.equal(view.element('settings-preview').hidden, true);
  const unicodeOversize = 'é'.repeat(MAX_SETTINGS_BYTES / 2 + 1);
  assert.throws(() => parseSettingsBackup(unicodeOversize), /8 MiB/);
  assert.equal(view.sockets.length, 0); await view.close();
});

test('late file reads cannot preview or apply after newer edits, Connect or another file selection', async () => {
  const view = app({ indexedDB: new IDBFactory() }); await view.settingsReady();
  let release;
  chooseBackup(view, '{}', { text: () => new Promise(resolve => { release = resolve; }) });
  view.element('address').value = '10.0.0.90'; view.element('address').emit('input');
  view.element('connect-form').emit('submit'); const socket = view.sockets[0]; socket.open();
  release(settingsBackupText(backupFixture())); await view.recoveryIdle();
  assert.equal(view.element('settings-preview').hidden, true);
  assert.equal(view.element('address').value, '10.0.0.90'); assert.equal(socket.readyState, 1);
  let oldRelease;
  chooseBackup(view, '{}', { text: () => new Promise(resolve => { oldRelease = resolve; }) });
  const chosen = rigFixture(); chosen.profiles[0].name = 'Newer file';
  chooseBackup(view, settingsBackupText(chosen)); await view.recoveryIdle();
  oldRelease(settingsBackupText(backupFixture())); await settle();
  assert.match(view.element('settings-preview-text').textContent, /Newer file/);
  assert.ok(!view.element('settings-preview-text').textContent.includes('<img'));
  view.element('rig-name').value = 'Fresh edit'; view.element('rig-name').emit('input');
  view.element('confirm-settings').emit('click');
  assert.equal(view.element('rig-name').value, 'Fresh edit');
  assert.equal(socket.readyState, 1); assert.equal(view.sockets.length, 1);
  await view.close();
});

test('late replacement completion cannot retarget a new draft, preferences or an explicit new connection', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  class DelayedRepository extends SettingsRepository {
    replace(value) { return super.replace(value).then(result => gate.then(() => result)); }
  }
  const view = app({ repository: new DelayedRepository({ indexedDB: factory }) }); await view.settingsReady();
  chooseBackup(view, settingsBackupText(backupFixture())); await view.recoveryIdle();
  view.element('confirm-settings').emit('click');
  view.element('new-rig').emit('click');
  view.element('rig-name').value = 'New draft'; view.element('rig-name').emit('input');
  view.element('address').value = '10.2.3.60'; view.element('address').emit('input');
  view.element('preferred-orientation').value = 'landscape'; view.element('preferred-orientation').emit('change');
  view.element('connect-form').emit('submit'); const socket = view.sockets[0]; socket.open();
  release(); await view.recoveryIdle(); await view.settingsIdle();
  assert.equal(view.element('rig-profile').value, '');
  assert.equal(view.element('rig-name').value, 'New draft');
  assert.equal(view.element('address').value, '10.2.3.60');
  assert.equal(view.element('preferred-orientation').value, 'landscape');
  assert.equal(socket.readyState, 1); assert.equal(view.sockets.length, 1);
  assert.ok(!view.element('recovery-feedback').textContent.includes('saved on this device'));
  await view.close();
});

test('temporary imports/exports/reset stay usable and never claim a durable replacement', async () => {
  const view = app(); await view.settingsReady();
  const backup = backupFixture(); chooseBackup(view, settingsBackupText(backup)); await view.recoveryIdle();
  assert.match(view.element('settings-preview-text').textContent, /temporary settings only/);
  view.element('confirm-settings').emit('click'); await view.recoveryIdle();
  assert.deepEqual(view.repository().snapshot().settings, backup);
  assert.equal(view.element('rig-profile').value, 'second-rig');
  assert.match(view.element('recovery-feedback').textContent, /applied temporarily/);
  view.element('export-settings').emit('click');
  assert.deepEqual(parseSettingsBackup(view.downloads[0]), backup);
  assert.match(view.element('recovery-feedback').textContent, /Includes temporary settings/);
  view.element('reset-settings').emit('click'); view.element('confirm-settings').emit('click'); await view.recoveryIdle();
  assert.deepEqual(view.repository().snapshot().settings, emptySettings());
  assert.match(view.element('recovery-feedback').textContent, /Temporary defaults.*not replaced/);
  assert.equal(view.element('rig-profile').value, '');
  assert.equal(view.sockets.length, 0); await view.close();
});

test('confirmed reset preserves app cache/sibling keys/offline marker and cannot resurrect an undeletable legacy address', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  const storage = new Map([['mixmate-address', '192.168.1.60'], ['mixmate-offline-version', versionA], ['sibling-app', 'keep me']]);
  const access = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: () => { throw new Error('blocked removal'); } };
  const view = app({ indexedDB: factory, storage, storageAccess: access }); await view.settingsReady();
  const socket = armFake(view);
  view.element('reset-settings').emit('click');
  assert.equal(socket.readyState, 1);
  assert.match(view.element('settings-preview-text').textContent, /other apps are kept/);
  view.element('confirm-settings').emit('click');
  assert.equal(socket.readyState, 3); assert.equal(view.element('enable-fader').checked, false);
  assert.equal(view.element('address').value, '192.168.0.60');
  await view.recoveryIdle();
  assert.deepEqual(view.repository().snapshot().settings, emptySettings());
  assert.equal(storage.get('sibling-app'), 'keep me'); assert.equal(storage.get('mixmate-offline-version'), versionA);
  assert.equal(storage.get('mixmate-address'), '192.168.1.60'); // Record-exists metadata must stop revival even if removal fails.
  assert.deepEqual(view.cacheOperations, []);
  await view.close();
  const reopened = app({ indexedDB: factory, storage, storageAccess: access }); await reopened.settingsReady();
  assert.deepEqual(reopened.repository().snapshot().settings, emptySettings());
  assert.equal(reopened.element('address').value, '192.168.0.60');
  assert.equal(reopened.element('rig-profile').value, '');
  assert.equal(reopened.sockets.length, 0); await reopened.close();
});

test('cross-window imports preserve the newer durable record and expose the local imported draft as temporary', async () => {
  const factory = new IDBFactory(); await seedRigs(factory);
  const a = app({ indexedDB: factory }), b = app({ indexedDB: factory });
  await Promise.all([a.settingsReady(), b.settingsReady()]);
  chooseBackup(b, settingsBackupText(backupFixture())); await b.recoveryIdle();
  a.element('rig-name').value = 'New durable name'; a.element('save-rig').emit('click'); await a.settingsIdle();
  b.element('confirm-settings').emit('click'); await b.recoveryIdle();
  assert.match(b.element('settings-status').textContent, /another window.*temporary/);
  assert.match(b.element('recovery-feedback').textContent, /applied temporarily/);
  assert.deepEqual(b.repository().snapshot().settings, backupFixture());
  b.element('export-settings').emit('click'); assert.deepEqual(parseSettingsBackup(b.downloads[0]), backupFixture());
  await a.close(); await b.close();
  const reopened = app({ indexedDB: factory }); await reopened.settingsReady();
  assert.equal(reopened.element('rig-name').value, 'New durable name'); await reopened.close();
});

async function rawSettings(factory, value, version = 1) {
  const db = await new Promise((resolve, reject) => {
    const request = factory.open('mixmate-settings', version);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (value !== undefined) await new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put(value, 'current');
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  });
  const stored = await new Promise(resolve => {
    const tx = db.transaction('settings'); const request = tx.objectStore('settings').get('current'); tx.oncomplete = () => resolve(request.result);
  });
  db.close(); return stored;
}

test('corrupt/newer settings recovery applies temporary defaults only and never deletes unknown durable data', async () => {
  for (const [data, version] of [[{ ...rigFixture(), profiles: 'broken' }, 1], [{ version: 9, futureSecret: 'keep' }, 1], [rigFixture(), 2]]) {
    const factory = new IDBFactory(); await rawSettings(factory, data, version);
    factory.deleteDatabase = () => { throw new Error('Must never delete database'); };
    const view = app({ indexedDB: factory }); await view.settingsReady();
    assert.deepEqual(view.repository().snapshot().settings, emptySettings());
    view.element('reset-settings').emit('click');
    assert.match(view.element('settings-preview-text').textContent, /stored record stays untouched/);
    view.element('confirm-settings').emit('click'); await view.recoveryIdle();
    assert.match(view.element('recovery-feedback').textContent, /Temporary defaults/);
    assert.deepEqual(await rawSettings(factory, undefined, version), data);
    await view.close();
  }
});

test('storage protection is requested only by explicit action and denial/error/unavailable status remains usable', async () => {
  for (const behavior of ['denied', 'error', 'unavailable', 'granted']) {
    let calls = 0;
    const storageManager = behavior === 'unavailable' ? undefined : {
      persisted: async () => false,
      persist: async () => { calls++; if (behavior === 'error') throw new Error('Denied API'); return behavior === 'granted'; },
    };
    const view = app({ indexedDB: new IDBFactory(), storageManager }); await view.settingsReady(); await view.protectionIdle();
    assert.equal(calls, 0);
    assert.equal(view.element('export-settings').disabled, false);
    if (behavior === 'unavailable') assert.equal(view.element('protect-storage').disabled, true);
    else { view.element('protect-storage').emit('click'); await view.protectionIdle(); assert.equal(calls, 1); }
    assert.match(view.element('storage-protection-status').textContent, behavior === 'granted' ? /granted.*Clearing site data/ : /usable.*backup/);
    assert.equal(view.sockets.length, 0); await view.close();
  }
});

test('late startup protection status cannot override an explicit granted request', async () => {
  let release, calls = 0;
  const storageManager = { persisted: () => new Promise(resolve => { release = resolve; }), persist: async () => { calls++; return true; } };
  const view = app({ indexedDB: new IDBFactory(), storageManager }); await view.settingsReady();
  view.element('protect-storage').emit('click'); await settle();
  release(false); await view.protectionIdle();
  assert.match(view.element('storage-protection-status').textContent, /granted/);
  assert.equal(calls, 1); await view.close();
});


test('an imported null selection remains unbound after preferences and reload despite matching saved addresses', async () => {
  const factory = new IDBFactory(), view = app({ indexedDB: factory }); await view.settingsReady();
  const backup = backupFixture(); backup.selectedProfileId = null;
  chooseBackup(view, settingsBackupText(backup)); await view.recoveryIdle();
  view.element('confirm-settings').emit('click'); await view.recoveryIdle();
  assert.equal(view.element('rig-profile').value, '');
  view.element('preferred-orientation').value = 'landscape'; view.element('preferred-orientation').emit('change'); await view.settingsIdle();
  assert.equal(view.element('rig-profile').value, '');
  await view.close();
  const reopened = app({ indexedDB: factory }); await reopened.settingsReady();
  assert.equal(reopened.element('rig-profile').value, '');
  assert.equal(reopened.element('rig-name').value, '');
  assert.equal(reopened.repository().snapshot().settings.selectedProfileId, null);
  assert.equal(reopened.sockets.length, 0); await reopened.close();
});
