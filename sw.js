/* Blackrow Trails service worker — offline app shell + map tile caching.
 * Lets previously-viewed areas load with no signal (backcountry use). */
const SHELL_CACHE = 'trail-shell-v1';
const TILE_CACHE  = 'trail-tiles-v1';
const MAX_TILES   = 1500;            // ~ a few regions at trail zooms

// Dev cache-buster: on localhost, serve the app shell network-first so edits show
// immediately. In the packaged native app (capacitor:// / https://localhost is the
// app's own origin but served from disk) this stays cache-first for offline use.
const DEV = /^(localhost|127\.0\.0\.1)$/.test(self.location.hostname) &&
            self.location.port !== '';   // a real dev server has a port; native build does not

const SHELL_ASSETS = [
  './',
  './index.html',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => Promise.allSettled(SHELL_ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE)
        .map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const isTile = (url) =>
  /tile\.opentopomap\.org/.test(url) ||
  /\.tile\.openstreetmap\.org/.test(url) ||
  /\/tile[s]?\//.test(url);

// Trim the tile cache so it can't grow without bound.
async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // Map tiles: cache-first (serve offline), then network + store.
  if (isTile(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req, { mode: 'no-cors' });
        cache.put(req, res.clone());
        trimTiles();
        return res;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }

  // App shell (same-origin + Leaflet CDN).
  if (req.destination === 'document' || SHELL_ASSETS.some((a) => url.endsWith(a.replace('./', '')))) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const fromNet = () => fetch(req).then((res) => { cache.put(req, res.clone()); return res; });
      if (DEV) {
        // Dev: network-first so edits show on reload; fall back to cache if offline.
        try { return await fromNet(); } catch { return (await cache.match(req, { ignoreSearch: true })) || Response.error(); }
      }
      // Prod: cache-first with background refresh.
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit || (await fromNet().catch(() => null)) || Response.error();
    })());
  }

  // Live data API calls (USGS/PAD-US) are intentionally NOT cached — always fresh.
});
