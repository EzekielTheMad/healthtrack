// Only public build assets are eligible for caching. Clinical HTML, RSC, API
// responses, uploads and arbitrary extension-looking URLs are always network-only.
const CACHE_NAME = 'healthtrack-public-v2';
const PUBLIC_FILES = new Set(['/offline.html', '/icon.png', '/icon-192.png', '/icon-512.png', '/manifest.json']);
const OWN_LEGACY_CACHES = new Set(['healthtrack-v1']);
function publicAsset(url, request) {
  return request.method === 'GET' && url.origin === self.location.origin && !url.search &&
    (PUBLIC_FILES.has(url.pathname) || (url.pathname.startsWith('/_next/static/') && !url.pathname.includes('..')));
}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['/offline.html'])));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Delete only known HealthTrack caches, never caches belonging to other apps.
    for (const key of await caches.keys()) {
      if (OWN_LEGACY_CACHES.has(key) || (key.startsWith('healthtrack-public-') && key !== CACHE_NAME)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE_NAME)).match('/offline.html')));
    return;
  }
  if (!publicAsset(url, request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const existing = await cache.match(request);
    if (existing) return existing;
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque' && !response.redirected && !/private|no-store/i.test(response.headers.get('Cache-Control') || '') && !response.headers.get('Content-Type')?.includes('text/html')) await cache.put(request, response.clone());
    return response;
  })());
});
// Old unscoped offline actions are intentionally left in IndexedDB for review.
// Never replay them under whichever account or person happens to be signed in.
self.addEventListener('message', (event) => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
