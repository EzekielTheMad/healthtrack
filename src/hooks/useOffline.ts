'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { enqueueAction, getQueueLength, dequeueActions } from '@/lib/offline/queue';

export function useOffline() {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingActions, setPendingActions] = useState(0);
  const syncingRef = useRef(false);

  // Track online/offline state
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Poll pending action count
  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const count = await getQueueLength();
        if (mounted) setPendingActions(count);
      } catch {
        // IndexedDB may be unavailable
      }
    };

    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  /**
   * Enqueue an action for later replay and register background sync if available.
   */
  const enqueue = useCallback(
    async (url: string, method: string, body: unknown) => {
      await enqueueAction(url, method, body);
      setPendingActions((prev) => prev + 1);

      // Register background sync if supported
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        try {
          const reg = await navigator.serviceWorker.ready;
          await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('offline-queue');
        } catch {
          // Background sync not available — syncNow() will handle it
        }
      }
    },
    []
  );

  /**
   * Manually replay the offline queue (e.g. when back online).
   */
  const syncNow = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    try {
      const actions = await dequeueActions();
      for (const action of actions) {
        try {
          await fetch(action.url, {
            method: action.method,
            headers: { 'Content-Type': 'application/json' },
            body: action.body,
          });
        } catch {
          // If a replay fails, re-enqueue remaining actions
          await enqueueAction(action.url, action.method, JSON.parse(action.body));
          break;
        }
      }
      const remaining = await getQueueLength();
      setPendingActions(remaining);
    } finally {
      syncingRef.current = false;
    }
  }, []);

  return { isOnline, pendingActions, enqueue, syncNow };
}
