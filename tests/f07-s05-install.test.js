import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstallPrompt, INSTALL_DISMISSED_KEY, IOS_INSTRUCTION } from '../src/iem/install.js';
import { domFixture } from './helpers/fake-dom.js';

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
