'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
const KEY = 'healthtrack.presentation.android.v1';
const AndroidContext = createContext(false);
function snapshot() {
  if (new URLSearchParams(window.location.search).get('app') === 'android') return true;
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function subscribe(listener: () => void) {
  if (new URLSearchParams(window.location.search).get('app') === 'android') {
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      /* presentation works without storage */
    }
  }
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}
/** Presentation only. Never use this flag for authorization or subject selection. */
export function AndroidModeProvider({ children }: { children: React.ReactNode }) {
  const android = useSyncExternalStore(subscribe, snapshot, () => false);
  return <AndroidContext.Provider value={android}>{children}</AndroidContext.Provider>;
}
export function useAndroidMode() {
  return useContext(AndroidContext);
}
export function leaveAndroidPresentation() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* optional storage */
  }
}
export function nativeActionHref(action: 'sync' | 'doctor') {
  return `intent://${action}#Intent;scheme=healthtrack;package=com.omnihealthtracker.app;end`;
}
