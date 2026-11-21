import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateManager, updateBusy, updatedMessage, consumeUpdateSuppress, UPDATE_APPLIED_KEY, UPDATE_NOTICE_KEY, UPDATE_SUPPRESS_KEY, READY_TEXT } from '../src/iem/updates.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { prepareEntryOffline, DEV_OFFLINE_TEXT } from '../src/iem/entry-offline.js';

class Events {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, [...(this.handlers.get(type) || []), fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(value => value !== fn)); }
  emit(type) { for (const fn of this.handlers.get(type) || []) fn(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const fakeTimers = () => {
  const jobs = new Map(); let id = 0;
  return { setTimeout(fn) { jobs.set(++id, fn); return id; }, clearTimeout(handle) { jobs.delete(handle); }, fire() { const all = [...jobs.values()]; jobs.clear(); all.forEach(fn => fn()); }, pending: () => jobs.size };
};
const store = (data = new Map()) => ({ data, getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) });
const NEW = 'b'.repeat(16);
const entryDocument = { baseURI: 'https://example.test/mixmate/', querySelector: () => ({ content: 'a'.repeat(64) }), querySelectorAll: () => [] };

function setup({ storage = store(), version = NEW, workerReplies = true, now = () => 1000, carry = () => false } = {}) {
  const serviceWorker = Object.assign(new Events(), { controller: {} }), window = new Events(), document = Object.assign(new Events(), { visibilityState: 'visible' });
  const reloads = [], states = [], timers = fakeTimers(), state = { busy: false };
  const worker = { sent: [], postMessage(message, [port]) { this.sent.push(message); if (workerReplies) port.postMessage({ applied: message.previous !== version, version }); } };
  const registration = { updates: 0, update() { this.updates++; return Promise.resolve(); }, waiting: worker, active: {} };
  const manager = createUpdateManager({ serviceWorker, window, document, storage, busy: () => state.busy, carry, reload: () => reloads.push(1), onState: value => states.push(value), timers, now });
  return { serviceWorker, window, document, reloads, states, timers, state, worker, registration, manager, storage };
}
async function applyNow(t) { t.manager.attach(t.registration); t.manager.waiting(true); await tick(); }

test('an update found while disconnected sends APPLY_UPDATE and reloads exactly once on controllerchange', async () => {
  const t = setup(); await applyNow(t);
  assert.equal(t.worker.sent.length, 1); assert.equal(t.worker.sent[0].type, 'APPLY_UPDATE');
  assert.equal(t.storage.data.get(UPDATE_APPLIED_KEY), NEW); assert.equal(t.reloads.length, 0);
  t.serviceWorker.emit('controllerchange'); t.serviceWorker.emit('controllerchange');
  assert.equal(t.reloads.length, 1); assert.equal(t.storage.data.get(UPDATE_NOTICE_KEY), '1');
  t.manager.waiting(true); await tick(); assert.equal(t.worker.sent.length, 1); // no second apply
  t.manager.destroy();
});

test('the post-update message is available exactly once after the reload and names version and commit', () => {
  const storage = store(new Map([[UPDATE_NOTICE_KEY, '1']])), t = setup({ storage });
  assert.equal(t.manager.consumeNotice(), true); assert.equal(t.manager.consumeNotice(), false);
  assert.equal(updatedMessage({ version: '0.6.1', commit: 'abc1234' }), 'Updated to v0.6.1 (abc1234).');
  t.manager.destroy();
});

test('a first install claiming the page is not treated as an update', () => {
  const t = setup(); t.manager.destroy(); t.serviceWorker.controller = null;
  const fresh = createUpdateManager({ serviceWorker: t.serviceWorker, window: t.window, document: t.document, storage: store(), busy: () => false, reload: () => t.reloads.push(1), timers: t.timers });
  t.serviceWorker.emit('controllerchange'); assert.equal(t.reloads.length, 0); fresh.destroy();
});

const busyCases = {
  'qualified live session': { snapshot: { phase: 'live', qualified: true } },
  'connected but unqualified session': { snapshot: { phase: 'connected' } },
  'partial session': { snapshot: { phase: 'partial' } },
  'active gesture': { snapshot: { phase: 'idle', control: { gestureActive: true } } },
  'pending send': { snapshot: { phase: 'idle', control: { pending: true } } },
  'snapshot operation at the desk': { snapshot: { phase: 'idle', snapshots: { operation: { status: 'pending' } } } },
  'snapshot operation tracked by the UI': { snapshot: { phase: 'idle' }, tracked: true },
  'open dialog': { snapshot: { phase: 'idle' }, dialog: 'diagnostics' },
};
for (const [name, condition] of Object.entries(busyCases)) {
  test(`an update found with ${name} is deferred, announced once, then applied when it clears`, async () => {
    const dialogOwner = createDialogOwner(), mutable = { ...condition };
    const session = { snapshot: () => mutable.snapshot };
    const snapshotControls = { pending: () => Boolean(mutable.tracked) };
    const t = setup(); t.manager.destroy();
    const manager = createUpdateManager({ serviceWorker: t.serviceWorker, window: t.window, document: t.document, storage: t.storage, busy: () => updateBusy({ session, dialogOwner, snapshotControls }), reload: () => t.reloads.push(1), onState: value => t.states.push(value), timers: t.timers });
    const lease = mutable.dialog ? dialogOwner.claim(mutable.dialog, () => {}) : null;
    assert.equal(updateBusy({ session, dialogOwner, snapshotControls }), true);
    manager.attach(t.registration); manager.waiting(true); await tick();
    assert.equal(t.worker.sent.length, 0); assert.equal(manager.state().text, READY_TEXT);
    assert.equal(t.states.filter(value => value.announce).length, 1);
    manager.evaluate(); manager.waiting(true); assert.equal(t.states.filter(value => value.announce).length, 1);
    mutable.snapshot = { phase: 'idle' }; mutable.tracked = false; if (lease) dialogOwner.release(lease);
    manager.evaluate(); await tick();
    assert.equal(t.worker.sent.length, 1);
    t.serviceWorker.emit('controllerchange'); assert.equal(t.reloads.length, 1);
    manager.destroy();
  });
}

test('the idle Connect dialog and a still-connecting attempt do not block an update; a controllerchange while busy waits to reload', async () => {
  const dialogOwner = createDialogOwner(), snap = { phase: 'connecting' }, session = { snapshot: () => snap };
  dialogOwner.claim('connection', () => {});
  assert.equal(updateBusy({ session, dialogOwner }), false);
  const t = setup(); await applyNow(t);
  t.state.busy = true; t.serviceWorker.emit('controllerchange'); assert.equal(t.reloads.length, 0); // another tab applied it, or a session began meanwhile
  t.state.busy = false; t.manager.evaluate(); assert.equal(t.reloads.length, 1); t.manager.destroy();
});

test('no reload loop: the same worker version is not applied twice in a session and the reload backstop holds', async () => {
  const storage = store(new Map([[UPDATE_APPLIED_KEY, NEW]])), t = setup({ storage });
  await applyNow(t);
  assert.equal(t.reloads.length, 0); assert.equal(t.manager.state().phase, 'manual'); assert.match(t.manager.state().text, /Close all MixMate windows/);
  t.manager.destroy();
  const clock = 5000, first = setup({ now: () => clock }); await applyNow(first);
  first.serviceWorker.emit('controllerchange'); assert.equal(first.reloads.length, 1);
  const second = setup({ storage: first.storage, now: () => clock + 1000, version: 'c'.repeat(16) }); second.manager.attach(second.registration); second.serviceWorker.emit('controllerchange');
  assert.equal(second.reloads.length, 0); assert.equal(second.manager.state().phase, 'manual');
  first.manager.destroy(); second.manager.destroy();
});

test('without working session storage nothing reloads automatically (loop guard cannot be kept)', async () => {
  const denied = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
  const t = setup({ storage: denied }); await applyNow(t);
  assert.equal(t.worker.sent.length, 0); assert.equal(t.reloads.length, 0); assert.equal(t.manager.state().phase, 'manual'); t.manager.destroy();
});

test('a silent worker or missing controllerchange falls back to manual without reloading', async () => {
  const t = setup({ workerReplies: false }); await applyNow(t);
  t.timers.fire(); assert.equal(t.manager.state().phase, 'manual'); assert.equal(t.reloads.length, 0); t.manager.destroy();
  const u = setup(); await applyNow(u); u.timers.fire(); assert.equal(u.manager.state().phase, 'manual'); assert.equal(u.reloads.length, 0);
  u.serviceWorker.emit('controllerchange'); assert.equal(u.reloads.length, 0); // manual stays manual: no surprise reload
  u.manager.destroy();
});

test('registration.update() runs on open, online and return to visible only', async () => {
  const t = setup(); t.manager.attach(t.registration); assert.equal(t.registration.updates, 1);
  t.manager.attach(t.registration); assert.equal(t.registration.updates, 1);
  t.window.emit('online'); assert.equal(t.registration.updates, 2);
  t.document.visibilityState = 'hidden'; t.document.emit('visibilitychange'); assert.equal(t.registration.updates, 2);
  t.document.visibilityState = 'visible'; t.document.emit('visibilitychange'); assert.equal(t.registration.updates, 3);
  t.registration.update = () => Promise.reject(Error('offline')); t.window.emit('online'); await tick(); // offline failure is swallowed
  t.manager.destroy(); t.window.emit('online'); assert.equal(t.registration.updates, 3);
});

test('a failed install (redundant worker) is never applied and the old copy keeps serving', async () => {
  const worker = Object.assign(new Events(), { state: 'installing', sent: [], postMessage(message) { this.sent.push(message); } });
  const registration = Object.assign(new Events(), { active: {}, installing: worker, waiting: null, update() { return Promise.resolve(); } });
  const t = setup(), element = {};
  const entry = prepareEntryOffline(element, { navigator: { serviceWorker: t.serviceWorker }, document: entryDocument, storage: store(), updates: t.manager,
    verify: async options => { options.onRegistration(registration); return { ready: true, version: 'a'.repeat(16) }; } });
  await entry.whenIdle();
  worker.state = 'redundant'; registration.installing = null; worker.emit('statechange'); await tick();
  assert.equal(worker.sent.length, 0); assert.equal(t.reloads.length, 0); assert.ok(!element.textContent.includes('Update ready')); assert.ok(element.textContent.includes('Offline ready'));
  entry.destroy(); t.manager.destroy();
});

test('a successfully installed worker reaches the manager through the entry and shows Update ready while busy', async () => {
  const worker = Object.assign(new Events(), { state: 'installed', sent: [], postMessage(message) { this.sent.push(message); } });
  const registration = Object.assign(new Events(), { active: {}, waiting: worker, update() { return Promise.resolve(); } });
  const t = setup(), element = {}; t.state.busy = true;
  const entry = prepareEntryOffline(element, { navigator: { serviceWorker: t.serviceWorker }, document: entryDocument, storage: store(), updates: t.manager,
    verify: async options => { options.onRegistration(registration); return { ready: true, version: 'a'.repeat(16) }; } });
  await entry.whenIdle();
  assert.ok(element.textContent.includes('Update ready')); assert.equal(worker.sent.length, 0); assert.equal(t.manager.state().text, READY_TEXT);
  entry.destroy(); t.manager.destroy();
});

test('dev server: no registration is attempted and the confusing error is replaced by a clear message', async () => {
  let called = false; const element = {};
  const entry = prepareEntryOffline(element, { navigator: { serviceWorker: new Events() }, document: { baseURI: 'http://127.0.0.1:5173/' }, storage: store(), dev: true, verify: async () => { called = true; } });
  await entry.whenIdle();
  assert.equal(called, false); assert.ok(element.textContent.includes(DEV_OFFLINE_TEXT)); assert.ok(!/ServiceWorker|MIME/.test(element.textContent));
  assert.equal(DEV_OFFLINE_TEXT, "Offline copy isn't available on the dev server (use npm run build + npm run preview)");
  entry.destroy();
  // A production build still shows an accurate registration error.
  const prod = {}, real = prepareEntryOffline(prod, { navigator: { serviceWorker: new Events() }, document: entryDocument, storage: store(), dev: false, verify: async () => { throw Error('Failed to register a ServiceWorker: bad MIME'); } });
  await real.whenIdle(); assert.ok(prod.textContent.includes('Failed to register a ServiceWorker')); real.destroy();
});

test('F07-S05 review: an explicit Disconnect is carried across exactly one automatic update reload', async () => {
  for (const [suppressed, expected] of [[true, '1'], [false, '0']]) {
    const t = setup({ carry: () => suppressed }); await applyNow(t); t.serviceWorker.emit('controllerchange');
    assert.equal(t.reloads.length, 1); assert.equal(t.storage.data.get(UPDATE_SUPPRESS_KEY), expected);
    assert.equal(consumeUpdateSuppress(t.storage), suppressed); assert.equal(consumeUpdateSuppress(t.storage), false); // one reload only
    t.manager.destroy();
  }
  assert.equal(consumeUpdateSuppress({ getItem() { throw Error('x'); }, removeItem() { throw Error('x'); } }), false);
});

test('F07-S05 review: an explicit Connect that is still connecting is busy; an automatic pass is not; the emitted snapshot is used without another copy', () => {
  const session = { snapshot() { throw Error('must not copy when a snapshot is given'); } }, dialogOwner = createDialogOwner();
  assert.equal(updateBusy({ session, dialogOwner, snapshot: { phase: 'connecting' }, explicitConnecting: () => true }), true);
  assert.equal(updateBusy({ session, dialogOwner, snapshot: { phase: 'connecting' }, explicitConnecting: () => false }), false);
  assert.equal(updateBusy({ session, dialogOwner, snapshot: { phase: 'live' } }), true);
  assert.equal(updateBusy({ session, dialogOwner, snapshot: { phase: 'idle' } }), false);
});

test('F07-S05 review: evaluate passes the emitted snapshot to busy()', async () => {
  const seen = [], t = setup(); t.manager.destroy();
  const manager = createUpdateManager({ serviceWorker: t.serviceWorker, window: t.window, document: t.document, storage: t.storage, busy: hint => { seen.push(hint); return true; }, reload() {}, timers: t.timers });
  manager.attach(t.registration); manager.waiting(true); manager.evaluate({ phase: 'live' });
  assert.deepEqual(seen.at(-1), { phase: 'live' }); manager.destroy();
});
