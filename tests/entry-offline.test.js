import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_VERSION } from '../src/app-version.js';
import { prepareEntryOffline } from '../src/iem/entry-offline.js';
const A = '1111111111111111', B = '2222222222222222', key = 'mixmate-offline-version';
class Events {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, [...(this.handlers.get(type) || []), fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(value => value !== fn)); }
  emit(type) { for (const fn of this.handlers.get(type) || []) fn(); }
}
const document = { baseURI: 'https://example.test/mixmate/', querySelector: () => ({ content: 'a'.repeat(64) }), querySelectorAll: () => [] };
function fixture({ data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }, verify = async () => ({ ready: true, version: A }) } = {}) {
  const element = {}, serviceWorker = new Events();
  const entry = prepareEntryOffline(element, { navigator: { serviceWorker }, document, storage, verify });
  return { entry, element, serviceWorker, data };
}

test('IEM first observation seeds history silently and same-version reopen shows bundled version without Updated', async () => {
  const data = new Map();
  for (let n = 0; n < 2; n++) {
    const { entry, element } = fixture({ data }); await entry.whenIdle();
    assert.equal(data.get(key), A); assert.equal(element.textContent, `v${APP_VERSION} · Offline ready · ${A}`);
    assert.ok(!element.textContent.includes('Updated')); entry.destroy();
  }
});

test('IEM announces a changed verified version once per open and keeps the optional shared marker', async () => {
  const data = new Map([[key, A]]);
  const { entry, element, serviceWorker } = fixture({ data, verify: async () => ({ ready: true, version: B }) }); await entry.whenIdle();
  assert.equal(element.textContent, `v${APP_VERSION} · Updated · ${B}`); assert.equal(data.get(key), B);
  serviceWorker.emit('controllerchange'); await entry.whenIdle(); assert.ok(element.textContent.includes('Updated'));
  entry.destroy();
  const reopened = fixture({ data, verify: async () => ({ ready: true, version: B }) }); await reopened.entry.whenIdle();
  assert.ok(!reopened.element.textContent.includes('Updated')); reopened.entry.destroy();
});

test('unverified/invalid/error and superseded IEM results never advance version history', async () => {
  for (const verify of [async () => ({ ready: false, version: B }), async () => ({ ready: true, version: '<bad>' }), async () => { throw Error('not verified'); }]) {
    const data = new Map([[key, A]]), { entry, element } = fixture({ data, verify }); await entry.whenIdle();
    assert.equal(data.get(key), A); assert.ok(!element.textContent.includes('Updated')); entry.destroy();
  }
  const resolvers = [], data = new Map([[key, A]]);
  const { entry, element, serviceWorker } = fixture({ data, verify: () => new Promise(resolve => resolvers.push(resolve)) });
  serviceWorker.emit('controllerchange'); resolvers[1]({ ready: true, version: A }); await entry.whenIdle();
  resolvers[0]({ ready: true, version: B }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(data.get(key), A); assert.ok(!element.textContent.includes('Updated')); entry.destroy();
});

test('denied/read-only/corrupt optional history never breaks verified readiness or produces recurring false updates', async () => {
  for (const storage of [null, { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } }, { getItem() { return A; }, setItem() { throw Error('read only'); } }]) {
    const { entry, element } = fixture({ storage, verify: async () => ({ ready: true, version: B }) }); await entry.whenIdle();
    assert.ok(element.textContent.includes('Offline ready')); assert.ok(!element.textContent.includes('Updated')); entry.destroy();
  }
  const data = new Map([[key, 'corrupt']]), { entry, element } = fixture({ data }); await entry.whenIdle();
  assert.equal(data.get(key), A); assert.ok(!element.textContent.includes('Updated')); entry.destroy();
});

test('waiting update stays separate from readiness; observing it cannot activate/reload or connect', async () => {
  const registration = Object.assign(new Events(), { active: {}, waiting: Object.assign(new Events(), { state: 'installed' }) });
  const { entry, element } = fixture({ verify: async options => { options.onRegistration(registration); return { ready: true, version: A }; } }); await entry.whenIdle();
  assert.ok(element.textContent.includes('Offline ready') && element.textContent.includes('Update waiting'));
  assert.match(element.title, /Close all MixMate windows/);
  assert.equal(typeof registration.waiting.postMessage, 'undefined');
  entry.destroy(); assert.equal(registration.handlers.get('updatefound').length, 0);
});
