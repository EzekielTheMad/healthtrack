'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Note } from '@/lib/types';

function listUrl(dependentId: string | null, delegateOwnerId: string | null): string {
  const params = new URLSearchParams();
  if (delegateOwnerId) {
    params.set('owner_id', delegateOwnerId);
  } else if (dependentId) {
    params.set('dependent_id', dependentId);
  }
  const qs = params.toString();
  return qs ? `/api/notes?${qs}` : '/api/notes';
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { dependentId, delegateOwnerId } = useActiveProfile();

  useEffect(() => {
    let cancelled = false;

    async function fetchNotes() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Note[]>(listUrl(dependentId, delegateOwnerId));
        if (cancelled) return;
        setNotes(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load notes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNotes();
    return () => { cancelled = true; };
  }, [dependentId, delegateOwnerId]);

  const addNote = useCallback(
    async (note: Omit<Note, 'id' | 'user_id' | 'created_at'>) => {
      setError(null);

      const payload: Record<string, unknown> = { ...note };
      if (delegateOwnerId) payload.owner_id = delegateOwnerId;
      else if (dependentId) payload.dependent_id = dependentId;

      try {
        const data = await apiFetch<Note>('/api/notes', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setNotes((prev) => [data, ...prev]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add note');
      }
    },
    [dependentId, delegateOwnerId],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      setError(null);

      try {
        await apiFetch<void>(`/api/notes/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        setNotes((prev) => prev.filter((n) => n.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete note');
      }
    },
    [],
  );

  return { notes, loading, error, addNote, deleteNote };
}
