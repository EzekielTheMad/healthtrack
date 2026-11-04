'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';

export type RecordPresence = 'loading' | 'present' | 'empty' | 'unavailable';
type Domains = { labs: RecordPresence; medications: RecordPresence; scans: RecordPresence };
const pending: Domains = { labs: 'loading', medications: 'loading', scans: 'loading' };

/** Presence only: no active-status inference or projection into numeric readings. */
export function useDetailedRecordPresence() {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const subject = JSON.stringify([delegateOwnerId, dependentId]);
  const [state, setState] = useState<Domains & { subject: string }>({ ...pending, subject: '' });
  useEffect(() => {
    const controller = new AbortController();
    const scope = new URLSearchParams({ limit: '1' });
    if (delegateOwnerId) scope.set('owner_id', delegateOwnerId);
    if (dependentId) scope.set('dependent_id', dependentId);
    async function read(domain: keyof Domains, url: string, field: 'records' | 'scans') {
      let status: RecordPresence;
      try {
        const response = await apiFetch<Record<string, unknown>>(url, {
          signal: controller.signal,
        });
        if (!response || !Array.isArray(response[field]))
          throw new Error('History presence unavailable');
        status = response[field].length ? 'present' : 'empty';
      } catch {
        status = 'unavailable';
      }
      if (controller.signal.aborted) return;
      setState((previous) => ({
        ...(previous.subject === subject ? previous : pending),
        subject,
        [domain]: status,
      }));
    }
    const labs = new URLSearchParams(scope);
    labs.set('kind', 'lab');
    const medications = new URLSearchParams(scope);
    medications.set('kind', 'medication');
    void read('labs', '/api/clinical-records?' + labs, 'records');
    void read('medications', '/api/clinical-records?' + medications, 'records');
    void read('scans', '/api/scans?' + scope, 'scans');
    return () => controller.abort();
  }, [subject, dependentId, delegateOwnerId]);
  const current = state.subject === subject ? state : pending;
  return {
    labs: current.labs,
    medications: current.medications,
    scans: current.scans,
    loading: [current.labs, current.medications, current.scans].includes('loading'),
    unavailable: [current.labs, current.medications, current.scans].includes('unavailable'),
  };
}
