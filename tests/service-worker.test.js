import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';

const template = await readFile(new URL('../src/sw-template.js', import.meta.url), 'utf8');
const scope = 'https://example.test/mixmate/';
const bodies = { 'index.html': '<h1>MixMate</h1>', 'iem.html': 'empty read-only surface', 'demo.html': 'isolated simulation', 'assets/app.js': 'local app', 'mockups/iem.html': 'demo only' };
const digest = value => createHash('sha256').update(value).digest('hex');
class MemoryCache {
  entries = new Map();
  async match(key) { return this.entries.get(String(key))?.clone(); }
  async put(key, response) { this.entries.set(String(key), response.clone()); }
}
function worker({ version = 'v1', network = bodies, storage = new Map() } = {}) {
  const listeners = {}, requests = [];
  const fetch = async request => {
    const url = typeof request === 'string' ? request : request.url;
    requests.push(url);
    const path = url.slice(scope.length);
    if (!(path in network)) throw new Error('Offline or missing');
    return network[path] instanceof Response ? network[path] : new Response(network[path]);
  };
  const caches = {
    async open(key) {
      if (!storage.has(key)) {
        const cache = new MemoryCache();
        cache.addAll = async urls => {
          const responses = await Promise.all(urls.map(fetch));
          await Promise.all(urls.map((url, i) => cache.put(url, responses[i])));
        };
        storage.set(key, cache);
      }
      return storage.get(key);
    },
    async keys() { return [...storage.keys()]; },
    async delete(key) { return storage.delete(key); },
  };
  let claimed = false;
  const source = template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(Object.keys(bodies)))
    .replace('__HASHES__', JSON.stringify(Object.fromEntries(Object.entries(bodies).map(([path, body]) => [path, digest(body)]))))
    .replace('__ENTRY_PROOFS__', JSON.stringify({ 'index.html': 'a'.repeat(64), 'iem.html': 'b'.repeat(64), 'demo.html': 'c'.repeat(64) }));
  vm.runInNewContext(source, {
    self: { registration: { scope }, clients: { async claim() { claimed = true; } }, addEventListener(type, callback) { listeners[type] = callback; } },
    caches, fetch, URL, Request, Response, crypto: webcrypto,
  });
  return {
    storage, requests, get claimed() { return claimed; },
    async event(type, event = {}) { let work; listeners[type]({ ...event, waitUntil(promise) { work = promise; } }); await work; },
    async verify(required) { let result; await this.event('message', { data: { type: 'VERIFY_OFFLINE', ...(required ? { required } : {}) }, ports: [{ postMessage(value) { result = value; } }] }); return result; },
    async fetch(path, { mode = 'navigate', method = 'GET' } = {}) {
      let response;
      const url = new URL(path, scope).href;
      listeners.fetch({ request: { url, mode, method }, respondWith(promise) { response = promise; } });
      return response ? await response : undefined;
    },
    async cache() { return caches.open(`mixmate:${scope}:${version}`); },
  };
}

test('verification repairs missing same-version assets before claiming offline readiness', async () => {
  const sw = worker();
  await sw.event('install');
  (await sw.cache()).entries.delete(new URL('assets/app.js', scope).href);
  sw.requests.length = 0;
  assert.equal((await sw.verify()).ready, true);
  assert.equal(await (await sw.cache()).match(new URL('assets/app.js', scope).href).then(r => r.text()), bodies['assets/app.js']);
  assert.deepEqual(sw.requests, [new URL('assets/app.js', scope).href]);
});

test('offline cold root, index and mockup launches use only verified cached assets at the Pages subpath', async () => {
  const network = { ...bodies }, sw = worker({ network });
  await sw.event('install');
  for (const path of Object.keys(network)) delete network[path];
  sw.requests.length = 0;
  assert.equal(await (await sw.fetch('./')).text(), bodies['index.html']);
  assert.equal(await (await sw.fetch('index.html?launch=installed')).text(), bodies['index.html']);
  assert.equal(await (await sw.fetch('mockups/iem.html')).text(), bodies['mockups/iem.html']);
  assert.equal(await (await sw.fetch('assets/app.js', { mode: 'cors' })).text(), bodies['assets/app.js']);
  assert.deepEqual(sw.requests, []);
  assert.equal((await sw.verify()).ready, true);
});

test('verification stays false for missing assets offline and rejects newer deployment bytes', async () => {
  const network = { ...bodies }, sw = worker({ network });
  await sw.event('install');
  const cache = await sw.cache(), url = new URL('index.html', scope).href;
  cache.entries.delete(url);
  delete network['index.html'];
  assert.equal((await sw.verify()).ready, false);
  network['index.html'] = 'new deployment HTML';
  assert.equal((await sw.verify()).ready, false);
  assert.equal(await cache.match(url), undefined);
  await assert.rejects(sw.fetch('./'), /does not match/);
  network['index.html'] = bodies['index.html'];
  assert.equal((await sw.verify()).ready, true);
});

test('corrupt cached entries are not declared ready or served as valid offline assets', async () => {
  const network = { ...bodies }, sw = worker({ network });
  await sw.event('install');
  const cache = await sw.cache(), url = new URL('assets/app.js', scope).href;
  await cache.put(url, new Response('corrupted'));
  delete network['assets/app.js'];
  assert.equal((await sw.verify()).ready, false);
  await assert.rejects(sw.fetch('assets/app.js', { mode: 'cors' }), /Offline/);
  network['assets/app.js'] = bodies['assets/app.js'];
  assert.equal((await sw.verify()).ready, true);
});

test('failed precache preserves the previous complete worker cache without claiming clients', async () => {
  const storage = new Map(), old = worker({ storage });
  await old.event('install');
  const next = worker({ storage, version: 'v2', network: { 'index.html': bodies['index.html'] } });
  await assert.rejects(next.event('install'), /Offline/);
  assert.equal(next.claimed, false);
  assert.equal((await old.verify()).ready, true);
  assert.equal(await (await old.fetch('./')).text(), bodies['index.html']);
});

test('a successfully installed update waits; activation retires only this scope\'s older caches', async () => {
  const storage = new Map(), old = worker({ storage });
  await old.event('install');
  const unrelated = 'mixmate:https://example.test/other/:v0';
  storage.set(unrelated, new MemoryCache());
  const next = worker({ storage, version: 'v2' });
  await next.event('install');
  assert.equal(next.claimed, false);
  assert.ok(storage.has(`mixmate:${scope}:v1`));
  await next.event('activate');
  assert.equal(next.claimed, true);
  assert.ok(!storage.has(`mixmate:${scope}:v1`));
  assert.ok(storage.has(`mixmate:${scope}:v2`));
  assert.ok(storage.has(unrelated));
});

test('worker never intercepts mixer, external, other-scope, non-GET or unknown assets', async () => {
  const sw = worker();
  for (const [path, options] of [
    ['http://192.168.0.60/', {}], ['https://external.test/app.js', {}], ['/other/index.html', {}],
    ['assets/app.js', { method: 'POST' }], ['unlisted.js', {}],
  ]) assert.equal(await sw.fetch(path, options), undefined);
  assert.deepEqual(sw.requests, []);
});

test('install rejects HTTP errors, opaque/error responses and followed redirects', async () => {
  const redirected = new Response(bodies['index.html']);
  Object.defineProperty(redirected, 'redirected', { value: true });
  for (const response of [new Response('Not found', { status: 404 }), Response.error(), redirected]) {
    const sw = worker({ network: { ...bodies, 'index.html': response } });
    await assert.rejects(sw.event('install'), /does not match/);
    assert.equal(sw.claimed, false);
  }
});


test('known IEM/demo navigation queries use their own cached entry while unknown routes remain unintercepted', async () => {
  const network = { ...bodies }, sw = worker({ network }); await sw.event('install');
  for (const path of Object.keys(network)) delete network[path];
  assert.equal(await (await sw.fetch('iem.html?rig=local')).text(), bodies['iem.html']);
  assert.equal(await (await sw.fetch('demo.html?mode=demo')).text(), bodies['demo.html']);
  assert.equal(await sw.fetch('unlisted.html?route=demo'), undefined);
});

test('entry proof requires the actual HTML identity and every loaded module/style URL before ready', async () => {
  const sw = worker(); await sw.event('install');
  const required = { entry: new URL('index.html', scope).href, token: 'a'.repeat(64), assets: [new URL('index.html', scope).href, new URL('assets/app.js', scope).href] };
  const result = await sw.verify(required);
  assert.equal(result.ready, true);
  assert.equal(JSON.stringify(result.proof), JSON.stringify(required));
  assert.equal((await sw.verify({ ...required, token: 'd'.repeat(64) })).ready, false);
  assert.equal((await sw.verify({ ...required, assets: [...required.assets, new URL('assets/new-build.js', scope).href] })).ready, false);
  assert.equal((await sw.verify({ ...required, entry: 'https://outside.test/index.html' })).ready, false);
});
