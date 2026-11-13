// Network-first while you iterate; falls back to cache when offline.
const CACHE = 'kickabout-v16';
const ASSETS = ['./', 'index.html', 'game.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'img/sunglasses.png',
  ...['kick', 'tackle', 'bolt', 'bolt_on', 'nervous', 'skip'].map(n => `img/icon_${n}.svg`),
  ...['neutral', 'determined', 'celebrate', 'shocked', 'dizzy', 'sad', 'cheeky'].map(n => `skin/${n}.png`)];

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
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
