// IndexedDB-based offline action queue
// DB: healthtrack-offline, Store: actions

export interface OfflineAction {
  id: string;
  url: string;
  method: string;
  body: string;
  timestamp: number;
}

const DB_NAME = 'healthtrack-offline';
const DB_VERSION = 1;
const STORE_NAME = 'actions';

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
 * Stores an action in IndexedDB for later replay when back online.
 */
export async function enqueueAction(
  _url: string,
  _method: string,
  _body: unknown
): Promise<void> {
  void _url; void _method; void _body;
  throw new Error('Offline clinical editing is disabled. Reconnect before saving; retain your draft in the current form.');
}

/**
 * Legacy compatibility: quarantined actions cannot be replayed or consumed.
 */
export async function dequeueActions(): Promise<OfflineAction[]> {
  // Legacy actions lack an account and subject binding. Quarantine in place.
  return [];
}

/**
 * Returns the count of pending actions.
 */
export async function getQueueLength(): Promise<number> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  const count = await new Promise<number>((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  db.close();
  return count;
}

/**
 * Clears all queued actions.
 */
export async function clearQueue(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}
