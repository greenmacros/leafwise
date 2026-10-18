// Service worker template. The build (vite.config.ts) substitutes the build id and the precache list below.
// Strategy: pages are network-first (so a new deploy shows up fast) and fall back to the cache offline;
// built assets are cache-first. A new worker waits until the page asks it to take over (SKIP_WAITING),
// so an update never swaps code under someone who is in the middle of editing.
const CACHE = 'leafwise-__BUILD__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // cache: 'reload' skips the HTTP cache so we never store a stale index.html next to new assets
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('leafwise-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
