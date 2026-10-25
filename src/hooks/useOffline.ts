'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getQueueLength } from '@/lib/offline/queue';
function subscribeOnline(notify: () => void) {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}
const onlineSnapshot = () => navigator.onLine;
const serverOnlineSnapshot = () => true;
export function useOffline() {
  const isOnline = useSyncExternalStore(subscribeOnline, onlineSnapshot, serverOnlineSnapshot);
  const [pendingActions, setPendingActions] = useState(0);
  useEffect(() => {
    let alive = true;
    getQueueLength()
      .then((count) => {
        if (alive) setPendingActions(count);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const enqueue = useCallback(async () => {
    throw new Error(
      'Reconnect before saving. Offline clinical editing is unavailable; keep this form open to retain your draft.'
    );
  }, []);
  // Retained for compatibility: legacy actions have no account/subject binding.
  const syncNow = useCallback(async () => {}, []);
  return { isOnline, pendingActions, enqueue, syncNow };
}
