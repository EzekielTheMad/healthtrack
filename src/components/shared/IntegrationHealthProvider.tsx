'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/auth/client';
import { apiFetch } from '@/lib/api/client';
import type { IntegrationHealth } from '@/lib/integrations/status';
import { IntegrationHealthContext } from '@/hooks/useIntegrationHealth';

/** A keyed instance prevents a previous account's snapshot surviving a session change. */
export function IntegrationHealthProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const accountId = session?.user.id ?? null;
  return (
    <AccountIntegrationHealth
      key={accountId ?? (isPending ? 'session-pending' : 'signed-out')}
      accountId={accountId}
      sessionPending={isPending}
    >
      {children}
    </AccountIntegrationHealth>
  );
}

function AccountIntegrationHealth({
  accountId,
  sessionPending,
  children,
}: {
  accountId: string | null;
  sessionPending: boolean;
  children: React.ReactNode;
}) {
  const [integrations, setIntegrations] = useState<IntegrationHealth[]>([]);
  const [loading, setLoading] = useState(!!accountId || sessionPending);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const pending = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);

  const refresh = useCallback(
    (force = false): Promise<void> => {
      if (!accountId || !alive.current) return Promise.resolve();
      if (pending.current && !force) return pending.current.promise;
      pending.current?.controller.abort();
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      const request = ++generation.current;
      const promise = (async () => {
        try {
          const next = await apiFetch<IntegrationHealth[]>('/api/integrations/status', {
            signal,
            cache: 'no-store',
          });
          if (controller.signal.aborted || generation.current !== request) return;
          setIntegrations(next);
          setError(null);
          setLastCheckedAt(new Date().toISOString());
        } catch {
          if (!controller.signal.aborted && generation.current === request)
            setError('Could not load integration status. Displayed details may be outdated.');
        } finally {
          if (generation.current === request && !controller.signal.aborted) {
            setLoading(false);
            pending.current = null;
          }
        }
      })();
      pending.current = { controller, promise };
      return promise;
    },
    [accountId]
  );

  useEffect(() => {
    alive.current = true;
    if (!accountId) return;
    const update = () => {
      void refresh();
    };
    const invalidate = () => {
      void refresh(true);
    };
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    window.addEventListener('integration-health-changed', invalidate);
    window.addEventListener('integration-status-refresh', invalidate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('integration-health-changed', invalidate);
      window.removeEventListener('integration-status-refresh', invalidate);
      alive.current = false;
      pending.current?.controller.abort();
      pending.current = null;
    };
  }, [accountId, refresh]);

  return (
    <IntegrationHealthContext.Provider
      value={{ integrations, loading, error, lastCheckedAt, refresh }}
    >
      {children}
    </IntegrationHealthContext.Provider>
  );
}
