'use client';

import { useCallback, useEffect, useState } from 'react';

/** Wire values for `nutrition_strategy` (src/db/schema/health-connect.ts). */
export type NutritionStrategy = 'sum_items' | 'latest_summary';

/** What a rebuild of the retained nutrition records produced. */
export interface RebuildReport {
  dates_rebuilt: string[];
  rows_upserted: number;
  rows_deleted: number;
  records_considered: number;
  records_skipped: number;
  errors: string[];
}

export interface HealthConnectIntegration {
  id: string;
  name: string;
  status: 'inventory' | 'active' | 'paused' | 'error';
  allowedSources: Record<string, string[]>;
  enabledTypes: string[];
  nutritionStrategy: NutritionStrategy;
  lastReceivedAt: string | null;
  lastNormalizedAt: string | null;
  lastAppVersion: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryEntry {
  recordType: string;
  sourcePackage: string;
  identityKind: 'uuid' | 'derived';
  count: number;
  oldest: string | null;
  newest: string | null;
  lastSeenAt: string;
  populatedFields: string[];
}

export interface IngestRun {
  id: string;
  status: 'accepted' | 'duplicate' | 'test_ping' | 'rejected';
  app_version: string | null;
  is_backfill: boolean;
  window_start: string | null;
  window_end: string | null;
  received_count: number;
  inserted_count: number;
  updated_count: number;
  duplicate_count: number;
  rejected_count: number;
  normalization_summary_json: {
    vitals_upserted?: number;
    nutrition_days_upserted?: number;
    skipped_unapproved?: number;
    errors?: string[];
  };
  received_at: string;
}

interface StatusResponse {
  integration: HealthConnectIntegration | null;
  inventory?: InventoryEntry[];
  runs?: IngestRun[];
  last_backfill_window?: { start: string | null; end: string | null } | null;
}

export interface HealthConnectPatch {
  name?: string;
  status?: 'inventory' | 'active' | 'paused';
  allowed_sources?: Record<string, string[]>;
  enabled_types?: string[];
  nutrition_strategy?: NutritionStrategy;
}

const BASE = '/api/integrations/health-connect';

/**
 * Health Connect integration state for Settings. The HMAC secret is returned
 * by the server exactly once (create / rotate) and is held only in local
 * component state for the reveal — it is never refetched.
 */
export function useHealthConnect() {
  const [integration, setIntegration] = useState<HealthConnectIntegration | null>(null);
  const [inventory, setInventory] = useState<InventoryEntry[]>([]);
  const [runs, setRuns] = useState<IngestRun[]>([]);
  const [lastBackfill, setLastBackfill] = useState<{
    start: string | null;
    end: string | null;
  } | null>(null);
  const [rebuild, setRebuild] = useState<RebuildReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(BASE);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to load the Health Connect integration');
      }
      const data = (await res.json()) as StatusResponse;
      setIntegration(data.integration);
      setInventory(data.inventory ?? []);
      setRuns(data.runs ?? []);
      setLastBackfill(data.last_backfill_window ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the integration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Create the integration. Returns the one-time HMAC secret. */
  const create = useCallback(async (name?: string): Promise<string | null> => {
    setError(null);
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { name } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create the integration');
      setIntegration(data.integration);
      return data.secret as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the integration');
      return null;
    }
  }, []);

  const update = useCallback(
    async (patch: HealthConnectPatch): Promise<boolean> => {
      if (!integration) return false;
      setError(null);
      try {
        const res = await fetch(`${BASE}/${integration.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? 'Failed to update the integration');
        setIntegration(data.integration);
        // A patch that newly authorises canonical nutrition writes rebuilds
        // the retained records server-side; surface what that produced so the
        // user does not have to guess whether the change was retroactive.
        if (data.rebuild) setRebuild(data.rebuild as RebuildReport);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update the integration');
        return false;
      }
    },
    [integration],
  );

  /** Rebuild canonical nutrition from the retained raw records. */
  const reprocessNutrition = useCallback(async (): Promise<RebuildReport | null> => {
    if (!integration) return null;
    setError(null);
    setRebuild(null);
    try {
      const res = await fetch(`${BASE}/${integration.id}/reprocess-nutrition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to reprocess retained nutrition');
      setRebuild(data as RebuildReport);
      return data as RebuildReport;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reprocess retained nutrition');
      return null;
    }
  }, [integration]);

  /** Rotate the secret. The previous one stops working immediately. */
  const rotate = useCallback(async (): Promise<string | null> => {
    if (!integration) return null;
    setError(null);
    try {
      const res = await fetch(`${BASE}/${integration.id}/rotate-secret`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to rotate the secret');
      return data.secret as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate the secret');
      return null;
    }
  }, [integration]);

  const remove = useCallback(
    async (deleteRaw: boolean): Promise<boolean> => {
      if (!integration) return false;
      setError(null);
      try {
        const res = await fetch(`${BASE}/${integration.id}?delete_raw=${deleteRaw}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? 'Failed to delete the integration');
        }
        setIntegration(null);
        setInventory([]);
        setRuns([]);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete the integration');
        return false;
      }
    },
    [integration],
  );

  return {
    integration,
    inventory,
    runs,
    lastBackfill,
    rebuild,
    loading,
    error,
    refresh,
    create,
    update,
    rotate,
    remove,
    reprocessNutrition,
  };
}
