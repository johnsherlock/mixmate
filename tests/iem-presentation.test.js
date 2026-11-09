import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProvider } from '../src/iem/demo-provider.js';
import { createEmptyLiveProvider } from '../src/iem/live-provider.js';
import { installFaderGestures } from '../src/iem/gestures.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';
import { createReadOnlySession } from '../src/iem/live-session.js';
import { projectLiveState } from '../src/iem/live-provider.js';

class Node {
  children = []; dataset = {}; style = { values: {}, calls: [], setProperty(name, value) { this.values[name] = value; this.calls.push([name, value]); } }; attributes = {}; value = ''; disabled = false;
  handlers = new Map();
  constructor(document) { this.ownerDocument = document; }
  addEventListener(type, callback) { this.handlers.set(type, [...(this.handlers.get(type) || []), callback]); }
  removeEventListener(type, callback) { this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item !== callback)); }
  emit(type, event) { for (const callback of this.handlers.get(type) || []) callback(event); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  insertBefore(node, reference) { node.remove(); node.parentElement = this; const index = reference ? this.children.indexOf(reference) : this.children.length; this.children.splice(index, 0, node); }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } }
  before(node) { const parent = this.parentElement; node.parentElement = parent; parent.children.splice(parent.children.indexOf(this), 0, node); }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  classList = { contains: name => this.className?.split(' ').includes(name) || false };
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return all;
    if (selector === 'input') return all.filter(node => node.tag === 'input');
    if (selector.startsWith('input.mm-vertical')) return all.filter(node => node.tag === 'input' && node.classList.contains('mm-vertical'));
    if (selector === 'button') return all.filter(node => node.tag === 'button');
    return all.filter(node => node.classList.contains(selector.slice(1)));
  }
  focus() {}
  getBoundingClientRect() { return { width: 42, height: 200, top: 0, bottom: 200, left: 0 }; }
  setPointerCapture() { this.captured = true; }
  dispatchEvent(event) { this.events ||= []; this.events.push(event.type); }
}
function documentFixture() {
  const document = new Node(); document.createElement = tag => Object.assign(new Node(document), { tag });
  return document;
}

test('demo data instances are isolated and cannot seed the empty live provider', () => {
  const a = createDemoProvider(), b = createDemoProvider(), live = createEmptyLiveProvider();
  a.desks[0].mixes[0].levels[0] = 9;
  assert.notEqual(b.desks[0].mixes[0].levels[0], 9);
  assert.deepEqual(live.snapshot().mixes, []);
  live.snapshot().mixes.push({ id: 'fabricated' });
  assert.deepEqual(live.snapshot().mixes, []);
  assert.deepEqual(live.clear().mixes, []);
  assert.equal(a.channels.length, 28); // Demo inventory only, never live discovery.
});

test('accepted gesture policy preserves scroll taps, cap drags, double jumps and master EQ navigation', () => {
  const document = documentFixture(), root = new Node(document), wrap = document.createElement('div'); wrap.className = 'mm-fader-control';
  const input = document.createElement('input'); input.className = 'mm-vertical'; input.min = '0'; input.max = '1'; input.step = '0.001'; input.value = '0.4'; input.dataset.master = '2';
  const cap = document.createElement('span'); cap.className = 'mm-fader-hit'; wrap.append(input, cap); root.append(wrap);
  const opened = [], gestures = installFaderGestures(root, { onMasterEQ: index => opened.push(index) });
  const target = hit => ({ closest: selector => selector === '.mm-fader-control' ? wrap : hit && selector === '.mm-fader-hit' ? cap : null });
  const event = (hit, y) => ({ target: target(hit), pointerId: 1, button: 0, clientX: 20, clientY: y, preventDefault() { this.prevented = true; } });
  gestures.prepare(); gestures.prepare(); assert.equal(wrap.children.length, 2); // No cap/input replacement.
  let down = event(false, 70); root.emit('pointerdown', down); root.emit('pointerup', event(false, 70));
  assert.equal(input.value, '0.4'); assert.equal(down.prevented, undefined);
  gestures.cancel();
  down = event(false, 70); root.emit('pointerdown', down); root.emit('pointermove', event(false, 150)); root.emit('pointerup', event(false, 150));
  assert.equal(input.value, '0.4'); assert.equal(wrap.captured, undefined);
  gestures.cancel();
  down = event(true, 100); root.emit('pointerdown', down); root.emit('pointermove', event(true, 70)); root.emit('pointerup', event(true, 70));
  assert.equal(wrap.captured, true); assert.equal(down.prevented, true); assert.ok(+input.value > 0.4);
  assert.deepEqual(input.events, ['input', 'change']);
  gestures.cancel(); input.events = [];
  for (let i = 0; i < 2; i++) { root.emit('pointerdown', event(false, 20)); root.emit('pointerup', event(false, 20)); }
  assert.ok(+input.value > 0.9); assert.deepEqual(input.events, ['input', 'change']);
  gestures.cancel(); input.events = [];
  for (let i = 0; i < 2; i++) { root.emit('pointerdown', event(true, 20)); root.emit('pointerup', event(true, 20)); }
  assert.deepEqual(opened, [2]); assert.deepEqual(input.events, []);
  gestures.cancel(); input.disabled = true;
  root.emit('pointerdown', event(true, 20)); root.emit('pointermove', event(true, 150)); root.emit('pointerup', event(true, 150));
  assert.deepEqual(input.events, []);
  gestures.destroy(); assert.ok([...root.handlers.values()].every(callbacks => callbacks.length === 0));
});

test('read-only keyed strips render strings as text and preserve nodes through updates/order/unknown transitions', () => {
  const previous = Object.fromEntries(['document', 'window', 'matchMedia', 'innerHeight', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  const document = documentFixture(), root = new Node(document);
  for (const name of ['mm-content', 'mm-clock', 'mm-navigation', 'mm-local-tabs', 'mm-snapshot-name', 'mm-desk', 'mm-feedback', 'mm-dirty', 'mm-rec-state', 'mm-mode-label', 'mm-app']) {
    const node = document.createElement('div'); node.className = name; root.append(node);
  }
  Object.assign(globalThis, { document, window: new Node(document), matchMedia: () => ({ matches: true }), innerHeight: 844, ResizeObserver: class { observe() {} disconnect() {} } });
  let view;
  try {
    view = mountReadOnlyView(root);
    const a = { id: 'a.0', name: '<img src=x onerror=alert(1)>', detail: 'Received text', levelText: 'Received', position: 0.7 }, b = { id: 'a.1', name: 'Other', detail: 'Partial' };
    view.render({ status: 'Received partial state', mixes: [a, b] });
    const grid = root.querySelector('.mm-strip-grid'), first = grid.children[0], input = first.querySelector('input'), cap = first.querySelector('.mm-fader-hit');
    assert.equal(first.querySelector('.mm-strip-name').textContent, a.name);
    assert.equal(first.querySelector('.mm-strip-name').innerHTML, undefined);
    assert.equal(input.disabled, true);
    view.render({ status: 'Partial', mixes: [b, { ...a, levelText: undefined, position: undefined }] });
    assert.equal(grid.children[1], first); assert.equal(first.querySelector('input'), input); assert.equal(first.querySelector('.mm-fader-hit'), cap);
    assert.equal(first.dataset.unknown, 'true'); assert.equal(first.querySelector('.mm-value').textContent, '—');
    const selected = { ...a, auxIndex: 0, themeIndex: 0, browsable: true };
    const source = { id: 'i.0@0', name: '<svg onload=alert(1)>', detail: 'Input 1', position: 0.25, levelText: 'Received', panText: 'Pan 0.500 · normalized' };
    view.render({ status: 'Live', mixes: [selected, b], selectedAux: 0, selectedMix: selected, sources: [source] });
    const bank = root.querySelector('.mm-strip-scroll'), sourceArticle = bank.children[0], sourceInput = sourceArticle.querySelector('input'), sourceCap = sourceArticle.querySelector('.mm-fader-hit');
    assert.equal(sourceArticle.querySelector('.mm-strip-name').textContent, source.name);
    assert.equal(sourceArticle.querySelector('.mm-strip-name').innerHTML, undefined);
    view.render({ status: 'Live', mixes: [selected, b], selectedAux: 0, selectedMix: selected, sources: [{ ...source, position: 0.7, levelText: 'Changed' }] });
    assert.equal(root.querySelector('.mm-strip-scroll'), bank); assert.equal(bank.children[0], sourceArticle);
    assert.equal(sourceArticle.querySelector('input'), sourceInput); assert.equal(sourceArticle.querySelector('.mm-fader-hit'), sourceCap); assert.equal(sourceInput.disabled, true);
    view.render({ status: 'Partial', mixes: [selected], selectedAux: 0, selectedMix: selected, sources: [] });
    assert.equal(root.querySelector('.mm-source-empty').hidden, false); assert.equal(root.querySelector('.mm-empty').hidden, true);
    view.clear(); assert.equal(grid.children.length, 0); assert.equal(bank.children.length, 0);
  } finally {
    view?.destroy();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});


test('mixed state/VU bursts throttle actual meter fill/text writes and preserve caps, scroll and zero/stale/unknown distinctions', () => {
  const previous = Object.fromEntries(['document', 'window', 'matchMedia', 'innerHeight', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  const document = documentFixture(), root = new Node(document);
  for (const name of ['mm-content', 'mm-clock', 'mm-navigation', 'mm-local-tabs', 'mm-snapshot-name', 'mm-desk', 'mm-feedback', 'mm-dirty', 'mm-rec-state', 'mm-mode-label', 'mm-app']) {
    const node = document.createElement('div'); node.className = name; root.append(node);
  }
  Object.assign(globalThis, { document, window: new Node(document), matchMedia: () => ({ matches: true }), innerHeight: 844, ResizeObserver: class { observe() {} disconnect() {} } });
  let clock = 0, next = 0, socket, view;
  const jobs = new Map();
  const timers = {
    setTimeout(callback, delay) { const id = ++next; jobs.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    setInterval() { return 999; }, clearInterval() {},
  };
  function tick(amount) {
    const end = clock + amount;
    while (true) {
      const found = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!found) break;
      jobs.delete(found[0]); clock = found[1].at; found[1].callback();
    }
    clock = end;
  }
  class FakeSocket { readyState = 0; constructor() { socket = this; } send(message) { assert.ok(['3:::INIT', '3:::ALIVE', '2::'].includes(message)); } close() { this.readyState = 3; } }
  const session = createReadOnlySession({ WebSocketClass: FakeSocket, timers, now: () => clock, wallNow: () => clock });
  try {
    view = mountReadOnlyView(root);
    session.subscribe((snapshot, kind) => {
      const model = projectLiveState(snapshot, 0);
      if (kind === 'meters') view.renderMeters(model); else view.render(model);
    });
    session.connect('192.168.0.60'); socket.readyState = 1; socket.onopen();
    socket.onmessage({ data: '3:::SETS^model^ui24\nSETD^a.0.matrix^0\nSETD^a.0.mix^0.5\nSETD^i.0.aux.0.value^0.25' });
    const bank = root.querySelector('.mm-strip-scroll'), article = bank.children[0], input = article.querySelector('input'), cap = article.querySelector('.mm-fader-hit');
    const pair = article.querySelector('.mm-meter-pair'), fill = article.querySelector('.mm-meter').children[0], caption = article.querySelector('.mm-live-meter-status');
    bank.scrollLeft = 73; const initialWrites = fill.style.calls.length;
    for (let n = 0; n < 100; n++) {
      const packet = new Uint8Array(14); packet[0] = 1; packet[10] = n;
      socket.onmessage({ data: `3:::SETD^i.0.aux.0.value^${n / 100}\nVU2^${Buffer.from(packet).toString('base64')}` });
    }
    assert.equal(fill.style.calls.length, initialWrites);
    assert.equal(pair.dataset.state, 'missing');
    tick(100);
    assert.equal(fill.style.calls.length, initialWrites + 1); assert.equal(pair.dataset.state, 'fresh');
    assert.equal(fill.style.values['--level'], `${99 * 0.004167508166392142 * 100}%`);
    assert.match(root.querySelector('.mm-live-meter-legend').textContent, /source VU is NOT AUX-send contribution.*firmware unverified/);
    const zero = new Uint8Array(14); zero[0] = 1;
    socket.onmessage({ data: '3:::VU2^' + Buffer.from(zero).toString('base64') }); tick(100);
    assert.match(caption.textContent, /−80 dB floor/); assert.equal(pair.dataset.state, 'fresh');
    tick(1900); assert.equal(pair.dataset.state, 'stale'); assert.match(caption.textContent, /Stale/);
    assert.equal(fill.style.values['--level'], '0%');
    socket.onmessage({ data: '3:::VU2^' + Buffer.from(new Uint8Array(8)).toString('base64') }); tick(100);
    assert.equal(pair.dataset.state, 'missing'); assert.match(caption.textContent, /Unavailable/);
    assert.equal(root.querySelector('.mm-strip-scroll'), bank); assert.equal(bank.scrollLeft, 73);
    assert.equal(bank.children[0], article); assert.equal(article.querySelector('input'), input); assert.equal(article.querySelector('.mm-fader-hit'), cap);
    assert.equal(input.disabled, true);
    view.preferences({ orientation: 'portrait', showMeters: false }); assert.equal(root.dataset.showMeters, 'false');
    session.disconnect(); assert.equal(bank.children.length, 0); assert.equal(jobs.size, 0);
  } finally {
    session.disconnect(); view?.destroy();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
