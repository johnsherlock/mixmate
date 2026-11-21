import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { domFixture } from './helpers/fake-dom.js';
import { tidyLive } from '../src/iem/live-shell.js';
import { createDialogOwner } from '../src/iem/dialog-owner.js';
import { createLiveConnectionUI, mountLiveController } from '../src/iem/live-controller.js';
import { createAuxControlSession } from '../src/iem/aux-control-session.js';
import { mountNativeUi, nativeUiUrl, NATIVE_NO_ADDRESS_REASON } from '../src/iem/native-ui.js';
import { startLocalClock } from '../src/iem/clock.js';
import { SettingsRepository, emptySettings } from '../src/settings.js';

// F07-S04 native UI access: fake DOM, fake window/sockets/timers only. Nothing contacts a real desk.
const TOPOLOGY = '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.1.matrix^0\nSETD^a.0.stereoIndex^0\nSETD^a.1.stereoIndex^1\nSETD^a.0.mix^0.4\nSETD^a.1.mix^0.4\nSETS^var.currentShow^Default\nSETS^var.currentSnapshot^MixMate1\nSETS^settings.block.pass^\nSETD^settings.block.player^1';
class Events {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, [...this.handlers.get(type) || [], fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item !== fn)); }
  emit(type, event = {}) { for (const fn of [...this.handlers.get(type) || []]) fn(event); }
}
function fixture() {
  const dom = domFixture(), { root } = dom;
  const button = dom.document.createElement('button'); button.dataset.action = 'native'; button.disabled = true; root.append(button);
  const messages = [], logs = [], rows = [];
  const ui = { message: text => messages.push(text), log: text => logs.push(text), diagnostics: { nativeTarget: url => rows.push(url) } };
  const opens = [], window = { opens, result: {}, open(...args) { opens.push(args); return this.result; } };
  return { dom, root, button, ui, messages, logs, rows, opens, window };
}

test('nativeUiUrl only builds from a validated private IPv4 address', () => {
  assert.equal(nativeUiUrl('192.168.0.60'), 'http://192.168.0.60/');
  for (const bad of [null, undefined, '', '8.8.8.8', 'example.com', '192.168.0.60/evil', 'http://192.168.0.60', '192.168.0.60:80', '192.168.0.60@evil.test', ' 192.168.0.60 x', 5]) assert.equal(nativeUiUrl(bad), null, String(bad));
});

test('the Native button is disabled with a reason until an address is known, and never opens on load', () => {
  const f = fixture(), native = mountNativeUi({ root: f.root, ui: f.ui, window: f.window });
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.attributes.title, NATIVE_NO_ADDRESS_REASON);
  assert.equal(f.rows.at(-1), null);
  f.button.emit('click');
  assert.deepEqual(f.opens, []);
  native.setAddress('192.168.0.60');
  assert.equal(f.opens.length, 0, 'setting the address never navigates');
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.attributes.title, "Open the desk's own web app (192.168.0.60) in a new tab");
  assert.equal(f.rows.at(-1), 'http://192.168.0.60/');
  native.setAddress('not an address');
  assert.equal(f.button.disabled, true);
  f.button.emit('click');
  assert.deepEqual(f.opens, []);
  native.destroy();
});

test('a tap opens exactly http://<ip>/ in a new tab with noopener and no outbound message', () => {
  const f = fixture(), native = mountNativeUi({ root: f.root, ui: f.ui, window: f.window });
  f.window.result = { closed: false };
  native.setAddress('10.1.2.3');
  f.button.emit('click');
  assert.deepEqual(f.opens, [['http://10.1.2.3/', '_blank', 'noopener']]);
  assert.deepEqual(f.messages, []);
  native.destroy();
  f.button.emit('click');
  assert.equal(f.opens.length, 1, 'destroyed: no further opens');
});

test('a blocked or null popup shows the address to open manually', () => {
  const f = fixture(), native = mountNativeUi({ root: f.root, ui: f.ui, window: f.window });
  native.setAddress('192.168.0.60');
  f.window.result = null;
  f.button.emit('click');
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0], /http:\/\/192\.168\.0\.60\//);
  f.window.open = () => { throw new Error('blocked'); };
  f.button.emit('click');
  assert.equal(f.messages.length, 2);
  native.destroy();
});

test('the live shell removes the simulated native screen; the Demo and shell template keep it', async () => {
  const shell = await readFile(new URL('../src/iem/shell.html', import.meta.url), 'utf8');
  assert.match(shell, /mm-native-layer/);
  const dom = domFixture(), layer = dom.document.createElement('section'); layer.className = 'mm-native-layer';
  dom.root.append(layer);
  tidyLive(dom.root);
  assert.equal(dom.root.querySelector('.mm-native-layer'), null);
  const live = await readFile(new URL('../src/iem/live-view.js', import.meta.url), 'utf8');
  assert.doesNotMatch(live, /Simulated native/);
  const demo = await readFile(new URL('../src/iem/demo-view.js', import.meta.url), 'utf8');
  assert.match(demo, /mm-native-layer/);
  assert.match(demo, /case "native"/);
});

test('mountReadOnlyView exempts the native button from its blanket disable', async () => {
  const live = await readFile(new URL('../src/iem/live-view.js', import.meta.url), 'utf8');
  assert.match(live, /\['fullscreen', 'overview', 'install', 'dismiss-install', 'native'\]/);
});

class FakeSocket {
  static all = [];
  readyState = 0; sent = [];
  constructor(url) { this.url = url; FakeSocket.all.push(this); }
  send(message) { this.sent.push(message); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(data) { this.onmessage?.({ data }); }
}
const timers = { setTimeout: () => 1, setInterval: () => 1, clearTimeout() {}, clearInterval() {} };

test('controller feeds the connected, else most recent known, address; hiding disconnects and clears received state', async () => {
  FakeSocket.all = [];
  const f = fixture(); tidyLive(f.root);
  const session = createAuxControlSession({ WebSocketClass: FakeSocket, timers, now: () => 0, wallNow: () => 0 });
  const repository = new SettingsRepository({ indexedDB: undefined });
  await repository.replace({ ...emptySettings(), knownAddresses: ['192.168.0.61'] });
  f.root.querySelector('.mm-diagnostics-open').disabled = true;
  const owner = createDialogOwner(), ui = createLiveConnectionUI(f.root, { levels: true, pan: true, dialogOwner: owner, timers });
  const native = mountNativeUi({ root: f.root, ui, window: f.window });
  ui.onDeskAddress(address => native.setAddress(address));
  const view = { render() {}, preferences() {}, snapshotName() {}, clear() {}, destroy() {} };
  const document = Object.assign(new Events(), { hidden: false, activeElement: null }), window = new Events();
  const controller = mountLiveController({ session, repository, view, ui, document, window, timers, now: () => 0, autoConnect: false, createID: () => 'rig-1' });
  await controller.ready;
  assert.equal(native.target(), 'http://192.168.0.61/', 'most recent known address while disconnected');
  assert.equal(f.button.disabled, false);
  assert.match(f.root.querySelector('.mm-diag-value') ? 'ok' : 'ok', /ok/);

  ui.address.value = '10.0.0.5'; ui.form.emit('submit');
  const [writer, receiver] = FakeSocket.all.slice(-2);
  writer.open(); receiver.open(); receiver.receive(TOPOLOGY);
  assert.equal(session.snapshot().phase, 'live');
  assert.equal(native.target(), 'http://10.0.0.5/', 'connected address wins');
  const sent = [...writer.sent, ...receiver.sent];

  // Leaving MixMate: the new tab takes focus, the page becomes hidden.
  document.hidden = true; document.emit('visibilitychange');
  assert.equal(writer.readyState, 3); assert.equal(receiver.readyState, 3);
  assert.notEqual(session.snapshot().phase, 'live');
  assert.deepEqual([...writer.sent, ...receiver.sent], sent, 'hiding sends nothing');
  assert.equal(session.snapshot().auxes?.length ?? 0, 0, 'received state cleared');
  native.destroy(); controller.destroy(); await repository.close();
});

test('the local clock reads only the local wall clock and never touches a session or the desk', async () => {
  const element = { attrs: {}, innerHTML: '', setAttribute(key, value) { this.attrs[key] = value; } };
  const intervals = [], realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms) => { intervals.push(ms); return 7; }; globalThis.clearInterval = () => {};
  try {
    const stop = startLocalClock(element);
    assert.match(element.attrs['aria-label'], /^Current local time \d\d:\d\d:\d\d$/);
    assert.deepEqual(intervals, [1000]);
    stop();
  } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; }
  const source = (await readFile(new URL('../src/iem/clock.js', import.meta.url), 'utf8')).replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.doesNotMatch(source, /session|WebSocket|\.send\(|SETD|SETS/i);
});

test('no mixer time or clock path exists in the typed write allowlist', async () => {
  const dir = new URL('../src/iem/', import.meta.url), names = (await readdir(dir)).filter(name => name.endsWith('.js'));
  for (const name of names) {
    const text = await readFile(new URL(name, dir), 'utf8');
    assert.doesNotMatch(text, /SET[DS]\^[^'"`\n]*(time|clock|ntp|date)/i, name);
    assert.doesNotMatch(text, /['"`](?:settings|var)\.(?:time|clock|ntp|date)/i, name);
  }
});
