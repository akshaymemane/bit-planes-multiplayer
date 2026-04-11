const CACHE_NAME = 'bit-planes-v2';

const STATIC_ASSETS = [
  '/bit-planes/',
  '/bit-planes/index.html',
  '/bit-planes/styles37ad.css?5d2872322fef463c838c',
  '/bit-planes/index37ad.js?9f6e5c2d-performance',
  '/bit-planes/multiplayer-overlay.js',
  '/bit-planes/audio-manager.js?9f6e5c2d-performance',
  '/bit-planes/performance-fix.js',
  '/bit-planes/mobile-controls.js',
  '/bit-planes/mobile-controls.css',
  '/bit-planes/manifest.json',
  '/bit-planes/icon-192.svg',
  '/bit-planes/icon-512.svg',
  '/favicon.svg',
  '/bit-planes/sounds/cannon.wav',
  '/bit-planes/sounds/click.wav',
  '/bit-planes/sounds/engine.wav',
  '/bit-planes/sounds/explosion.wav',
  '/bit-planes/sounds/hit.wav',
  '/bit-planes/sounds/laser.wav',
  '/bit-planes/sounds/machine_gun.wav',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Cache what we can; non-critical failures are ignored
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for multiplayer API
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Network-first for external CDN (Howler.js)
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        return res;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
