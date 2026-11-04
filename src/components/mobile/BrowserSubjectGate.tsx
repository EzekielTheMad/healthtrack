'use client';
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { useSession } from '@/lib/auth/client';
import { validateBrowserSubject } from '@/lib/browser-subject';
export { validateBrowserSubject } from '@/lib/browser-subject';
import HandoffAccountRecovery from './HandoffAccountRecovery';
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
