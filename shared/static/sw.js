const CACHE = 'veyra-v3';
const STATIC = [
  '/static/login.css',
  '/static/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept API calls, non-GET, or cross-origin
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/pug/api/')) return;

  // Static assets: cache-first. The fetch can reject (offline, or a privacy
  // extension blocking an asset by name e.g. cookie-consent.js) — catch it so a
  // rejected promise never reaches respondWith and spams uncaught SW errors.
  if (url.pathname.startsWith('/static/') ||
      url.pathname.match(/\.(css|js|png|jpg|woff2?)$/)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })).catch(() => caches.match(e.request).then(c => c || Response.error()))
    );
    return;
  }

  // HTML pages: network-first, fall back to cache
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
