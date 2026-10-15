const SHELL_CACHE = 'forja-shell-v29';
const MEDIA_CACHE = 'forja-media-v3';
const OFFLINE_MEDIA_CACHE = 'forja-media-v2';
const MAX_MEDIA_CACHE_ENTRIES = 180;
const CORE = ['./', './index.html', './styles.css', './forja-core.js', './app.js', './features.js', './storage.js', './sync.js', './analytics.js', './workout-ui.js', './vendor/muscle-map.js', './exercise-media.json', './dataset-exercises.json', './manifest.json', './manifest-light.json', './icon.svg'];
const SHELL_URLS = new Set(CORE.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => (key.startsWith('forja-shell-') && key !== SHELL_CACHE) || (key.startsWith('forja-media-') && key !== MEDIA_CACHE && key !== OFFLINE_MEDIA_CACHE))
    .map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const url = new URL(request.url);
    if (url.pathname.includes('/exercise-assets/')) {
      const offlineMedia = await caches.open(OFFLINE_MEDIA_CACHE);
      const explicitlySaved = await offlineMedia.match(request);
      if (explicitlySaved) return explicitlySaved;
      const media = await caches.open(MEDIA_CACHE);
      const cached = await media.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          try {
            await media.put(request, response.clone());
            const keys = await media.keys();
            const overflow = keys.length - MAX_MEDIA_CACHE_ENTRIES;
            if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((key) => media.delete(key)));
          } catch {}
        }
        return response;
      } catch {
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><rect width="320" height="220" rx="20" fill="#edf1e8"/><path d="M138 62h44v44h-44zM82 153l38-39 29 28 21-19 49 49H82z" fill="#9ba796"/><text x="160" y="195" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#485348">Conéctate para cargar esta imagen</text></svg>', { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } });
      }
    }
    try {
      const response = await fetch(request);
      if (response.ok && SHELL_URLS.has(request.url)) {
        const shell = await caches.open(SHELL_CACHE);
        await shell.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return (await caches.match(new URL('./index.html', self.registration.scope).href)) || Response.error();
      return Response.error();
    }
  })());
});
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Hora de entrenar · Forja', {
    body: payload.body || 'Tu sesión te espera. Abre Forja cuando estés listo.',
    icon: './icon.svg', badge: './icon.svg', tag: payload.tag || `forja-push-${new Date().toISOString().slice(0, 10)}`,
    data: { url: payload.url || './' }, renotify: false
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (!existing) return self.clients.openWindow(target);
    return existing.navigate(target).then((client) => (client || existing).focus());
  }));
});
