'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Dependent } from '@/lib/types';
import type { DependentFormValues } from '@/lib/validations';

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.message ?? body?.error ?? `Request failed (${res.status})`;
}

export function useDependents() {
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDependents() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch('/api/dependents');
        if (cancelled) return;
        if (!res.ok) {
          setError(await readError(res));
        } else {
          setDependents((await res.json()) as Dependent[]);
        }
      } catch {
        if (!cancelled) setError('Failed to fetch dependents');
      }
      if (!cancelled) setLoading(false);
    }

    fetchDependents();
    return () => {
      cancelled = true;
    };
  }, []);

  const addDependent = useCallback(async (values: DependentFormValues) => {
    setError(null);
    const res = await fetch('/api/dependents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      setError(await readError(res));
      return undefined;
    }
    const data = (await res.json()) as Dependent;
    setDependents((prev) => [data, ...prev]);
    return data;
  }, []);

  const updateDependent = useCallback(
    async (id: string, updates: Partial<DependentFormValues>) => {
      setError(null);
      const res = await fetch('/api/dependents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const data = (await res.json()) as Dependent;
      setDependents((prev) => prev.map((d) => (d.id === id ? data : d)));
    },
    [],
  );

  const deleteDependent = useCallback(async (id: string) => {
    setError(null);
    const res = await fetch(`/api/dependents?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setError(await readError(res));
    } else {
      setDependents((prev) => prev.filter((d) => d.id !== id));
    }
  }, []);

  const getAge = useCallback((dependent: Dependent): number => {
    const dob = new Date(dependent.date_of_birth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  }, []);

  const needsTransition = useCallback(
    (dependent: Dependent): boolean => {
      if (dependent.transitioned) return false;
      return getAge(dependent) >= dependent.transition_age;
    },
    [getAge],
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
