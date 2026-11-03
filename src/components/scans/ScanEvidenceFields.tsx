'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { formatClinicalDate, type FidelityRecord } from '@/lib/fidelity/contracts';

export type SourceDraft = { reference: string; document_id: string; page: string };
export const emptySourceDraft = (): SourceDraft => ({ reference: '', document_id: '', page: '' });
const control = 'min-h-11 w-full rounded-lg border px-3 py-2 text-sm';
const style = {
  backgroundColor: 'var(--bg-primary)',
  borderColor: 'var(--border-card)',
  color: 'var(--color-text-primary)',
};

export function SupplementLinks({
  ownerId,
  dependentId,
  selected,
  onChange,
}: {
  ownerId: string | null;
  dependentId: string | null;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [records, setRecords] = useState<FidelityRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        format: 'typed',
        ...(ownerId ? { owner_id: ownerId } : {}),
        ...(dependentId ? { dependent_id: dependentId } : {}),
      });
      const response = await apiFetch<{ records: FidelityRecord[] }>('/api/medications?' + params);
      if (!Array.isArray(response.records)) throw new Error('Supplement records are unavailable.');
      if (alive.current)
        setRecords(
          response.records.filter(
            (record) => record.fact.kind === 'medication' && record.fact.supplement
          )
        );
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'Could not load supplements.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">Linked supplement records</legend>
      <p className="text-xs">
        Select records for this person only. A link records context; it does not prove a dose was
        taken or that a historical supplement was in use at scan time.
      </p>
      <button
        type="button"
        disabled={loading}
        onClick={load}
        className="min-h-11 border rounded-lg px-3 text-sm"
      >
        {loading
          ? 'Loading supplements…'
          : records
            ? 'Refresh supplements'
            : 'Load supplements for this person'}
      </button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {records?.length === 0 && (
        <p className="text-sm">
          No supplement records are available in the returned history. You can save this scan
          without links.
        </p>
      )}
      {records?.map((record) =>
        record.fact.kind === 'medication' ? (
          <label key={record.id} className="flex gap-2 items-start min-h-11 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(record.id)}
              disabled={!selected.includes(record.id) && selected.length >= 30}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, record.id]
                    : selected.filter((id) => id !== record.id)
                )
              }
            />
            <span className="break-words">
              {record.fact.name} · {record.fact.status} ·{' '}
              {formatClinicalDate(record.fact.start_date)}
              {record.fact.end_date ? ` to ${formatClinicalDate(record.fact.end_date)}` : ''}
            </span>
          </label>
        ) : null
      )}
      {selected
        .filter((id) => !records?.some((record) => record.id === id))
        .map((id) => (
          <p className="text-sm break-words" key={id}>
            Linked record unavailable in returned history: {id}{' '}
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => onChange(selected.filter((selectedId) => selectedId !== id))}
            >
              Remove link
            </button>
          </p>
        ))}
    </fieldset>
  );
}

export function SourceReferences({
  sources,
  onChange,
}: {
  sources: SourceDraft[];
  onChange: (sources: SourceDraft[]) => void;
}) {
  function change(index: number, field: keyof SourceDraft, value: string) {
    onChange(sources.map((source, i) => (i === index ? { ...source, [field]: value } : source)));
  }
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">Source references</legend>
      <p className="text-xs">
        Reference the report name or location. A protected document ID can link a retained upload
        for this exact person; access is checked when saving. Page numbers are one-based. Entering
        an ID does not upload a file or grant access to an original.
      </p>
      {sources.map((source, index) => (
        <div
          className="space-y-2 rounded-lg border p-3"
          style={{ borderColor: 'var(--border-card)' }}
          key={index}
        >
          <label className="block text-sm">
            {index ? `Durable source reference ${index + 1}` : 'Durable source reference'}
            <input
              aria-label={
                index ? `Durable source reference ${index + 1}` : 'Durable source reference'
              }
              value={source.reference}
              onChange={(event) => change(index, 'reference', event.target.value)}
              className={control}
              style={style}
              maxLength={4000}
              placeholder="Report filename, identifier or location"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Protected document ID (optional)
              <input
                aria-label={`Source ${index + 1}: Protected document ID`}
                value={source.document_id}
                onChange={(event) => change(index, 'document_id', event.target.value)}
                className={control}
                style={style}
                maxLength={200}
              />
            </label>
            <label className="text-sm">
              Report page (optional)
              <input
                aria-label={`Source ${index + 1}: Report page`}
                inputMode="numeric"
                value={source.page}
                onChange={(event) => change(index, 'page', event.target.value)}
                className={control}
                style={style}
              />
            </label>
          </div>
          {sources.length > 1 && (
            <button
              type="button"
              className="min-h-11 underline text-sm"
              onClick={() => onChange(sources.filter((_, i) => i !== index))}
            >
              Remove source {index + 1}
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        disabled={sources.length >= 30}
        className="min-h-11 border rounded-lg px-3 text-sm"
        onClick={() => onChange([...sources, emptySourceDraft()])}
      >
        Add source reference
      </button>
    </fieldset>
  );
}
