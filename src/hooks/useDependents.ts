'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dependent } from '@/lib/types';
import type { DependentFormValues } from '@/lib/validations';

const DEPENDENTS_CHANGED = 'healthtrack:dependents-changed';

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.message ?? body?.error ?? `Request failed (${res.status})`;
}

export function useDependents() {
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const mounted = useRef(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      // Invalidate immediately, including responses still parsing their body.
      requestVersion.current++;
      setRefreshVersion((version) => version + 1);
    };
    window.addEventListener(DEPENDENTS_CHANGED, refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener(DEPENDENTS_CHANGED, refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const version = ++requestVersion.current;
    const current = () => !cancelled && mounted.current && version === requestVersion.current;

    async function fetchDependents() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/dependents', { cache: 'no-store' });
        if (!res.ok) {
          const message = await readError(res);
          if (current()) setError(message);
        } else {
          const data = (await res.json()) as Dependent[];
          if (current()) setDependents(data);
        }
      } catch {
        if (current()) setError('Failed to fetch dependents');
      }
      if (current()) setLoading(false);
    }

    fetchDependents();
    return () => {
      cancelled = true;
    };
  }, [refreshVersion]);

  const addDependent = useCallback(async (values: DependentFormValues) => {
    if (mounted.current) setError(null);
    try {
      const res = await fetch('/api/dependents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const message = await readError(res);
        if (mounted.current) setError(message);
        return undefined;
      }
      const data = (await res.json()) as Dependent;
      if (mounted.current) setDependents((prev) => [data, ...prev]);
      // Send no person data; every consumer reloads using its current session.
      window.dispatchEvent(new Event(DEPENDENTS_CHANGED));
      return data;
    } catch {
      if (mounted.current)
        setError('Failed to add dependent. Your entered values are still available.');
      return undefined;
    }
  }, []);

  const updateDependent = useCallback(async (id: string, updates: Partial<DependentFormValues>) => {
    if (mounted.current) setError(null);
    try {
      const res = await fetch('/api/dependents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });
      if (!res.ok) {
        const message = await readError(res);
        if (mounted.current) setError(message);
        return undefined;
      }
      const data = (await res.json()) as Dependent;
      if (mounted.current) setDependents((prev) => prev.map((d) => (d.id === id ? data : d)));
      window.dispatchEvent(new Event(DEPENDENTS_CHANGED));
      return data;
    } catch {
      if (mounted.current)
        setError('Failed to update dependent. Your entered values are still available.');
      return undefined;
    }
  }, []);

  const deleteDependent = useCallback(async (id: string) => {
    if (mounted.current) setError(null);
    try {
      const res = await fetch(`/api/dependents?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const message = await readError(res);
        if (mounted.current) setError(message);
      } else {
        if (mounted.current) setDependents((prev) => prev.filter((d) => d.id !== id));
        window.dispatchEvent(new Event(DEPENDENTS_CHANGED));
      }
    } catch {
      if (mounted.current) setError('Failed to delete dependent. Please try again.');
    }
  }, []);

  const getAge = useCallback((dependent: Dependent): number => {
    const [birthYear, birthMonth, birthDay] = dependent.date_of_birth
      .slice(0, 10)
      .split('-')
      .map(Number);
    const today = new Date();
    let age = today.getFullYear() - birthYear;
    const monthDiff = today.getMonth() + 1 - birthMonth;
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDay)) {
      age--;
    }
    return age;
  }, []);

  const needsTransition = useCallback(
    (dependent: Dependent): boolean => {
      if (dependent.transitioned) return false;
      return getAge(dependent) >= dependent.transition_age;
    },
    [getAge]
  );

  return {
    dependents,
    loading,
    error,
    addDependent,
    updateDependent,
    deleteDependent,
    getAge,
    needsTransition,
  };
}
