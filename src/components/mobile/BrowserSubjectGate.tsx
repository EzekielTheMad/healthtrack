'use client';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useSession } from '@/lib/auth/client';
import type { Delegate, Dependent } from '@/lib/types';
import HandoffAccountRecovery from './HandoffAccountRecovery';
export async function validateBrowserSubject(
  params: URLSearchParams,
  signal: AbortSignal,
  actorId: string | null
) {
  if (
    ['browser_subject', 'dependent_id', 'owner_id', 'account_id'].some(
      (key) => params.getAll(key).length > 1
    )
  )
    throw new Error('The selected person is ambiguous.');
  if (!actorId || !params.get('account_id') || params.get('account_id') !== actorId)
    throw new Error('This handoff must be opened with the same account that started it.');
  const kind = params.get('browser_subject');
  const dependentId = params.get('dependent_id');
  const ownerId = params.get('owner_id');
  if (kind === 'self' && !dependentId && !ownerId) return { kind: 'self' as const };
  if (kind === 'dependent' && dependentId && !ownerId) {
    const res = await fetch('/api/dependents', { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Could not verify the selected person.');
    const dependent = ((await res.json()) as Dependent[]).find((item) => item.id === dependentId);
    if (dependent) return { kind: 'dependent' as const, dependent };
  } else if (kind === 'owner' && ownerId && !dependentId) {
    const res = await fetch('/api/delegates?type=received', { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Could not verify the selected person.');
    const delegate = ((await res.json()) as Delegate[]).find(
      (item) =>
        item.owner_id === ownerId &&
        item.status === 'accepted' &&
        (!item.expires_at || Date.parse(item.expires_at) > Date.now())
    );
    if (delegate) return { kind: 'owner' as const, delegate };
  }
  throw new Error(
    'This person is unavailable or your access has changed. Choose a person again in HealthTrack.'
  );
}
export default function BrowserSubjectGate({ children }: { children: React.ReactNode }) {
  const search = useSearchParams().toString();
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const { setActiveProfile, setDelegateProfile } = useActiveProfile();
  const [checked, setChecked] = useState<{ key: string; error?: string } | null>(null);
  const requested = new URLSearchParams(search).has('browser_subject');
  const key = `${session?.user.id ?? ''}:${search}`;
  useEffect(() => {
    if (!requested || isPending || !session?.user.id) return;
    const controller = new AbortController();
    validateBrowserSubject(new URLSearchParams(search), controller.signal, session.user.id)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.kind === 'self') setActiveProfile(null, null);
        else if (result.kind === 'dependent')
          setActiveProfile(result.dependent.id, result.dependent.name);
        else
          setDelegateProfile(
            result.delegate.owner_id,
            result.delegate.owner_display_name ?? 'Shared account',
            result.delegate.permission_level
          );
        setChecked({ key });
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setChecked({
            key,
            error: err instanceof Error ? err.message : 'Could not verify the selected person.',
          });
      });
    return () => controller.abort();
  }, [requested, search, isPending, session?.user.id, key, setActiveProfile, setDelegateProfile]);
  if (!requested) return children;
  if (!isPending && !session?.user.id)
    return (
      <div role="alert" className="p-6 space-y-3">
        <p>Your session has expired. Sign in again to continue this handoff.</p>
        <HandoffAccountRecovery returnTo={`${pathname}?${search}`} signedIn={false} />
      </div>
    );
  if (isPending || !checked || checked.key !== key)
    return (
      <p role="status" className="p-6">
        Verifying selected person…
      </p>
    );
  if (checked.error)
    return (
      <div role="alert" className="p-6 space-y-3">
        <p>{checked.error}</p>
        <HandoffAccountRecovery returnTo={`${pathname}?${search}`} signedIn={!!session?.user.id} />
        <a href="/health" className="underline">
          Return to Health
        </a>
      </div>
    );
  return children;
}
