'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { apiFetch } from '@/lib/api/client';
import type { ImportBatchReview as Batch, ImportDecision } from '@/lib/import/batches';

interface Props {
  batchId: string;
  onComplete?: () => void;
  onCancel?: () => void;
}
const fieldStyle = {
  background: 'var(--bg-primary)',
  color: 'var(--color-text-primary)',
  borderColor: 'var(--border-card)',
};
const hiddenKeys = new Set([
  'ai_provenance',
  '_visit_key',
  'confidence',
  'source_page',
  'source_pages',
  'accession_id',
  'specimen_id',
  'collected_at',
  'raw_text',
  'provider_name',
]);
const numericKeys = new Set([
  'value',
  'reference_range_low',
  'reference_range_high',
  'dose_number',
  'series_doses',
]);
const options: Record<string, string[]> = {
  active: ['true', 'false'],
  severity: ['mild', 'moderate', 'severe', 'life_threatening'],
  status: ['active', 'resolved', 'managed', 'monitoring'],
  flag: ['normal', 'high', 'low', 'critical'],
};
const clinicalLabels: Record<string, string> = {
  name: 'Name',
  test_name: 'Test',
  loinc_code: 'Printed LOINC',
  panel_name: 'Panel',
  value: 'Result',
  unit: 'Unit',
  visit_date: 'Collection date',
  start_date: 'Start date',
  end_date: 'End date',
  diagnosed_date: 'Diagnosed',
  procedure_date: 'Procedure date',
  vaccine_date: 'Vaccine date',
  dosage: 'Dosage',
  frequency: 'Frequency',
  active: 'Active',
  status: 'Status',
  severity: 'Severity',
  reaction: 'Reaction',
  dose_number: 'Dose',
  series_doses: 'Series doses',
  manufacturer: 'Manufacturer',
  lot_number: 'Lot',
  notes: 'Notes',
  reference_range_low: 'Reference low',
  reference_range_high: 'Reference high',
  reference_range_text: 'Printed range',
  flag: 'Flag',
  accession_id: 'Accession',
  specimen_id: 'Specimen',
  collected_at: 'Collected at',
  source_page: 'Source page',
  source_pages: 'Source pages',
  raw_text: 'Printed result',
};
const domainPaths: Record<string, string> = {
  medications: '/medications',
  conditions: '/conditions',
  allergies: '/allergies',
  procedures: '/procedures',
  vaccines: '/vaccines',
  lab_results: '/labs',
};
function ClinicalValues({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="space-y-1 text-xs">
      {Object.entries(clinicalLabels)
        .filter(([key]) => values[key] !== null && values[key] !== undefined && values[key] !== '')
        .map(([key, label]) => (
          <div key={key} className="grid grid-cols-2 gap-2">
            <dt style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
            <dd className="break-words">{String(values[key])}</dd>
          </div>
        ))}
    </dl>
  );
}
function candidateLabel(values: Record<string, unknown>, index: number) {
  return `Record ${index + 1} · ${String(values.visit_date ?? values.start_date ?? values.procedure_date ?? values.vaccine_date ?? 'Date unknown')} · ${String(values.value ?? values.dosage ?? values.name ?? values.test_name ?? '')}${values.unit ? ` ${values.unit}` : ''}`;
}

/** Same review/commit workflow for lab PDFs and complete histories. */
export default function ImportBatchReview(props: Props) {
  return <ReviewContent key={props.batchId} {...props} />;
}
function ReviewContent({ batchId, onComplete, onCancel }: Props) {
  const { setActiveProfile } = useActiveProfile();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    apiFetch<Batch>(`/api/import-batches/${batchId}`)
      .then((data) => {
        if (!active) return;
        setBatch(data);
        const initial: Record<string, ImportDecision> = {};
        for (const item of data.items) {
          if (item.status !== 'pending' && item.status !== 'error') continue;
          if (item.classification === 'new')
            initial[item.id] = { item_id: item.id, action: 'add', values: { ...item.payload } };
        }
        setDecisions(initial);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load review.');
      });
    return () => {
      active = false;
    };
  }, [batchId]);

  function changeAction(itemId: string, action: string) {
    const item = batch!.items.find((row) => row.id === itemId)!;
    setDecisions((previous) => {
      if (action === 'hold') {
        const next = { ...previous };
        delete next[itemId];
        return next;
      }
      const match = item.matches.find((row) => !row.id.startsWith('staged:'));
      const values =
        action === 'correct'
          ? Object.fromEntries(Object.entries(item.payload).filter(([, value]) => value !== null))
          : { ...item.payload };
      return {
        ...previous,
        [itemId]: {
          item_id: itemId,
          action: action as ImportDecision['action'],
          values,
          ...((action === 'link' || action === 'correct') && match
            ? { target_id: match.id, expected: match.values }
            : {}),
        },
      };
    });
  }
  function changeValue(itemId: string, key: string, value: unknown) {
    setDecisions((previous) => ({
      ...previous,
      [itemId]: {
        ...(previous[itemId] ?? { item_id: itemId, action: 'add' }),
        values: {
          ...(previous[itemId]?.values ?? batch!.items.find((row) => row.id === itemId)!.payload),
          [key]: value,
        },
      },
    }));
  }
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<Batch>(`/api/import-batches/${batchId}`, {
        method: 'POST',
        body: JSON.stringify({ decisions: Object.values(decisions) }),
      });
      setBatch(updated);
      // Keep inputs for failed items, remove only decisions that were applied.
      setDecisions((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([id]) =>
            updated.items.some(
              (item) => item.id === id && (item.status === 'error' || item.status === 'pending')
            )
          )
        )
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not apply decisions. Your review is preserved.'
      );
    } finally {
      setSaving(false);
    }
  }
  if (!batch)
    return <p role={error ? 'alert' : 'status'}>{error ?? 'Loading saved import review…'}</p>;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4 space-y-2" style={fieldStyle}>
        <h2 className="font-semibold">Review {batch.file_name}</h2>
        {batch.patient_name && <p className="text-sm">Patient: {batch.patient_name}</p>}
        <p className="text-sm">
          Check extracted values against the original. Similar entries need a decision; nothing
          silently overwrites your records. Partial dates remain here until you supply the exact
          date.
        </p>
        {batch.source_path && (
          <a
            className="underline text-sm"
            href={`/api/files/${batch.source_path}`}
            target="_blank"
            rel="noreferrer"
          >
            Open original document
          </a>
        )}
        <p className="text-sm" role="status">
          {batch.counts.applied} added · {batch.counts.linked} linked · {batch.counts.corrected}{' '}
          corrected · {batch.counts.skipped} skipped · {batch.counts.pending + batch.counts.error}{' '}
          remaining
        </p>
        {batch.warnings.map((warning) => (
          <p key={warning} className="text-sm" style={{ color: 'var(--color-warning)' }}>
            {warning}
          </p>
        ))}
        {batch.warnings.some((warning) =>
          /could not be processed|failed to extract|incomplete extraction/i.test(warning)
        ) && (
          <p className="text-sm">
            Extraction is incomplete. Reupload this file in Settings with “Retry an incomplete
            extraction” selected to retry missing sections without losing applied records.
          </p>
        )}
      </div>
      {batch.items.map((item) => {
        const done = item.status !== 'pending' && item.status !== 'error';
        const decision = decisions[item.id];
        const matches = item.matches.filter((row) => !row.id.startsWith('staged:'));
        const selected = matches.find((row) => row.id === decision?.target_id);
        const values = {
          ...item.payload,
          ...(decision?.action === 'correct' ? selected?.values : {}),
          ...(decision?.values ?? {}),
        };
        const keys = [...Object.keys(item.payload)];
        const extraction = item.payload.ai_provenance as
          | import('@/lib/ai/types').AiProvenance
          | undefined;
        // Required choices must remain visible even when not present in extraction.
        if (item.domain === 'allergies' && !keys.includes('severity')) keys.push('severity');
        return (
          <section key={item.id} className="rounded-xl border p-4 space-y-3" style={fieldStyle}>
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium">
                {String(item.payload.name ?? item.payload.test_name)}{' '}
                <span className="text-xs font-normal">({item.domain.replaceAll('_', ' ')})</span>
              </h3>
              <span className="text-xs">
                {done
                  ? item.status
                  : item.classification === 'duplicate'
                    ? 'Exact match'
                    : item.classification === 'possible'
                      ? 'Possible match — check identity'
                      : item.classification === 'conflict'
                        ? 'Conflicting values — review'
                        : 'New entry'}
              </span>
            </div>
            {(item.payload.source_page !== undefined ||
              item.payload.source_pages !== undefined) && (
              <p className="text-xs">
                Source page: {String(item.payload.source_page ?? item.payload.source_pages)}
              </p>
            )}
            {extraction && (
              <p className="text-xs break-words">
                Extracted with {String(extraction.provider)} · {String(extraction.model)}. Review
                the source before saving.
              </p>
            )}
            {item.payload.raw_text != null && (
              <p className="text-xs">Printed result: {String(item.payload.raw_text)}</p>
            )}
            {done && item.record_id && (
              <Link
                className="text-sm underline"
                href={`${domainPaths[item.domain]}#record-${item.record_id}`}
                onClick={() =>
                  setActiveProfile(
                    batch.dependent_id,
                    batch.dependent_id ? batch.patient_name : null
                  )
                }
              >
                View saved {item.domain === 'lab_results' ? 'lab results' : item.domain}
              </Link>
            )}
            {!done && (
              <>
                {item.matches.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-sm">
                      Compare existing / document entries ({item.matches.length})
                    </summary>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                      <section>
                        <h4 className="text-sm font-medium mb-2">Extracted from document</h4>
                        <ClinicalValues values={item.payload} />
                      </section>
                      <div className="space-y-4">
                        {item.matches.map((match, index) => (
                          <section key={match.id}>
                            <h4 className="text-sm font-medium mb-2">
                              {match.id.startsWith('staged:')
                                ? 'Another document entry'
                                : `Existing record ${index + 1}`}
                            </h4>
                            <ClinicalValues values={match.values} />
                            {!match.id.startsWith('staged:') && (
                              <Link
                                className="text-sm underline"
                                href={`${domainPaths[item.domain]}#record-${match.id}`}
                                onClick={() =>
                                  setActiveProfile(
                                    batch.dependent_id,
                                    batch.dependent_id ? batch.patient_name : null
                                  )
                                }
                              >
                                View record
                              </Link>
                            )}
                          </section>
                        ))}
                      </div>
                    </div>
                  </details>
                )}
                <label className="block text-sm">
                  Decision
                  <select
                    className="block w-full rounded-lg border p-2 mt-1"
                    style={fieldStyle}
                    aria-label={`Decision for ${String(item.payload.name ?? item.payload.test_name)}`}
                    disabled={saving}
                    value={decision?.action ?? 'hold'}
                    onChange={(event) => changeAction(item.id, event.target.value)}
                  >
                    <option value="hold">Keep in review</option>
                    <option value="skip">Skip this item</option>
                    <option value="add">Add as a separate record</option>
                    {matches.length > 0 && (
                      <>
                        <option value="link">Link source to an existing record</option>
                        <option value="correct">Correct an existing record</option>
                      </>
                    )}
                  </select>
                </label>
                {(decision?.action === 'link' || decision?.action === 'correct') && (
                  <label className="block text-sm">
                    Existing record
                    <select
                      className="block w-full rounded-lg border p-2"
                      style={fieldStyle}
                      value={decision.target_id ?? ''}
                      disabled={saving}
                      onChange={(event) => {
                        const match = matches.find((row) => row.id === event.target.value)!;
                        setDecisions((previous) => ({
                          ...previous,
                          [item.id]: {
                            ...previous[item.id],
                            target_id: match.id,
                            expected: match.values,
                          },
                        }));
                      }}
                    >
                      {matches.map((match, index) => (
                        <option key={match.id} value={match.id}>
                          {candidateLabel(match.values, index)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(decision?.action === 'add' || decision?.action === 'correct') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {keys
                      .filter((key) => !key.startsWith('_') && !hiddenKeys.has(key))
                      .map((key) => (
                        <label key={key} className="block text-xs">
                          {key.replaceAll('_', ' ')}
                          {options[key] ? (
                            <select
                              className="block w-full rounded-lg border p-2 mt-1"
                              style={fieldStyle}
                              disabled={saving}
                              value={
                                values[key] === null || values[key] === undefined
                                  ? ''
                                  : String(values[key])
                              }
                              onChange={(event) =>
                                changeValue(
                                  item.id,
                                  key,
                                  event.target.value === ''
                                    ? null
                                    : key === 'active'
                                      ? event.target.value === 'true'
                                      : event.target.value
                                )
                              }
                            >
                              <option value="">Unknown</option>
                              {options[key].map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="block w-full rounded-lg border p-2 mt-1"
                              style={fieldStyle}
                              type={numericKeys.has(key) ? 'number' : 'text'}
                              step={numericKeys.has(key) ? 'any' : undefined}
                              disabled={saving}
                              value={values[key] == null ? '' : String(values[key])}
                              onChange={(event) =>
                                changeValue(
                                  item.id,
                                  key,
                                  event.target.value === ''
                                    ? null
                                    : numericKeys.has(key)
                                      ? Number(event.target.value)
                                      : event.target.value
                                )
                              }
                            />
                          )}
                        </label>
                      ))}
                  </div>
                )}
                {decision?.action === 'correct' && (
                  <label className="block text-sm">
                    Reason for correction
                    <input
                      className="block w-full rounded-lg border p-2 mt-1"
                      style={fieldStyle}
                      disabled={saving}
                      value={decision.reason ?? ''}
                      onChange={(event) =>
                        setDecisions((previous) => ({
                          ...previous,
                          [item.id]: { ...previous[item.id], reason: event.target.value },
                        }))
                      }
                    />
                  </label>
                )}
                {item.error && (
                  <p role="alert" className="text-sm" style={{ color: 'var(--color-terracotta)' }}>
                    {item.error}
                  </p>
                )}
              </>
            )}
          </section>
        );
      })}
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {Object.keys(decisions).length > 0 && (
          <button
            className="rounded-lg px-4 py-2 border"
            style={fieldStyle}
            disabled={saving}
            onClick={save}
          >
            {saving ? 'Applying…' : `Apply decisions (${Object.keys(decisions).length})`}
          </button>
        )}
        <button
          className="rounded-lg px-4 py-2 border"
          style={fieldStyle}
          disabled={saving}
          onClick={batch.status === 'complete' ? (onComplete ?? onCancel) : onCancel}
        >
          {batch.status === 'complete' ? 'Done' : 'Close — review stays saved'}
        </button>
      </div>
    </div>
  );
}
