const CACHE_NAME = 'nowarfy-shell-v45';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/styles-secondary.css',
  '/script.js',
  '/modules/storage.js',
  '/modules/core.js',
  '/modules/state-and-taste.js',
  '/modules/catalog.js',
  '/modules/reserve.js',
  '/modules/playback-queue.js',
  '/modules/lyrics-video.js',
  '/modules/player-pwa.js',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/assets/favicon-32.png',
  '/assets/nowarfy-icon-192.png',
  '/assets/nowarfy-icon-512.png',
  '/assets/nowarfy-apple-touch-icon.png',
  '/assets/nowarfy-logo-red-solid.png',
  '/assets/nowarfy-qr.png'
];

async function cachePut(request, response) {
  if (!response?.ok) return response;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Un recurso opcional no debe impedir que la PWA quede disponible.
    await Promise.allSettled(APP_SHELL.map(async path => {
      try {
        const response = await fetch(path, { cache: 'no-cache' });
        if (response.ok) await cache.put(path, response);
      } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // El HTML se actualiza primero desde la red para no ocultar despliegues nuevos.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => cachePut('/index.html', response))
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // script.js, los módulos y styles.css: stale-while-revalidate. Se sirven al instante desde cache y se
  // revalidan en segundo plano (sin pasar por la cache HTTP), asi que un deploy nuevo llega
  // en la visita siguiente aunque no se suba CACHE_NAME.
  if (url.pathname === '/script.js' || url.pathname === '/styles.css' || url.pathname.startsWith('/modules/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const refresh = fetch(request, { cache: 'no-cache' })
        .then(response => cachePut(request, response))
        .catch(() => cached);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      return refresh;
    })());
    return;
  }

  // Manifest, favicon e imagenes de /assets: cache-first (los assets llevan cache inmutable).
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && (url.pathname === '/manifest.webmanifest' || url.pathname === '/favicon.ico' || url.pathname.startsWith('/assets/'))) {
        event.waitUntil(cachePut(request, response));
      }
      return response;
    }))
  );
});
