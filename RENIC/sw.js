// RENI Service Worker (Mobile PWA v3.0)
const CACHE_NAME = 'reni-pwa-v3.0';
const ASSETS_TO_PRECACHE = [
  '/',
  '/index.html?v=3.0',
  '/style.css?v=3.0',
  '/app.js?v=3.0',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_PRECACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Let WebSocket and API requests bypass cache completely
  if (event.request.url.includes('/ws/') || event.request.url.includes('/api/')) {
    return;
  }

  // Network-First with Cache Fallback for dynamic PWA asset delivery
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
