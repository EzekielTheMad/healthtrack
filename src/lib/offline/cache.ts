// Cache critical health data in IndexedDB for offline viewing
// DB: healthtrack-offline, Store: cached-data

export interface CachedData {
  userId: string;
  medications?: unknown[];
  conditions?: unknown[];
  recentVitals?: unknown[];
  recentLabs?: unknown[];
  cachedAt: number;
}

const DB_NAME = 'healthtrack-offline';
const DB_VERSION = 1;
const STORE_NAME = 'cached-data';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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

/**
 * Cache health data for offline viewing, keyed by userId.
 */
export async function cacheHealthData(
  userId: string,
  data: {
    medications?: unknown[];
    conditions?: unknown[];
    recentVitals?: unknown[];
    recentLabs?: unknown[];
  }
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  const record: CachedData = {
    userId,
    ...data,
    cachedAt: Date.now(),
  };

  store.put(record);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

/**
 * Retrieve cached health data for a given user.
 * Returns null if no cached data is found.
 */
export async function getCachedHealthData(
  userId: string
): Promise<CachedData | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  const result = await new Promise<CachedData | null>((resolve, reject) => {
    const req = store.get(userId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });

  db.close();
  return result;
}
