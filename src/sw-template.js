const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const HASHES = __HASHES__;
const ENTRY_PROOFS = __ENTRY_PROOFS__;
const SCOPE = self.registration.scope;
const PREFIX = `mixmate:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;
const URLS = ASSETS.map(path => new URL(path, SCOPE).href);
const EXPECTED = new Map(ASSETS.map((path, i) => [URLS[i], HASHES[path]]));
async function matchesVersion(response, url) {
  if (!response?.ok || response.redirected) return false;
  const hash = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return hex === EXPECTED.get(url);
}
async function download(url) {
  const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (!await matchesVersion(response, url)) throw new Error('Asset does not match this offline version.');
  return response;
}
async function verifiedAsset(cache, url) {
  const cached = await cache.match(url);
  if (await matchesVersion(cached, url)) return cached;
  // Never mix a newer deployment's unversioned HTML/manifest into this cache.
  const response = await download(url);
  await cache.put(url, response.clone());
  return response;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const responses = await Promise.all(URLS.map(download));
    const cache = await caches.open(CACHE);
    await Promise.all(URLS.map((url, i) => cache.put(url, responses[i])));
  })());
  // Updates wait for existing app windows to close; never replace a live session.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!url.href.startsWith(SCOPE)) return; // Never cache or proxy mixer traffic.
  const knownEntry = ['index.html', 'iem.html', 'demo.html', 'connection-test.html'].map(path => new URL(path, SCOPE)).find(entry => entry.pathname === url.pathname);
  const target = request.mode === 'navigate'
    ? url.pathname === new URL(SCOPE).pathname ? new URL('index.html', SCOPE).href : knownEntry?.href || url.href
    : url.href;
  if (!EXPECTED.has(target)) return;
  event.respondWith(caches.open(CACHE).then(cache => verifiedAsset(cache, target)));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'VERIFY_OFFLINE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const required = event.data.required;
      let proof;
      if (required !== undefined) {
        if (!required || typeof required.entry !== 'string' || typeof required.token !== 'string' || !Array.isArray(required.assets) || required.assets.length > 64 || required.assets.some(url => typeof url !== 'string' || !EXPECTED.has(url)) || !required.assets.includes(required.entry)) throw new Error('Unknown entry assets.');
        const path = required.entry.startsWith(SCOPE) ? required.entry.slice(SCOPE.length) : '';
        if (!ENTRY_PROOFS[path] || ENTRY_PROOFS[path] !== required.token) throw new Error('Entry belongs to another version.');
        proof = { entry: required.entry, token: required.token, assets: required.assets };
      }
      const cache = await caches.open(CACHE);
      await Promise.all(URLS.map(url => verifiedAsset(cache, url)));
      event.ports[0].postMessage({ ready: true, version: VERSION, ...(proof ? { proof } : {}) });
    } catch { event.ports[0].postMessage({ ready: false, version: VERSION }); }
  })());
});
