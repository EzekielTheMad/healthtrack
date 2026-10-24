'use client';

import { createContext, useContext } from 'react';
import type { IntegrationHealth } from '@/lib/integrations/status';

export interface IntegrationHealthSnapshot {
  integrations: IntegrationHealth[];
  loading: boolean;
  error: string | null;
  lastCheckedAt: string | null;
  refresh: (force?: boolean) => Promise<void>;
}

export const IntegrationHealthContext = createContext<IntegrationHealthSnapshot | null>(null);

/** Account-scoped state is supplied once by the authenticated app layout. */
export function useIntegrationHealth() {
  const context = useContext(IntegrationHealthContext);
  if (!context) throw new Error('IntegrationHealthProvider is required');
  return context;
}
