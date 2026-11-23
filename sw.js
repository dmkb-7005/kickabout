// Network-first while you iterate; falls back to the cache when offline.
// Everything the game needs is precached, so a new version also works offline right after the update.
const CACHE = 'kickabout-v29';                // keep in sync with APP_VERSION in game.js
const NET_TIMEOUT = 2500;                     // ms to wait for the network when a cached copy exists
const OFFLINE_HOLD = 30000;                   // after a timeout/failure, use the cache straight away for this long
let offlineUntil = 0;
const ASSETS = ['./', 'index.html', 'game.js', 'shootout.js', 'manifest.webmanifest', 'lib/fflate.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'img/sunglasses.png',
  ...['kick', 'tackle', 'bolt', 'bolt_on', 'nervous', 'skip'].map(n => `img/icon_${n}.svg`),
  // self-hosted fonts (v27; before, they came from Google Fonts and needed internet)
  'fonts/fonts.css', 'fonts/baloo-2-latin-600-normal.woff2', 'fonts/baloo-2-latin-800-normal.woff2', 'fonts/permanent-marker-latin-400-normal.woff2',
  // the backyard theme (before v26 it was only cached on the fly, and every update wiped it)
  ...['backdrop.jpg', 'wall.jpg', 'gravel_grey.jpg', 'gravel_brown.jpg',
      'prop_palm.png', 'prop_bush.png', 'prop_tree.png', 'prop_house.png', 'prop_car.png'].map(f => `theme/backyard/${f}`)];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// v29: a network request that hangs (airplane mode, flaky Wi-Fi) must never block the start.
// With a cached copy we wait at most NET_TIMEOUT – and not at all when the device says it is offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    if (cached && ((self.navigator && self.navigator.onLine === false) || Date.now() < offlineUntil)) return cached;
    const net = fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }   // never cache an error page
      return res;
    });
    if (!cached) return net;
    net.catch(() => {});                                     // (a late failure is fine – the cached copy was used)
    const timeout = new Promise(r => setTimeout(() => r(null), NET_TIMEOUT));
    try {
      const res = await Promise.race([net, timeout]);
      if (!res) offlineUntil = Date.now() + OFFLINE_HOLD;    // too slow: treat the network as gone for a while
      return res && res.ok ? res : cached;                   // too slow or an error page → cached copy
    } catch (_) { offlineUntil = Date.now() + OFFLINE_HOLD; return cached; }   // no network → cached copy
  })());
});
