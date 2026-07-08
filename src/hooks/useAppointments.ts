'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Appointment } from '@/lib/types';

function listUrl(dependentId: string | null, delegateOwnerId: string | null): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  const qs = params.toString();
  return qs ? `/api/appointments?${qs}` : '/api/appointments';
}

export function useAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  useEffect(() => {
    let cancelled = false;

    async function fetchAppointments() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Appointment[]>(
          listUrl(dependentId, delegateOwnerId),
        );
        if (cancelled) return;
        setAppointments(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load appointments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAppointments();
    return () => { cancelled = true; };
  }, [dependentId, delegateOwnerId]);

  const addAppointment = useCallback(
    async (appointment: Omit<Appointment, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...appointment };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Appointment>('/api/appointments', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setAppointments((prev) => [data, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add appointment');
      }
    },
    [dependentId, delegateOwnerId],
  );

  const updateAppointment = useCallback(
    async (id: string, updates: Partial<Omit<Appointment, 'id' | 'user_id' | 'created_at' | 'updated_at'>>) => {
      setError(null);

      try {
        const data = await apiFetch<Appointment>(
          `/api/appointments/${encodeURIComponent(id)}`,
          { method: 'PATCH', body: JSON.stringify(updates) },
        );
        setAppointments((prev) => prev.map((a) => (a.id === id ? data : a)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update appointment');
      }
    },
    [],
  );

  return { appointments, loading, error, addAppointment, updateAppointment };
}
