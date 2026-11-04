'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { apiFetch } from '@/lib/api/client';
import type { ClinicalFact, FidelityRecord } from '@/lib/fidelity/contracts';
import ClinicalFactDetails, { clinicalFactTitle } from './ClinicalFactDetails';
import { isWebClinicalKind, webClinicalKindLabels } from './WebClinicalFactFields';
export default function ClinicalRecordsPanel({ kind }: { kind?: ClinicalFact['kind'] }) {
  const profile = useActiveProfile();
  return (
    <Panel
      key={`${profile.delegateOwnerId ?? 'own'}:${profile.dependentId ?? 'self'}:${kind ?? 'all'}`}
      kind={kind}
    />
  );
}
function Panel({ kind }: { kind?: ClinicalFact['kind'] }) {
  const { dependentId, delegateOwnerId } = useActiveProfile();
  const [records, setRecords] = useState<FidelityRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ limit: '200' });
    if (kind) query.set('kind', kind);
    if (dependentId) query.set('dependent_id', dependentId);
    if (delegateOwnerId) query.set('owner_id', delegateOwnerId);
    const queries =
      kind === 'medication'
        ? [query, new URLSearchParams({ ...Object.fromEntries(query), kind: 'medication_event' })]
        : [query];
    Promise.all(
      queries.map((params) =>
        apiFetch<{ records: FidelityRecord[] }>('/api/clinical-records?' + params)
      )
    )
      .then((result) => {
        if (active) {
          setRecords(
            result
              .flatMap((response) => response.records)
              .filter((record) => !record.legacy || record.legacy_conflict)
          );
          setError(null);
        }
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : 'Could not load detailed history.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dependentId, delegateOwnerId, kind]);
  return (
    <section
      className="rounded-xl border p-4 space-y-3"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {kind === 'lab'
            ? 'Qualified lab history'
            : kind === 'medication'
              ? 'Structured medication and supplement history'
              : kind && isWebClinicalKind(kind)
                ? webClinicalKindLabels[kind] + ' history'
                : 'Detailed clinical history'}
        </h2>
        <Link
          className="text-sm underline"
          href={kind ? '/clinical-intake?kind=' + kind : '/clinical-intake'}
        >
          {delegateOwnerId ? 'Read clinical history' : 'Add / import / review'}
        </Link>
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Typed outcomes retain qualifiers and date precision. Superseded legacy values are omitted
        from ordinary lists and numeric trends; unresolved versions remain available in detailed
        review.
      </p>
      {loading ? (
        <p role="status" className="text-sm">
          Loading detailed history…
        </p>
      ) : error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : records.length ? (
        <ul className="space-y-3">
          {records.map((record) => (
            <li
              className="border-t pt-3 space-y-2"
              style={{ borderColor: 'var(--border-card)' }}
              key={record.id}
            >
              <h3 className="font-medium break-words">{clinicalFactTitle(record.fact)}</h3>
              {record.legacy_conflict && (
                <p className="text-sm font-medium" style={{ color: 'var(--color-terracotta)' }}>
                  Legacy version conflict — review both versions.
                </p>
              )}
              <ClinicalFactDetails fact={record.fact} record={record} />
              {!delegateOwnerId && (
                <Link
                  className="text-sm underline"
                  href={'/clinical-intake?record_id=' + encodeURIComponent(record.id)}
                >
                  Review a correction
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          No additional typed history recorded for this person.
        </p>
      )}
    </section>
  );
}
