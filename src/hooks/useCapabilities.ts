'use client';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/auth/client';
import type { Capabilities } from '@/lib/capabilities';

/** Never share account capabilities across logins; refresh after settings changes. */
export function useCapabilities() {
  const { data: session } = useSession();
  const accountId = session?.user.id;
  const [state, setState] = useState<{
    accountId: string | undefined;
    value: Capabilities | null;
    loading: boolean;
  }>({ accountId: undefined, value: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const refresh = async () => {
      const id = ++generation;
      try {
        const res = await fetch('/api/capabilities', { cache: 'no-store' });
        const value = res.ok ? ((await res.json()) as Capabilities) : null;
        if (!cancelled && id === generation) setState({ accountId, value, loading: false });
      } catch {
        if (!cancelled && id === generation) setState({ accountId, value: null, loading: false });
      }
    };
    void refresh();
    window.addEventListener('healthtrack:ai-settings', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('healthtrack:ai-settings', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [accountId]);
  return {
    capabilities: state.accountId === accountId ? state.value : null,
    loading: state.accountId === accountId ? state.loading : true,
  };
}
