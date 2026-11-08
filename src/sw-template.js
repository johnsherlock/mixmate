const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const SCOPE = self.registration.scope;
const PREFIX = `mixmate:${SCOPE}:`;
const CACHE = `${PREFIX}${VERSION}`;
const URLS = ASSETS.map(path => new URL(path, SCOPE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS)));
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
  const target = request.mode === 'navigate' && (url.pathname === new URL(SCOPE).pathname || url.pathname === new URL('index.html', SCOPE).pathname)
    ? new URL('index.html', SCOPE).href : url.href;
  if (!URLS.includes(target)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(target)) || fetch(request)));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'VERIFY_OFFLINE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const complete = (await Promise.all(URLS.map(url => cache.match(url)))).every(Boolean);
      event.ports[0].postMessage({ ready: complete, version: VERSION });
    } catch { event.ports[0].postMessage({ ready: false }); }
  })());
});
