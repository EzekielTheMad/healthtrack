'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import type { Profile } from '@/lib/types';

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchProfile() {
      setLoading(true);
      setError(null);

      try {
        const data = await apiFetch<Profile>('/api/profile');
        if (cancelled) return;
        setProfile(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProfile();
    return () => { cancelled = true; };
  }, []);

  const updateProfile = useCallback(
    async (updates: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>) => {
      setError(null);

      try {
        const data = await apiFetch<Profile>('/api/profile', {
          method: 'PUT',
          body: JSON.stringify(updates),
        });
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update profile');
      }
    },
    [],
  );

  return { profile, loading, error, updateProfile };
}
