import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyOfflineCopy, currentEntryRequirements } from '../src/offline.js';

class FakeChannel {
  static instances = [];
  constructor() {
    this.port1 = { closed: false, close() { this.closed = true; } };
    this.port2 = { closed: false, close() { this.closed = true; }, deliver: data => this.port1.onmessage?.({ data }) };
    FakeChannel.instances.push(this);
  }
}
function setup({ register, ready = Promise.resolve(), controller } = {}) {
  const calls = [];
  const serviceWorker = {
    register: register || (async (...args) => { calls.push(args); }), ready,
    controller: controller === undefined ? { postMessage(message, ports) { assert.equal(message.type, 'VERIFY_OFFLINE'); ports[0].deliver({ ready: true, version: 'test' }); } } : controller,
  };
  return { calls, serviceWorker, options: { serviceWorker, baseURI: 'https://example.test/mixmate/', MessageChannelClass: FakeChannel, timeoutMs: 10 } };
}
test('offline preparation uses relative worker/scope and requires explicit verified response', async () => {
  const { calls, options } = setup();
  assert.deepEqual(await verifyOfflineCopy(options), { ready: true, version: 'test' });
  assert.equal(calls[0][0].href, 'https://example.test/mixmate/sw.js');
  assert.deepEqual(calls[0][1], { scope: './' });
  assert.equal(FakeChannel.instances.at(-1).port1.closed, true);
  assert.equal(FakeChannel.instances.at(-1).port2.closed, true);
});
test('registration and activation stalls share the same finite preparation deadline', async () => {
  for (const setupOptions of [{ register: () => new Promise(() => {}) }, { ready: new Promise(() => {}) }]) {
    const { options } = setup(setupOptions);
    await assert.rejects(verifyOfflineCopy(options), /timed out/);
  }
});
test('a late ready promise cannot initiate verification after the preparation deadline', async () => {
  let finishReady, messages = 0;
  const { options } = setup({ ready: new Promise(resolve => { finishReady = resolve; }), controller: { postMessage() { messages++; } } });
  await assert.rejects(verifyOfflineCopy(options), /timed out/);
  finishReady();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(messages, 0);
});
test('a stalled cache verification times out and closes both message ports', async () => {
  const { options } = setup({ controller: { postMessage() {} } });
  await assert.rejects(verifyOfflineCopy(options), /timed out/);
  assert.equal(FakeChannel.instances.at(-1).port1.closed, true);
  assert.equal(FakeChannel.instances.at(-1).port2.closed, true);
});
test('missing controller, registration failure and malformed response cannot become offline ready', async () => {
  await assert.rejects(verifyOfflineCopy(setup({ controller: null }).options), /worker is starting/);
  await assert.rejects(verifyOfflineCopy(setup({ register: async () => { throw new Error('Registration blocked'); } }).options), /Registration blocked/);
  await assert.rejects(verifyOfflineCopy(setup({ controller: { postMessage(_, ports) { ports[0].deliver({ ready: 'yes' }); } } }).options), /Invalid/);
  const failed = setup({ controller: { postMessage(_, ports) { ports[0].deliver({ ready: false }); } } });
  assert.deepEqual(await verifyOfflineCopy(failed.options), { ready: false });
});


test('registration observation happens within the deadline and late registration is ignored', async () => {
  const registration = { waiting: null }, observed = [];
  const success = setup({ register: async () => registration });
  await verifyOfflineCopy({ ...success.options, onRegistration: value => observed.push(value) });
  assert.deepEqual(observed, [registration]);
  let resolveRegistration;
  const late = setup({ register: () => new Promise(resolve => { resolveRegistration = resolve; }) });
  await assert.rejects(verifyOfflineCopy({ ...late.options, onRegistration: value => observed.push(value) }), /timed out/);
  resolveRegistration(registration); await new Promise(resolve => setImmediate(resolve));
  assert.equal(observed.length, 1);
});


test('legacy or mismatched ready replies cannot certify the currently loaded entry assets', async () => {
  const required = { entry: 'https://example.test/mixmate/iem.html', token: 'a'.repeat(64), assets: ['https://example.test/mixmate/iem.html', 'https://example.test/mixmate/assets/iem-hash.js'] };
  for (const proof of [undefined, { ...required, token: 'b'.repeat(64) }, { ...required, assets: [required.entry] }]) {
    const { options } = setup({ controller: { postMessage(message, ports) { assert.deepEqual(message.required, required); ports[0].deliver({ ready: true, version: 'old', ...(proof ? { proof } : {}) }); } } });
    await assert.rejects(verifyOfflineCopy({ ...options, required }), /does not verify the current page/);
  }
  const { options } = setup({ controller: { postMessage(message, ports) { ports[0].deliver({ ready: true, version: 'new', proof: message.required }); } } });
  assert.equal((await verifyOfflineCopy({ ...options, required })).ready, true);
});

test('current entry requirements include actual module/CSS URLs and normalize known entry query/hash', () => {
  const document = {
    baseURI: 'https://example.test/mixmate/iem.html?rig=local#mix',
    querySelector() { return { content: 'a'.repeat(64) }; },
    querySelectorAll() { return [{ tagName: 'SCRIPT', getAttribute: () => './assets/iem-new.js' }, { tagName: 'LINK', getAttribute: () => './assets/iem-new.css' }]; },
  };
  const required = currentEntryRequirements(document);
  assert.equal(required.entry, 'https://example.test/mixmate/iem.html');
  assert.equal(required.token, 'a'.repeat(64));
  assert.ok(required.assets.includes('https://example.test/mixmate/assets/iem-new.js'));
  assert.ok(required.assets.includes('https://example.test/mixmate/assets/iem-new.css'));
  assert.ok(required.assets.includes('https://example.test/mixmate/demo.html'));
});
