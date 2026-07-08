'use client';

import { useEffect, useState } from 'react';
import { useOffline } from '@/hooks/useOffline';

export function OfflineIndicator() {
  const { isOnline, pendingActions, syncNow } = useOffline();
  const [showReconnected, setShowReconnected] = useState(false);

  // The offline banner is derived directly from isOnline. The transient
  // "back online" banner is driven by the browser's connectivity events
  // (the external system), with state updates only inside the callbacks.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const handleOnline = () => {
      // Just came back online
      setShowReconnected(true);
      syncNow();
      timer = setTimeout(() => setShowReconnected(false), 3000);
    };

    const handleOffline = () => {
      if (timer) clearTimeout(timer);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (timer) clearTimeout(timer);
    };
  }, [syncNow]);

  const reconnected = isOnline && showReconnected;

  if (isOnline && !showReconnected) return null;

  const bannerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    padding: '8px 16px',
    textAlign: 'center',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'opacity 0.3s ease, background-color 0.3s ease',
    opacity: 1,
    backgroundColor: reconnected ? 'var(--color-sage)' : 'var(--color-warning)',
    color: 'var(--color-bark)',
  };

  return (
    <div style={bannerStyle} role="status" aria-live="polite">
      {reconnected ? (
        'Back online — syncing...'
      ) : (
        <>
          You&apos;re offline — changes will sync when reconnected
          {pendingActions > 0 && (
            <span style={{ marginLeft: 12, fontWeight: 600 }}>
              {pendingActions} pending change{pendingActions !== 1 ? 's' : ''}
            </span>
          )}
        </>
      )}
    </div>
  );
}
