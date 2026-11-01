'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import {
  clinicalDateSchema,
  unknownClinicalDate,
  type ClinicalFact,
} from '@/lib/fidelity/contracts';
type Evidence = {
  clinical_batch_id: string | null;
  id: string;
  dependent_id: string | null;
  file_name: string;
  status: string;
  original_href: string | null;
  warnings: string[];
  coverage: string;
  total_retained: number;
  held: { source_item_id: string; item_key: string; source_row: unknown; issues: string[] }[];
};
export default function TypedDocumentEvidence({
  id,
  onResolve,
}: {
  id: string;
  onResolve: (fact: ClinicalFact) => void;
}) {
  const { dependentId } = useActiveProfile();
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    apiFetch<Evidence>('/api/clinical-intake/documents/' + encodeURIComponent(id))
      .then((data) => {
        if (current) setData(data);
      })
      .catch((error) => {
        if (current)
          setError(
            error instanceof Error ? error.message : 'Could not load retained source evidence.'
          );
      });
    return () => {
      current = false;
    };
  }, [id]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading retained document evidence…</p>;
  if (data.dependent_id !== dependentId)
    return (
      <p role="alert">
        This source document belongs to a different selected person. Choose that person before
        reviewing it.
      </p>
    );
  function resolve(row: Evidence['held'][number]) {
    const raw =
      row.source_row && typeof row.source_row === 'object'
        ? (row.source_row as Record<string, unknown>)
        : {};
    const date = clinicalDateSchema.safeParse(raw.collection_date);
    onResolve({
      kind: 'lab',
      test_name: typeof raw.test_name === 'string' ? raw.test_name : '',
      outcome: { kind: 'text', text: '' },
      raw_result:
        typeof raw.raw_result === 'string'
          ? raw.raw_result
          : typeof raw.raw_text === 'string'
            ? raw.raw_text
            : undefined,
      source_unit:
        typeof raw.source_unit === 'string'
          ? raw.source_unit
          : typeof raw.unit === 'string'
            ? raw.unit
            : null,
      collection_date: date.success
        ? date.data
        : unknownClinicalDate(typeof raw.visit_date === 'string' ? raw.visit_date : null),
      printed_flags: [],
      provenance: {
        basis: 'source_reported',
        verification: 'unconfirmed',
        sources: [
          {
            reference: `${data!.file_name} · clinical-source-item:${row.source_item_id}`,
            document_id: data!.id,
            ...(typeof raw.source_page === 'number' &&
            Number.isInteger(raw.source_page) &&
            raw.source_page > 0
              ? { page: raw.source_page }
              : {}),
          },
        ],
        notes:
          'Manually resolved supported fact from held source evidence; verify the original before approval.',
      },
    });
    document.getElementById('clinical-entry')?.scrollIntoView({ block: 'start' });
  }
  return (
    <section
      className="rounded-xl border p-4 space-y-3"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <h2 className="text-lg font-semibold break-words">Source evidence · {data.file_name}</h2>
      <p className="text-sm">
        {data.status.replaceAll('_', ' ')} · {data.total_retained} retained source rows ·{' '}
        {data.held.length} held in this view
      </p>
      {data.original_href && (
        <a className="underline text-sm" href={data.original_href} target="_blank" rel="noreferrer">
          Open protected original document
        </a>
      )}
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        {data.coverage}
      </p>
      {data.clinical_batch_id && (
        <a
          className="underline text-sm"
          href={
            '/clinical-intake?document_id=' +
            encodeURIComponent(data.id) +
            '&batch_id=' +
            encodeURIComponent(data.clinical_batch_id)
          }
        >
          Open saved typed batch and outcomes
        </a>
      )}
      {data.warnings.map((warning, i) => (
        <p className="text-sm" key={i}>
          {warning}
        </p>
      ))}
      {data.held.length > 0 && (
        <div className="space-y-4">
          <p className="font-medium">These rows were not included in accepted clinical records.</p>
          {data.held.map((row) => (
            <article
              key={row.source_item_id}
              className="rounded-lg border p-3 space-y-2"
              style={{ borderColor: 'var(--border-card)' }}
            >
              <h3 className="font-semibold">{row.item_key}</h3>
              <ul className="list-disc pl-5 text-sm">
                {row.issues.map((issue, i) => (
                  <li className="break-words" key={i}>
                    {issue}
                  </li>
                ))}
              </ul>
              <details>
                <summary className="cursor-pointer text-sm">Retained extraction evidence</summary>
                <pre className="whitespace-pre-wrap break-all text-xs mt-2">
                  {JSON.stringify(row.source_row, null, 2)}
                </pre>
              </details>
              <button type="button" className="underline text-sm" onClick={() => resolve(row)}>
                Resolve this held row in structured entry
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
