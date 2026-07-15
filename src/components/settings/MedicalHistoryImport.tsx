'use client';

/**
 * Settings → Import Medical History.
 *
 * Upload a doctor-provided medical-history PDF (or image), extract everything
 * with AI (POST /api/parse-medical-history), review the items grouped by
 * domain — each pre-deduped against the chosen profile's existing records —
 * then import the approved ones (POST /api/import-medical-history).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { AI_DISCLAIMER } from '@/lib/ai-disclaimer';
import { useDependents } from '@/hooks/useDependents';
import type { DedupeStatus } from '@/lib/import/dedupe';
import type {
  MedicalHistoryReviewItems,
  ParseMedicalHistoryResponse,
} from '@/app/api/parse-medical-history/route';
import type {
  ImportDomainCounts,
  ImportMedicalHistoryResult,
} from '@/app/api/import-medical-history/route';

const MAX_PDF_FILE_SIZE = 50 * 1024 * 1024; // large PDFs are page-chunked server-side
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/** After this long extracting, assume a large document and say so. */
const SLOW_EXTRACTION_NOTICE_MS = 10_000;

type Phase = 'select' | 'extracting' | 'review' | 'importing' | 'done';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--border-card)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 14,
};

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function DedupeBadge({ status }: { status: DedupeStatus }) {
  if (status === 'new') return null;
  const isDuplicate = status === 'duplicate';
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{
        backgroundColor: isDuplicate
          ? 'rgba(155, 155, 155, 0.15)'
          : 'rgba(251, 191, 36, 0.15)',
        color: isDuplicate ? 'var(--color-text-muted)' : 'var(--color-warning)',
      }}
      title={
        isDuplicate
          ? 'An identical entry already exists on this profile.'
          : 'A similar entry (same name, different or missing date) already exists.'
      }
    >
      {isDuplicate ? 'Already on record' : 'Possible match'}
    </span>
  );
}

function ReviewRow({
  checked,
  onToggle,
  title,
  details,
  status,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  details: string[];
  status: DedupeStatus;
}) {
  const detail = details.filter(Boolean).join(' · ');
  return (
    <label
      className="flex items-start gap-3 px-3 py-2 rounded-lg cursor-pointer"
      style={{ backgroundColor: checked ? 'rgba(129, 178, 154, 0.06)' : 'transparent' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1 cursor-pointer"
        style={{ accentColor: 'var(--color-sage)' }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {title}
          </span>
          <DedupeBadge status={status} />
        </div>
        {detail && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {detail}
          </p>
        )}
      </div>
    </label>
  );
}

function DomainGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div
      className="rounded-xl border p-4 space-y-1"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <h3
        className="text-sm font-semibold mb-2"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {label}{' '}
        <span className="font-normal" style={{ color: 'var(--color-text-muted)' }}>
          ({count})
        </span>
      </h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MedicalHistoryImport() {
  const { dependents, loading: dependentsLoading } = useDependents();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('select');
  const [profileId, setProfileId] = useState(''); // '' = myself
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<MedicalHistoryReviewItems | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [slowExtraction, setSlowExtraction] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<ImportMedicalHistoryResult | null>(
    null,
  );

  // Page count isn't known client-side, so infer "large document" from time:
  // after a while extracting, reassure the user that sections are in progress.
  useEffect(() => {
    if (phase !== 'extracting') {
      setSlowExtraction(false);
      return;
    }
    const timer = setTimeout(
      () => setSlowExtraction(true),
      SLOW_EXTRACTION_NOTICE_MS,
    );
    return () => clearTimeout(timer);
  }, [phase]);

  const profileName =
    profileId === ''
      ? 'Myself'
      : dependents.find((d) => d.id === profileId)?.name ?? 'Dependent';

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setError('Only PDF, PNG, and JPG files are accepted.');
      setFile(null);
      return;
    }
    const isPdf = selected.type === 'application/pdf';
    if (selected.size > (isPdf ? MAX_PDF_FILE_SIZE : MAX_IMAGE_FILE_SIZE)) {
      setError(
        isPdf ? 'PDF size must be under 50MB.' : 'Image size must be under 10MB.',
      );
      setFile(null);
      return;
    }
    setFile(selected);
  }, []);

  const handleExtract = useCallback(async () => {
    if (!file) return;
    setPhase('extracting');
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (profileId) formData.append('dependent_id', profileId);

      const res = await fetch('/api/parse-medical-history', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Extraction failed (${res.status})`);
      }

      const { items: parsed, warnings: parseWarnings } =
        (await res.json()) as ParseMedicalHistoryResponse;

      // Default selection: 'new' items checked; duplicates/possible unchecked.
      const initial = new Set<string>();
      (['medications', 'conditions', 'allergies', 'procedures', 'vaccines'] as const)
        .forEach((domain) => {
          parsed[domain].forEach((item, i) => {
            if (item.dedupe_status === 'new') initial.add(`${domain}:${i}`);
          });
        });
      parsed.lab_visits.forEach((visit, vi) => {
        visit.results.forEach((r, ri) => {
          if (r.dedupe_status === 'new') initial.add(`lab:${vi}:${ri}`);
        });
      });

      setItems(parsed);
      setWarnings(parseWarnings ?? []);
      setSelection(initial);
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract document');
      setPhase('select');
    }
  }, [file, profileId]);

  const toggle = useCallback((key: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const totalExtracted = useMemo(() => {
    if (!items) return 0;
    return (
      items.medications.length +
      items.conditions.length +
      items.allergies.length +
      items.procedures.length +
      items.vaccines.length +
      items.lab_visits.reduce((sum, v) => sum + v.results.length, 0)
    );
  }, [items]);

  const handleImport = useCallback(async () => {
    if (!items) return;
    setPhase('importing');
    setError(null);
    try {
      // dedupe_status stays on each item; the server strips unknown keys and
      // re-runs dedupe authoritatively anyway.
      const payload = {
        dependent_id: profileId || null,
        medications: items.medications.filter((_, i) => selection.has(`medications:${i}`)),
        conditions: items.conditions.filter((_, i) => selection.has(`conditions:${i}`)),
        allergies: items.allergies.filter((_, i) => selection.has(`allergies:${i}`)),
        procedures: items.procedures.filter((_, i) => selection.has(`procedures:${i}`)),
        vaccines: items.vaccines.filter((_, i) => selection.has(`vaccines:${i}`)),
        lab_visits: items.lab_visits
          .map((visit, vi) => ({
            visit_date: visit.visit_date,
            results: visit.results.filter((_, ri) => selection.has(`lab:${vi}:${ri}`)),
          }))
          .filter((visit) => visit.results.length > 0),
      };

      const res = await fetch('/api/import-medical-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Import failed (${res.status})`);
      }
      setImportResult((await res.json()) as ImportMedicalHistoryResult);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import items');
      setPhase('review');
    }
  }, [items, profileId, selection]);

  const reset = useCallback(() => {
    setPhase('select');
    setFile(null);
    setItems(null);
    setWarnings([]);
    setSelection(new Set());
    setImportResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const errorBanner = error && (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={{
        backgroundColor: 'rgba(224, 122, 95, 0.1)',
        color: 'var(--color-terracotta)',
        border: '1px solid rgba(248,113,113,0.2)',
      }}
    >
      {error}
    </div>
  );

  if (phase === 'select' || phase === 'extracting') {
    const extracting = phase === 'extracting';
    return (
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Upload a complete medical-history document from a doctor&apos;s office —
          medications, conditions, allergies, procedures, vaccines, and lab
          results are extracted, checked against existing records, and imported
          only after your review.
        </p>

        <div>
          <label
            className="block text-xs font-medium mb-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Import into profile
          </label>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={extracting || dependentsLoading}
            style={{ ...inputStyle, maxWidth: 320, width: '100%' }}
          >
            <option value="">Myself</option>
            {dependents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            className="block text-xs font-medium mb-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Document (PDF up to 50MB; PNG, JPG up to 10MB)
          </label>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={handleFileChange}
            disabled={extracting}
            className="block text-sm cursor-pointer"
            style={{ color: 'var(--color-text-primary)' }}
          />
        </div>

        {errorBanner}

        <button
          type="button"
          onClick={handleExtract}
          disabled={!file || extracting}
          className="px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
          style={{
            background:
              'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
            color: 'white',
            boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
          }}
        >
          {extracting ? (
            <span className="flex items-center gap-2">
              <LoadingSpinner size="sm" />
              {slowExtraction
                ? 'Large document — processing in sections…'
                : 'Extracting with AI…'}
            </span>
          ) : (
            'Extract'
          )}
        </button>
      </div>
    );
  }

  if (phase === 'done' && importResult) {
    const rows: { label: string; counts: ImportDomainCounts }[] = [
      { label: 'Medications', counts: importResult.medications },
      { label: 'Conditions', counts: importResult.conditions },
      { label: 'Allergies', counts: importResult.allergies },
      { label: 'Procedures', counts: importResult.procedures },
      { label: 'Vaccines', counts: importResult.vaccines },
      { label: 'Lab results', counts: importResult.lab_results },
    ];
    const totals = rows.reduce(
      (acc, r) => ({
        created: acc.created + r.counts.created,
        skipped_duplicates: acc.skipped_duplicates + r.counts.skipped_duplicates,
        errors: acc.errors + r.counts.errors,
      }),
      { created: 0, skipped_duplicates: 0, errors: 0 },
    );
    return (
      <div className="space-y-4">
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(129, 178, 154, 0.1)',
            color: 'var(--color-sage)',
            border: '1px solid rgba(129, 178, 154, 0.2)',
          }}
        >
          Imported {totals.created} item{totals.created !== 1 ? 's' : ''} into{' '}
          {profileName}
          {totals.skipped_duplicates > 0 &&
            `, skipped ${totals.skipped_duplicates} duplicate${totals.skipped_duplicates !== 1 ? 's' : ''}`}
          {totals.errors > 0 && `, ${totals.errors} failed`}.
        </div>

        <div
          className="rounded-xl border overflow-x-auto"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
        >
          <table className="w-full text-sm" style={{ minWidth: 420 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-card)' }}>
                {['Domain', 'Imported', 'Skipped (duplicate)', 'Errors'].map((h) => (
                  <th
                    key={h}
                    className="text-left px-3 py-2 text-xs font-medium"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} style={{ borderBottom: '1px solid var(--border-card)' }}>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text-primary)' }}>
                    {r.label}
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text-primary)' }}>
                    {r.counts.created}
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>
                    {r.counts.skipped_duplicates}
                  </td>
                  <td
                    className="px-3 py-2"
                    style={{
                      color:
                        r.counts.errors > 0
                          ? 'var(--color-terracotta)'
                          : 'var(--color-text-muted)',
                    }}
                  >
                    {r.counts.errors}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={reset}
          className="px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-sage)',
            border: '1px solid var(--border-card)',
          }}
        >
          Import another document
        </button>
      </div>
    );
  }

  // Review / importing
  if (!items) return null;
  const importing = phase === 'importing';

  return (
    <div className="space-y-4">
      {/* AI extraction disclaimer */}
      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{
          backgroundColor: 'rgba(233, 196, 106, 0.08)',
          borderLeft: '3px solid var(--color-warning)',
          color: 'var(--color-text-primary)',
        }}
      >
        AI-extracted values can contain errors. Check each item against the
        original document before importing. {AI_DISCLAIMER}
      </div>

      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        {totalExtracted} item{totalExtracted !== 1 ? 's' : ''} extracted for{' '}
        <span style={{ color: 'var(--color-text-primary)' }}>{profileName}</span>.
        Items already on record are unchecked — tick them only if you want them
        imported anyway.
      </p>

      {warnings.length > 0 && (
        <div
          className="rounded-lg px-4 py-2.5 text-xs space-y-0.5"
          style={{
            backgroundColor: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.25)',
            color: 'var(--color-warning)',
          }}
        >
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {totalExtracted === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Nothing could be extracted from this document.
        </p>
      ) : (
        <>
          <DomainGroup label="Medications" count={items.medications.length}>
            {items.medications.map((m, i) => (
              <ReviewRow
                key={`medications:${i}`}
                checked={selection.has(`medications:${i}`)}
                onToggle={() => toggle(`medications:${i}`)}
                title={m.name}
                details={[
                  m.dosage ?? '',
                  m.frequency ?? '',
                  m.start_date ? `from ${m.start_date}` : '',
                  m.active === false ? 'inactive' : '',
                  m.notes ?? '',
                ]}
                status={m.dedupe_status}
              />
            ))}
          </DomainGroup>

          <DomainGroup label="Conditions" count={items.conditions.length}>
            {items.conditions.map((c, i) => (
              <ReviewRow
                key={`conditions:${i}`}
                checked={selection.has(`conditions:${i}`)}
                onToggle={() => toggle(`conditions:${i}`)}
                title={c.name}
                details={[
                  c.status ?? '',
                  c.diagnosed_date ? `diagnosed ${c.diagnosed_date}` : '',
                  c.notes ?? '',
                ]}
                status={c.dedupe_status}
              />
            ))}
          </DomainGroup>

          <DomainGroup label="Allergies" count={items.allergies.length}>
            {items.allergies.map((a, i) => (
              <ReviewRow
                key={`allergies:${i}`}
                checked={selection.has(`allergies:${i}`)}
                onToggle={() => toggle(`allergies:${i}`)}
                title={a.name}
                details={[
                  a.severity ? a.severity.replace('_', ' ') : 'severity not stated',
                  a.reaction ?? '',
                  a.notes ?? '',
                ]}
                status={a.dedupe_status}
              />
            ))}
          </DomainGroup>

          <DomainGroup label="Procedures" count={items.procedures.length}>
            {items.procedures.map((p, i) => (
              <ReviewRow
                key={`procedures:${i}`}
                checked={selection.has(`procedures:${i}`)}
                onToggle={() => toggle(`procedures:${i}`)}
                title={p.name}
                details={[p.procedure_date ?? 'no date', p.notes ?? '']}
                status={p.dedupe_status}
              />
            ))}
          </DomainGroup>

          <DomainGroup label="Vaccines" count={items.vaccines.length}>
            {items.vaccines.map((v, i) => (
              <ReviewRow
                key={`vaccines:${i}`}
                checked={selection.has(`vaccines:${i}`)}
                onToggle={() => toggle(`vaccines:${i}`)}
                title={v.name}
                details={[
                  v.vaccine_date ?? 'no date',
                  v.dose_number !== null ? `dose ${v.dose_number}` : '',
                  v.manufacturer ?? '',
                ]}
                status={v.dedupe_status}
              />
            ))}
          </DomainGroup>

          <DomainGroup
            label="Lab results"
            count={items.lab_visits.reduce((sum, v) => sum + v.results.length, 0)}
          >
            {items.lab_visits.map((visit, vi) => (
              <div key={`visit:${vi}`} className="space-y-1">
                <p
                  className="text-xs font-medium mt-2"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Visit {visit.visit_date}
                </p>
                {visit.results.map((r, ri) => (
                  <ReviewRow
                    key={`lab:${vi}:${ri}`}
                    checked={selection.has(`lab:${vi}:${ri}`)}
                    onToggle={() => toggle(`lab:${vi}:${ri}`)}
                    title={r.test_name}
                    details={[
                      `${r.value}${r.unit ? ` ${r.unit}` : ''}`,
                      r.flag && r.flag !== 'normal' ? r.flag : '',
                      r.reference_range_text ? `ref ${r.reference_range_text}` : '',
                    ]}
                    status={r.dedupe_status}
                  />
                ))}
              </div>
            ))}
          </DomainGroup>
        </>
      )}

      {errorBanner}

      <div className="flex flex-wrap gap-3">
        {totalExtracted > 0 && (
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || selection.size === 0}
            className="px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
            style={{
              background:
                'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))',
              color: 'white',
              boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)',
            }}
          >
            {importing ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner size="sm" />
                Importing…
              </span>
            ) : (
              `Import selected (${selection.size})`
            )}
          </button>
        )}
        <button
          type="button"
          onClick={reset}
          disabled={importing}
          className="px-5 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--border-card)',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
