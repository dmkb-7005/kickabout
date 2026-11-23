// Network-first while you iterate; falls back to cache when offline.
// Everything the game needs is precached, so a new version also works offline right after the update.
const CACHE = 'kickabout-v28';                // keep in sync with APP_VERSION in game.js
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
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (!res.ok) return caches.match(e.request, { ignoreSearch: true }).then(hit => hit || res);   // never cache an error page
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
