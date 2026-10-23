'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import type { IntegrationHealth } from '@/lib/integrations/status';

export function useIntegrationHealth() {
  const [integrations, setIntegrations] = useState<IntegrationHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setIntegrations(await apiFetch<IntegrationHealth[]>('/api/integrations/status'));
      setError(null);
    } catch {
      setError('Could not load integration status.');
    }
  }, []);
  useEffect(() => {
    const update = () => {
      void refresh();
    };
    update();
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    window.addEventListener('integration-health-changed', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('integration-health-changed', update);
    };
  }, [refresh]);
  return { integrations, error, refresh };
}
