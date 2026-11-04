'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { leaveAndroidPresentation } from '@/components/mobile/AndroidMode';
import { validateBrowserSubject } from '@/components/mobile/BrowserSubjectGate';
import { useSession } from '@/lib/auth/client';
import HandoffAccountRecovery from '@/components/mobile/HandoffAccountRecovery';
const DESTINATIONS = new Set([
  '/labs',
  '/settings',
  '/settings?tab=people',
  '/settings?tab=data',
  '/settings?tab=advanced',
  '/settings?tab=integrations#health-connect',
]);
function BrowserContent() {
  const query = useSearchParams();
  const key = query.toString();
  const { data: session, isPending } = useSession();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isPending || !session?.user.id) return;
    const params = new URLSearchParams(key);
    const controller = new AbortController();
    const target = params.get('path') ?? '';
    const scope = new URLSearchParams();
    if (params.get('account_id')) scope.set('account_id', params.get('account_id')!);
    if (params.get('dependent_id')) {
      scope.set('browser_subject', 'dependent');
      scope.set('dependent_id', params.get('dependent_id')!);
    } else if (params.get('owner_id')) {
      scope.set('browser_subject', 'owner');
      scope.set('owner_id', params.get('owner_id')!);
    } else if (params.get('subject') === 'self') scope.set('browser_subject', 'self');
    // Reject mixed/implicit scopes; no owner fallback.
    if (
      !DESTINATIONS.has(target) ||
      ['path', 'subject', 'dependent_id', 'owner_id', 'account_id'].some(
        (name) => params.getAll(name).length > 1
      ) ||
      (params.has('subject') && (params.has('dependent_id') || params.has('owner_id'))) ||
      (params.has('dependent_id') && params.has('owner_id')) ||
      !scope.has('browser_subject')
    ) {
      // This state is a validation result for an external navigation request.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('The browser handoff is invalid. Return to HealthTrack and try again.');
      return;
    }
    validateBrowserSubject(scope, controller.signal, session.user.id)
      .then(() => {
        if (controller.signal.aborted) return;
        const url = new URL(target, window.location.origin);
        scope.forEach((value, name) => url.searchParams.set(name, value));
        leaveAndroidPresentation();
        window.location.replace(`${url.pathname}${url.search}${url.hash}`);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : 'Could not open browser workflow.');
      });
    return () => controller.abort();
  }, [key, isPending, session?.user.id]);
  if (!isPending && !session?.user.id)
    return (
      <div role="alert" className="space-y-3">
        <p>Your session has expired. Sign in again to continue this handoff.</p>
        <HandoffAccountRecovery returnTo={`/mobile/browser?${key}`} signedIn={false} />
      </div>
    );
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Open browser workflow</h1>
      {error ? (
        <div role="alert" className="space-y-3">
          <p>{error}</p>
          <HandoffAccountRecovery
            returnTo={`/mobile/browser?${key}`}
            signedIn={!!session?.user.id}
          />
        </div>
      ) : (
        <p role="status">Verifying the selected person before continuing…</p>
      )}
    </div>
  );
}
export default function BrowserPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <BrowserContent />
    </Suspense>
  );
}
