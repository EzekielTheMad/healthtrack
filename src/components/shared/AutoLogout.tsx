'use client';

import { useEffect, useRef, useCallback } from 'react';
import { authClient } from '@/lib/auth/client';

interface AutoLogoutProps {
  timeoutMinutes: number;
}

export function AutoLogout({ timeoutMinutes }: AutoLogoutProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutMs = timeoutMinutes * 60 * 1000;

  const handleLogout = useCallback(async () => {
    await authClient.signOut();
    window.location.href = '/login?reason=timeout';
  }, []);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(handleLogout, timeoutMs);
  }, [handleLogout, timeoutMs]);

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);

  return null;
}
