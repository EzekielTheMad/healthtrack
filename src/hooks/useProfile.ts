'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import type { Profile, Dependent } from '@/lib/types';

export function useProfile() {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subject = `${delegateOwnerId ?? 'self'}:${dependentId ?? 'self'}`;
  const [loadedSubject, setLoadedSubject] = useState<string | null>(null);
  const currentSubject = useRef(subject);
  useEffect(() => {
    currentSubject.current = subject;
  }, [subject]);

  useEffect(() => {
    let cancelled = false;

    async function fetchProfile() {
      setLoading(true);
      setError(null);
      setProfile(null);

      try {
        const ownerUrl = delegateOwnerId
          ? `/api/profile?owner_id=${encodeURIComponent(delegateOwnerId)}`
          : '/api/profile';
        let data: Profile;
        if (dependentId && !delegateOwnerId) {
          const dependent = (await apiFetch<Dependent[]>('/api/dependents')).find(
            (d) => d.id === dependentId
          );
          if (!dependent) throw new Error('Selected profile was not found');
          const owner = await apiFetch<Profile>(ownerUrl).catch(() => null);
          data = {
            id: dependent.id,
            display_name: dependent.name,
            date_of_birth: dependent.date_of_birth,
            biological_sex: dependent.biological_sex,
            height_inches: null,
            weight_lbs: null,
            unit_system: owner?.unit_system ?? 'imperial',
            created_at: dependent.created_at,
            updated_at: dependent.created_at,
          };
        } else data = await apiFetch<Profile>(ownerUrl);
        if (cancelled) return;
        setProfile(data);
        setLoadedSubject(subject);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [dependentId, delegateOwnerId, subject]);

  const updateProfile = useCallback(
    async (updates: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>) => {
      setError(null);

      if (dependentId || delegateOwnerId)
        throw new Error('Profile updates are available in Settings for your own record.');

      try {
        const data = await apiFetch<Profile>('/api/profile', {
          method: 'PUT',
          body: JSON.stringify(updates),
        });
        if (currentSubject.current === 'self:self') {
          setProfile(data);
          setLoadedSubject('self:self');
        }
      } catch (err) {
        if (currentSubject.current === 'self:self')
          setError(err instanceof Error ? err.message : 'Failed to update profile');
        throw err;
      }
    },
    [dependentId, delegateOwnerId]
  );

  return { profile: loadedSubject === subject ? profile : null, loading, error, updateProfile };
}
