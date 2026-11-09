import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoProvider } from '../src/iem/demo-provider.js';
import { createEmptyLiveProvider } from '../src/iem/live-provider.js';
import { installFaderGestures } from '../src/iem/gestures.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';

class Node {
  children = []; dataset = {}; style = { setProperty() {} }; attributes = {}; value = ''; disabled = false;
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
