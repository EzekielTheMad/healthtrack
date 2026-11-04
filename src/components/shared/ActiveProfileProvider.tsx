'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { DelegatePermissionLevel } from '@/lib/types';
import { useSession } from '@/lib/auth/client';
import { validateBrowserSubject } from '@/lib/browser-subject';
import HandoffAccountRecovery from '@/components/mobile/HandoffAccountRecovery';

interface ActiveProfileState {
  dependentId: string | null;
  dependentName: string | null;
  setActiveProfile: (id: string | null, name: string | null) => void;
  // Delegate mode
  delegateOwnerId: string | null;
  delegateOwnerName: string | null;
  delegatePermission: DelegatePermissionLevel | null;
  setDelegateProfile: (
    ownerId: string | null,
    name: string | null,
    permission: DelegatePermissionLevel | null
  ) => void;
}

const ActiveProfileContext = createContext<ActiveProfileState>({
  dependentId: null,
  dependentName: null,
  setActiveProfile: () => {},
  delegateOwnerId: null,
  delegateOwnerName: null,
  delegatePermission: null,
  setDelegateProfile: () => {},
});

type Selection = Pick<
  ActiveProfileState,
  'dependentId' | 'dependentName' | 'delegateOwnerId' | 'delegateOwnerName' | 'delegatePermission'
>;
const SELF: Selection = {
  dependentId: null,
  dependentName: null,
  delegateOwnerId: null,
  delegateOwnerName: null,
  delegatePermission: null,
};
export const activeProfileStorageKey = (actorId: string) =>
  `healthtrack.person.v1:${encodeURIComponent(actorId)}`;
type Restoration = { key: string; selection: Selection; error?: string; notice?: string };
function remember(actorId: string, selection: Selection) {
  try {
    const id = selection.dependentId ?? selection.delegateOwnerId;
    if (!id) sessionStorage.removeItem(activeProfileStorageKey(actorId));
    else
      sessionStorage.setItem(
        activeProfileStorageKey(actorId),
        JSON.stringify({ version: 1, kind: selection.dependentId ? 'dependent' : 'owner', id })
      );
    return undefined;
  } catch {
    return 'This browser could not remember the selected person for a page reload.';
  }
}

function updateHandoffSelection(actorId: string, selection: Selection) {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('browser_subject')) return;
    url.searchParams.set(
      'browser_subject',
      selection.dependentId ? 'dependent' : selection.delegateOwnerId ? 'owner' : 'self'
    );
    url.searchParams.set('account_id', actorId);
    url.searchParams.delete('dependent_id');
    url.searchParams.delete('owner_id');
    if (selection.dependentId) url.searchParams.set('dependent_id', selection.dependentId);
    if (selection.delegateOwnerId) url.searchParams.set('owner_id', selection.delegateOwnerId);
    if (url.href !== window.location.href)
      window.history.replaceState(window.history.state, '', url);
  } catch {
    return 'This browser could not update the selected person in the page address. Check the person again after reloading.';
  }
}

export function ActiveProfileProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const actorId = session?.user.id ?? null;
  const identity = isPending
    ? 'pending'
    : actorId
      ? `${actorId}:${session?.session?.id ?? ''}`
      : '';
  const [boundary, setBoundary] = useState({ identity, epoch: 0 });
  let epoch = boundary.epoch;
  // Invalidate before children render, including logout and same-account re-login.
  if (boundary.identity !== identity) {
    epoch += 1;
    setBoundary({ identity, epoch });
  }
  const [attempt, setAttempt] = useState(0);
  const key = `${identity}:${epoch}:${attempt}`;
  const activeKey = useRef<string | null>(null);
  const [restored, setRestored] = useState<Restoration>({ key: '', selection: SELF });

  useEffect(() => {
    if (!actorId || isPending) return;
    const controller = new AbortController();
    activeKey.current = key;
    async function restore() {
      await Promise.resolve();
      try {
        // Explicit native/browser return context is checked by BrowserSubjectGate.
        const explicit = new URLSearchParams(window.location.search).has('browser_subject');
        const raw = explicit ? null : sessionStorage.getItem(activeProfileStorageKey(actorId!));
        let selection = SELF;
        if (raw !== null) {
          const saved: unknown = JSON.parse(raw);
          if (!saved || typeof saved !== 'object' || Array.isArray(saved))
            throw new Error('The saved person selection is unavailable.');
          const value = saved as Record<string, unknown>;
          if (
            value.version !== 1 ||
            !['dependent', 'owner'].includes(String(value.kind)) ||
            typeof value.id !== 'string' ||
            !value.id ||
            value.id.length > 200 ||
            Object.keys(value).some((name) => !['version', 'kind', 'id'].includes(name))
          )
            throw new Error('The saved person selection is unavailable.');
          const params = new URLSearchParams({
            browser_subject: String(value.kind),
            account_id: actorId!,
          });
          params.set(value.kind === 'dependent' ? 'dependent_id' : 'owner_id', value.id);
          const result = await validateBrowserSubject(params, controller.signal, actorId);
          if (result.kind === 'dependent')
            selection = {
              ...SELF,
              dependentId: result.dependent.id,
              dependentName: result.dependent.name,
            };
          else if (result.kind === 'owner')
            selection = {
              ...SELF,
              delegateOwnerId: result.delegate.owner_id,
              delegateOwnerName: result.delegate.owner_display_name ?? 'Shared account',
              delegatePermission: result.delegate.permission_level,
            };
        }
        if (!controller.signal.aborted) setRestored({ key, selection });
      } catch (error) {
        if (!controller.signal.aborted)
          setRestored({
            key,
            selection: SELF,
            error:
              error instanceof Error ? error.message : 'Could not restore the selected person.',
          });
      }
    }
    void restore();
    return () => {
      controller.abort();
      if (activeKey.current === key) activeKey.current = null;
    };
  }, [actorId, isPending, key]);

  const choose = useCallback(
    (selection: Selection) => {
      if (!actorId || activeKey.current !== key) return;
      const storageNotice = remember(actorId, selection);
      const handoffNotice = updateHandoffSelection(actorId, selection);
      setRestored({ key, selection, notice: storageNotice ?? handoffNotice });
    },
    [actorId, key]
  );
  const setActiveProfile = useCallback(
    (id: string | null, name: string | null) => {
      choose(id ? { ...SELF, dependentId: id, dependentName: name } : SELF);
    },
    [choose]
  );
  const setDelegateProfile = useCallback(
    (ownerId: string | null, name: string | null, permission: DelegatePermissionLevel | null) => {
      choose(
        ownerId
          ? {
              ...SELF,
              delegateOwnerId: ownerId,
              delegateOwnerName: name,
              delegatePermission: permission,
            }
          : SELF
      );
    },
    [choose]
  );

  if (isPending || (actorId && restored.key !== key))
    return (
      <p role="status" className="p-6">
        Restoring selected person…
      </p>
    );
  if (!actorId)
    return (
      <div role="alert" className="p-6 space-y-3">
        <p>Your session has expired. Sign in again to continue.</p>
        <HandoffAccountRecovery
          signedIn={false}
          returnTo={
            typeof window === 'undefined'
              ? '/health'
              : `${window.location.pathname}${window.location.search}`
          }
        />
      </div>
    );
  if (actorId && restored.error)
    return (
      <div role="alert" className="p-6 space-y-3">
        <p>{restored.error}</p>
        <p>Choose My Health to continue, or try restoring this person again.</p>
        <button type="button" className="underline mr-4" onClick={() => choose(SELF)}>
          Use My Health
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  const selected = actorId && restored.key === key ? restored.selection : SELF;

  return (
    <ActiveProfileContext.Provider
      value={{
        ...selected,
        setActiveProfile,
        setDelegateProfile,
      }}
    >
      {restored.notice && actorId && (
        <p role="status" className="p-3 text-sm">
          {restored.notice}
        </p>
      )}
      {children}
    </ActiveProfileContext.Provider>
  );
}

export function useActiveProfile() {
  return useContext(ActiveProfileContext);
}
