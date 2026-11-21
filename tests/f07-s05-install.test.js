import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstallPrompt, INSTALL_DISMISSED_KEY, IOS_INSTRUCTION } from '../src/iem/install.js';
import { domFixture } from './helpers/fake-dom.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';
import { tidyLive } from '../src/iem/live-shell.js';
import { createDiagnostics } from '../src/iem/diagnostics.js';
import { createGroupEditorUI } from '../src/iem/group-editor-ui.js';

class Events {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, [...(this.handlers.get(type) || []), fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(value => value !== fn)); }
  emit(type, event = {}) { for (const fn of this.handlers.get(type) || []) fn(event); }
}
const store = (data = new Map()) => ({ data, getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) });
function setup({ standalone = false, navigator = { userAgent: 'Chrome' }, storage = store() } = {}) {
  const { document } = domFixture(), container = document.createElement('div'), nav = document.createElement('nav'); container.append(nav);
  const window = Object.assign(new Events(), { matchMedia: query => ({ matches: standalone && query === '(display-mode: standalone)' }) });
  const states = [], prompt = createInstallPrompt({ container, before: nav, window, navigator, storage, onState: value => states.push(value) });
  const offer = (outcome = 'accepted') => { const event = { prevented: false, prompts: 0, preventDefault() { this.prevented = true; }, prompt() { this.prompts++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome }) }; window.emit('beforeinstallprompt', event); return event; };
  return { prompt, window, offer, states, storage, container, nav };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('beforeinstallprompt shows the non-modal strip in flow before the navigation, without calling prompt()', () => {
  const t = setup(), event = t.offer();
  assert.equal(event.prevented, true); assert.equal(event.prompts, 0);
  assert.equal(t.prompt.strip.hidden, false); assert.equal(t.prompt.kind(), 'installable'); assert.equal(t.states.at(-1).text, 'Installable');
  assert.equal(t.container.children.indexOf(t.prompt.strip), t.container.children.indexOf(t.nav) - 1);
  assert.equal(t.prompt.strip.attributes['aria-modal'], undefined);
});

test('prompt() is called only from a click, once, and the strip hides afterwards', async () => {
  const t = setup(), event = t.offer();
  assert.equal(event.prompts, 0);
  t.prompt.go.emit('click'); await tick(); await tick();
  assert.equal(event.prompts, 1); assert.equal(t.prompt.strip.hidden, true);
  t.prompt.go.emit('click'); await tick(); assert.equal(event.prompts, 1);
  assert.equal(t.storage.data.has(INSTALL_DISMISSED_KEY), false); // accepted: nothing to remember
});

test('declining the browser prompt is remembered like a dismissal', async () => {
  const t = setup(); t.offer('dismissed'); t.prompt.go.emit('click'); await tick(); await tick();
  assert.equal(t.storage.data.get(INSTALL_DISMISSED_KEY), '1'); assert.equal(t.prompt.strip.hidden, true);
});

test('running standalone or installed keeps it hidden; appinstalled hides it', () => {
  const standalone = setup({ standalone: true }); standalone.offer();
  assert.equal(standalone.prompt.kind(), 'installed'); assert.equal(standalone.prompt.strip.hidden, true);
  const ios = setup({ navigator: { userAgent: 'iPhone', standalone: true } }); assert.equal(ios.prompt.strip.hidden, true); assert.equal(ios.prompt.kind(), 'installed');
  const t = setup(); t.offer(); assert.equal(t.prompt.strip.hidden, false);
  t.window.emit('appinstalled'); assert.equal(t.prompt.strip.hidden, true); assert.equal(t.prompt.kind(), 'installed'); assert.equal(t.states.at(-1).text, 'Installed (running as an app)');
});

test('dismissal is remembered per device and Diagnostics can show the prompt again', () => {
  const storage = store(), t = setup({ storage }); t.offer(); t.prompt.dismissButton.emit('click');
  assert.equal(t.prompt.strip.hidden, true); assert.equal(storage.data.get(INSTALL_DISMISSED_KEY), '1'); assert.equal(t.states.at(-1).canShow, true);
  const later = setup({ storage }); later.offer(); assert.equal(later.prompt.strip.hidden, true); assert.match(later.states.at(-1).text, /dismissed/);
  later.prompt.reshow(); assert.equal(later.prompt.strip.hidden, false); assert.equal(storage.data.has(INSTALL_DISMISSED_KEY), false);
  const denied = setup({ storage: { getItem() { throw Error('x'); }, setItem() { throw Error('x'); }, removeItem() { throw Error('x'); } } });
  denied.offer(); denied.prompt.dismissButton.emit('click'); assert.equal(denied.prompt.strip.hidden, true);
});

test('iOS/iPadOS Safari gets the one-line instruction; other browsers without an offer are unsupported', () => {
  for (const navigator of [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari' }, { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }]) {
    const t = setup({ navigator });
    assert.equal(t.prompt.kind(), 'instructions'); assert.equal(t.prompt.strip.hidden, false); assert.equal(t.prompt.go.hidden, true);
    assert.equal(t.prompt.strip.children[0].textContent, IOS_INSTRUCTION); assert.equal(IOS_INSTRUCTION, 'To install: Share → Add to Home Screen');
    t.prompt.dismissButton.emit('click'); assert.equal(t.prompt.strip.hidden, true);
  }
  const plain = setup(); assert.equal(plain.prompt.kind(), 'unsupported'); assert.equal(plain.prompt.strip.hidden, true); assert.match(plain.states.at(-1).text, /Not offered/);
});

test('F07-S05 review P1: the buttons stay enabled after the real live view disables every button present at mount (either order)', () => {
  const keys = ['document', 'window', 'matchMedia', 'innerHeight', 'ResizeObserver'], old = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  try {
    for (const installFirst of [true, false]) {
      const dom = domFixture(), { document, root } = dom, nav = root.querySelector('.mm-navigation');
      const window = Object.assign(new Events(), { matchMedia: () => ({ matches: false }) });
      Object.assign(globalThis, { document, window, matchMedia: () => ({ matches: true }), innerHeight: 844, ResizeObserver: class { observe() {} disconnect() {} } });
      let prompt; const mount = () => { prompt = createInstallPrompt({ container: root, before: nav, window, navigator: { userAgent: 'Chrome' }, storage: store() }); };
      if (installFirst) mount();
      const view = mountReadOnlyView(root); // disables every button present at mount except the exempt actions
      if (!installFirst) mount();
      const event = { prompts: 0, preventDefault() {}, prompt() { this.prompts++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
      window.emit('beforeinstallprompt', event);
      assert.equal(prompt.strip.hidden, false); assert.equal(prompt.go.disabled, false); assert.equal(prompt.dismissButton.disabled, false);
      assert.ok(root.querySelectorAll('button').some(button => button.disabled), 'the view still disabled its own buttons');
      prompt.go.emit('click'); assert.equal(event.prompts, 1);
      prompt.destroy(); view.destroy();
    }
  } finally { for (const key of keys) { if (old[key] === undefined) delete globalThis[key]; else globalThis[key] = old[key]; } }
});

test('F07-S05 review P2: a lasting "Groups unavailable" reason never replaces the update notice; it shows after the notice expires', () => {
  const { root } = domFixture(); tidyLive(root);
  const jobs = []; const timers = { setTimeout: fn => jobs.push(fn) - 1, clearTimeout() {} };
  const diagnostics = createDiagnostics(root, { timers });
  const connectionUI = { diagnostics, message: text => diagnostics.message(text), close() {}, beforeOpen() {}, condition: text => diagnostics.condition(text) };
  const groups = createGroupEditorUI(root, connectionUI);
  const slot = () => root.querySelector('.mm-message').textContent;
  connectionUI.message('Updated to v0.6.0 (abc1234).');
  groups.unavailable('Groups unavailable: connect to the desk to load groups for its current snapshot.');
  assert.equal(slot(), 'Updated to v0.6.0 (abc1234).');
  diagnostics.condition('Groups unavailable: connect to the desk to load groups for its current snapshot.');
  assert.equal(slot(), 'Updated to v0.6.0 (abc1234).'); // a newer lasting condition does not overwrite it
  jobs.at(-1)(); // transient expires
  assert.match(slot(), /^Groups unavailable/);
});
