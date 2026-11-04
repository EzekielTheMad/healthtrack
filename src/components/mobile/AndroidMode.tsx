'use client';

import { createContext, useContext, useSyncExternalStore } from 'react';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useSession } from '@/lib/auth/client';
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
type NativeReturnContext = {
  origin: string;
  accountId: string;
  dependentId: string | null;
  ownerId: string | null;
};
const CONTEXT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const isContextId = (value: unknown): value is string =>
  typeof value === 'string' && CONTEXT_ID.test(value);
export function nativeActionHref(action: 'sync' | 'doctor', context: NativeReturnContext) {
  let origin: URL;
  try {
    origin = new URL(context.origin);
  } catch {
    return null;
  }
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !isContextId(context.accountId) ||
    (context.dependentId !== null && !isContextId(context.dependentId)) ||
    (context.ownerId !== null && !isContextId(context.ownerId)) ||
    (context.dependentId !== null && context.ownerId !== null)
  )
    return null;
  // A fresh browser launch loses in-memory person selection. The existing
  // BrowserSubjectGate checks this public return context before rendering any
  // records. Native code never uses it as phone ownership or an offline grant.
  const scope = new URLSearchParams({
    app: 'android',
    browser_subject: context.dependentId ? 'dependent' : context.ownerId ? 'owner' : 'self',
    account_id: context.accountId,
  });
  if (context.dependentId) scope.set('dependent_id', context.dependentId);
  if (context.ownerId) scope.set('owner_id', context.ownerId);
  const path = action === 'sync' ? '/mobile/devices' : '/mobile/doctor';
  const returnTo = `${path}?${scope}`;
  // The origin is only a binding check for the configured instance, never a
  // command to switch the native app to another server.
  const params = new URLSearchParams({ return_to: returnTo, return_origin: origin.origin });
  return `intent://${action}?${params}#Intent;scheme=healthtrack;package=com.omnihealthtracker.app;end`;
}
export function useNativeActionHref(action: 'sync' | 'doctor') {
  const { data: session, isPending } = useSession();
  const { dependentId, delegateOwnerId } = useActiveProfile();
  if (isPending || !session?.user.id || typeof window === 'undefined') return null;
  return nativeActionHref(action, {
    origin: window.location.origin,
    accountId: session.user.id,
    dependentId,
    ownerId: delegateOwnerId,
  });
}
