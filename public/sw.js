// HealthTrack Service Worker — vanilla, no workbox
const CACHE_NAME = 'healthtrack-v1';

const APP_SHELL_ROUTES = [
  '/',
  '/dashboard',
  '/medications',
  '/conditions',
  '/vitals',
  '/labs',
  '/notes',
  '/appointments',
  '/query',
  '/settings',
  '/login',
];

// ------------------------------------------------------------------
// Install — pre-cache the app shell
// ------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pre-cache navigation routes (best-effort — some may 404 during first
      // install before the user has visited them, so we swallow individual errors).
      return Promise.allSettled(
        APP_SHELL_ROUTES.map((route) =>
          cache.add(route).catch(() => {
            // Route might not be reachable yet — that is fine; we will cache it
            // on the first successful navigation via the fetch handler.
          })
        )
      );
    })
  );
});

// ------------------------------------------------------------------
// Activate — clean up old caches
// ------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Start controlling all open clients immediately
  self.clients.claim();
});

// ------------------------------------------------------------------
// Fetch — routing strategy
// ------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. API requests — network only
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Cross-origin requests (optional integrations) — network only
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  // 3. Navigation requests (HTML) — network first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a copy of the successful response
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // 4. Static assets (JS, CSS, fonts, images) — cache first, fallback to network
  const isStaticAsset =
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/) ||
    url.pathname.startsWith('/_next/static/');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
      )
    );
    return;
  }

  // 5. Everything else — network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ------------------------------------------------------------------
// Background sync — replay offline action queue
// ------------------------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag === 'offline-queue') {
    event.waitUntil(replayOfflineQueue());
  }
});

async function replayOfflineQueue() {
  const db = await openOfflineDB();
  const tx = db.transaction('actions', 'readwrite');
  const store = tx.objectStore('actions');

  const actions = await idbGetAll(store);
  for (const action of actions) {
    try {
      await fetch(action.url, {
        method: action.method,
        headers: { 'Content-Type': 'application/json' },
        body: action.body,
      });
      // Remove successfully replayed action
      const delTx = db.transaction('actions', 'readwrite');
      delTx.objectStore('actions').delete(action.id);
      await idbTxDone(delTx);
    } catch {
      // If a request fails, stop replaying — we will retry on next sync
      break;
    }
  }
  db.close();
}

// ------------------------------------------------------------------
// Message handler — skip waiting on demand
// ------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ------------------------------------------------------------------
// IndexedDB helpers (minimal, for background sync only)
// ------------------------------------------------------------------
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('healthtrack-offline', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('actions')) {
        db.createObjectStore('actions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('cached-data')) {
        db.createObjectStore('cached-data', { keyPath: 'userId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
