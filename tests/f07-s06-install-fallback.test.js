import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstallPrompt, INSTALL_DISMISSED_KEY, IOS_INSTRUCTION, ANDROID_INSTRUCTION, GENERIC_INSTRUCTION, FALLBACK_DELAY_MS } from '../src/iem/install.js';
import { domFixture } from './helpers/fake-dom.js';
import { mountReadOnlyView } from '../src/iem/live-view.js';

class Events {
  handlers = new Map();
  addEventListener(type, fn) { this.handlers.set(type, [...(this.handlers.get(type) || []), fn]); }
  removeEventListener(type, fn) { this.handlers.set(type, (this.handlers.get(type) || []).filter(value => value !== fn)); }
  emit(type, event = {}) { for (const fn of this.handlers.get(type) || []) fn(event); }
}
const store = (data = new Map()) => ({ data, getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) });
const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 17; Pixel) Chrome/157', maxTouchPoints: 5 };
function setup({ standalone = false, navigator = ANDROID, storage = store() } = {}) {
  const { document } = domFixture(), container = document.createElement('div'), nav = document.createElement('nav'); container.append(nav);
  const window = Object.assign(new Events(), { matchMedia: query => ({ matches: standalone && query === '(display-mode: standalone)' }) });
  const jobs = [], cleared = [], timers = { setTimeout: (fn, ms) => { jobs.push({ fn, ms, live: true }); return jobs.length - 1; }, clearTimeout: id => { cleared.push(id); if (jobs[id]) jobs[id].live = false; } };
  const states = [], prompt = createInstallPrompt({ container, before: nav, window, navigator, storage, timers, onState: value => states.push(value) });
  const fire = () => { for (const job of jobs) if (job.live) { job.live = false; job.fn(); } };
  const offer = () => { const event = { prompts: 0, preventDefault() {}, prompt() { this.prompts++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: 'accepted' }) }; window.emit('beforeinstallprompt', event); return event; };
  return { prompt, window, jobs, cleared, fire, offer, states, storage, container };
}
const text = t => t.prompt.strip.children[0].textContent;
const tick = () => new Promise(resolve => setImmediate(resolve));

test('one 3 s timer; nothing shows before it; Android gets the browser-menu instruction without an Install button', () => {
  const t = setup();
  assert.equal(t.jobs.length, 1); assert.equal(t.jobs[0].ms, 3000); assert.equal(FALLBACK_DELAY_MS, 3000);
  assert.equal(t.prompt.strip.hidden, true); assert.equal(t.prompt.kind(), 'unsupported');
  t.fire();
  assert.equal(t.prompt.kind(), 'menu'); assert.equal(t.prompt.strip.hidden, false); assert.equal(t.prompt.go.hidden, true);
  assert.equal(text(t), ANDROID_INSTRUCTION); assert.equal(ANDROID_INSTRUCTION, 'To install: open your browser menu (⋮) → Install app or Add to Home screen');
  assert.match(t.states.at(-1).text, /^Menu instructions/); assert.equal(t.jobs.length, 1);
});

test('other touch browsers get the generic line; a plain desktop gets nothing', () => {
  const generic = setup({ navigator: { userAgent: 'Mozilla/5.0 (X11; Linux) Firefox', maxTouchPoints: 2 } }); generic.fire();
  assert.equal(text(generic), GENERIC_INSTRUCTION); assert.equal(generic.prompt.strip.hidden, false);
  const desktop = setup({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh) Firefox', maxTouchPoints: 0 } });
  assert.equal(desktop.jobs.length, 0); assert.equal(desktop.prompt.strip.hidden, true); assert.equal(desktop.prompt.kind(), 'unsupported');
});

test('no timer or fallback when standalone, installed (appinstalled), dismissed or iOS', () => {
  const standalone = setup({ standalone: true }); assert.equal(standalone.jobs.length, 0); assert.equal(standalone.prompt.strip.hidden, true);
  const installed = setup(); installed.fire(); installed.window.emit('appinstalled');
  assert.equal(installed.prompt.strip.hidden, true); assert.equal(installed.prompt.kind(), 'installed');
  const early = setup(); early.window.emit('appinstalled'); assert.equal(early.cleared.length, 1); early.fire(); assert.equal(early.prompt.strip.hidden, true);
  const storage = store(new Map([[INSTALL_DISMISSED_KEY, '1']])), dismissed = setup({ storage }); dismissed.fire();
  assert.equal(dismissed.prompt.strip.hidden, true); assert.match(dismissed.states.at(-1).text, /Menu instructions.*\(dismissed\)/); assert.equal(dismissed.states.at(-1).canShow, true);
  dismissed.prompt.reshow(); assert.equal(dismissed.prompt.strip.hidden, false);
  const ios = setup({ navigator: { userAgent: 'Mozilla/5.0 (iPhone)', maxTouchPoints: 5 } });
  assert.equal(ios.jobs.length, 0); assert.equal(ios.prompt.kind(), 'instructions'); assert.equal(text(ios), IOS_INSTRUCTION); assert.equal(ios.prompt.strip.hidden, false);
});

test('dismissing the fallback is remembered per device', () => {
  const t = setup(); t.fire(); t.prompt.dismissButton.emit('click');
  assert.equal(t.prompt.strip.hidden, true); assert.equal(t.storage.data.get(INSTALL_DISMISSED_KEY), '1');
});

test('a late beforeinstallprompt replaces the fallback with an enabled Install button that prompts on click', async () => {
  const t = setup(); t.fire(); assert.equal(t.prompt.go.hidden, true);
  const event = t.offer();
  assert.equal(t.prompt.kind(), 'installable'); assert.equal(t.prompt.go.hidden, false); assert.equal(t.prompt.go.disabled, false); assert.equal(text(t), 'Install MixMate as an app'); assert.equal(event.prompts, 0);
  t.prompt.go.emit('click'); await tick(); await tick();
  assert.equal(event.prompts, 1); assert.equal(t.prompt.strip.hidden, true); // accepted: no menu fallback flashes back
  const early = setup(); early.offer(); assert.equal(early.cleared.length, 1); early.fire(); assert.equal(early.prompt.kind(), 'installable');
});

test('destroy clears the timer', () => {
  const t = setup(); t.prompt.destroy(); assert.equal(t.cleared.length, 1); t.fire(); assert.equal(t.prompt.strip.hidden, true);
});

test('buttons stay enabled and named through mountReadOnlyView in the fallback state', () => {
  const keys = ['document', 'window', 'matchMedia', 'innerHeight', 'ResizeObserver'], old = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  try {
    const { document, root } = domFixture(), nav = root.querySelector('.mm-navigation');
    const window = Object.assign(new Events(), { matchMedia: () => ({ matches: false }) });
    Object.assign(globalThis, { document, window, matchMedia: () => ({ matches: true }), innerHeight: 844, ResizeObserver: class { observe() {} disconnect() {} } });
    const jobs = [], prompt = createInstallPrompt({ container: root, before: nav, window, navigator: ANDROID, storage: store(), timers: { setTimeout: fn => jobs.push(fn), clearTimeout() {} } });
    const view = mountReadOnlyView(root); jobs.forEach(fn => fn());
    assert.equal(prompt.strip.hidden, false); assert.equal(prompt.dismissButton.disabled, false);
    assert.equal(prompt.dismissButton.attributes['aria-label'], 'Dismiss install prompt'); assert.equal(prompt.dismissButton.attributes.title, 'Dismiss');
    prompt.destroy(); view.destroy();
  } finally { for (const key of keys) { if (old[key] === undefined) delete globalThis[key]; else globalThis[key] = old[key]; } }
});

test('review round 1: Android emulated on a Mac (MacIntel + touch) is not iOS and gets the Android fallback; real iPadOS still gets the iOS line', () => {
  const emulated = setup({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36', platform: 'MacIntel', userAgentData: { platform: 'Android' }, maxTouchPoints: 5 } });
  assert.equal(emulated.prompt.strip.hidden, true); assert.equal(emulated.jobs.length, 1); emulated.fire();
  assert.equal(emulated.prompt.kind(), 'menu'); assert.equal(text(emulated), ANDROID_INSTRUCTION);
  const ipad = setup({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 } });
  assert.equal(ipad.prompt.kind(), 'instructions'); assert.equal(text(ipad), IOS_INSTRUCTION); assert.equal(ipad.jobs.length, 0);
});
