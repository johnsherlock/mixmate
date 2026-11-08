import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { MixerConnection, OUTBOUND } from '../src/protocol.js';
import { FaderIntent } from '../src/fader-intent.js';
import { faderValueToDB } from 'soundcraft-ui-connection';

// Execute the actual app entry against a minimal DOM and fake socket. There is
// no network-capable WebSocket or fetch in this context.
const source = (await readFile(new URL('../src/main.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
class Events {
  handlers = new Map();
  addEventListener(type, callback) { this.handlers.set(type, [...(this.handlers.get(type) || []), callback]); }
  emit(type) { for (const callback of this.handlers.get(type) || []) callback({ preventDefault() {} }); }
}
class Element extends Events {
  value = ''; checked = false; disabled = false; hidden = false;
  textContent = ''; dataset = {}; style = {}; attributes = {}; options = [];
  add(option) { this.options.push(option); if (!this.value) this.value = String(option.value); }
  setAttribute(name, value) { this.attributes[name] = value; }
  setCustomValidity(value) { this.validity = value; }
  reportValidity() {}
}
function app({ offline } = {}) {
  const elements = new Map(), sockets = [], storage = new Map(), intervals = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  element('address').value = '192.168.0.60';
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(message) { this.sent.push(message); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data) { this.onmessage?.({ data }); }
    close() { this.readyState = 3; }
  }
  let client;
  class FakeConnection extends MixerConnection {
    constructor(options) { super({ ...options, WebSocketClass: FakeSocket }); client = this; }
  }
  const document = Object.assign(new Events(), { hidden: false, baseURI: 'https://example.test/mixmate/', getElementById: element, querySelector: element });
  const window = Object.assign(new Events(), { isSecureContext: true });
  const navigator = { userAgent: 'fake browser', ...(offline ? { serviceWorker: new Events() } : {}) };
  vm.runInNewContext(source, {
    document, window, navigator, location: { origin: 'https://example.test' },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    Option: function(text, value) { this.textContent = text; this.value = String(value); },
    MixerConnection: FakeConnection, FaderIntent, faderValueToDB, verifyOfflineCopy: offline,
    setInterval: (callback, delay) => { const key = intervals.size; intervals.set(key, { callback, delay }); return key; },
    clearTimeout, setTimeout, URL, requestAnimationFrame: callback => callback(),
  });
  return { document, window, serviceWorker: navigator.serviceWorker, element, sockets, storage, intervals, close: () => client.disconnect() };
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
    assert.deepEqual([...view.storage.keys()], ['mixmate-address']);
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
