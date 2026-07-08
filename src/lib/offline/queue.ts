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
  url: string,
  method: string,
  body: unknown
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  const action: OfflineAction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    url,
    method,
    body: JSON.stringify(body),
    timestamp: Date.now(),
  };

  store.add(action);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

/**
 * Returns and removes all queued actions (sorted by timestamp).
 */
export async function dequeueActions(): Promise<OfflineAction[]> {
  const db = await openDB();

  // Read all actions
  const readTx = db.transaction(STORE_NAME, 'readonly');
  const readStore = readTx.objectStore(STORE_NAME);
  const actions = await new Promise<OfflineAction[]>((resolve, reject) => {
    const req = readStore.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  // Sort by timestamp ascending
  actions.sort((a, b) => a.timestamp - b.timestamp);

  // Clear the store
  if (actions.length > 0) {
    const clearTx = db.transaction(STORE_NAME, 'readwrite');
    clearTx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      clearTx.oncomplete = () => resolve();
      clearTx.onerror = () => reject(clearTx.error);
    });
  }

  db.close();
  return actions;
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
