// Caches static assets so the PWA opens fast from the Home Screen.
// Page navigations (sign-in state) and API calls always go to the local server.
const CACHE = 'io-offline-v3';
const ASSETS = ['styles.css', 'app.js', 'login.css', 'login.js', 'icon-180.png', 'manifest.webmanifest', 'brand/io-logo.png', 'brand/io-mark.png', 'brand/profspect-white.png', 'brand/profspect-colour.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || e.request.mode === 'navigate' || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request)));
});
