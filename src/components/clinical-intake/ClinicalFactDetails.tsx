import {
  formatClinicalDate,
  formatLabOutcome,
  type ClinicalFact,
  type FidelityRecord,
} from '@/lib/fidelity/contracts';
const quantity = (q?: { value: number; unit: string }) =>
  q ? `${q.value} ${q.unit}` : 'Not reported';
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function clinicalFactTitle(fact: ClinicalFact) {
  return fact.kind === 'lab'
    ? fact.test_name
    : fact.kind === 'medication'
      ? fact.name
      : `${fact.event.replaceAll('_', ' ')} · ${formatClinicalDate(fact.event_date)}`;
}
export default function ClinicalFactDetails({
  fact,
  record,
}: {
  fact: ClinicalFact;
  record?: FidelityRecord;
}) {
  const fields: Array<[string, string | undefined | null]> = [];
  if (fact.kind === 'lab')
    fields.push(
      ['Result', formatLabOutcome(fact.outcome)],
      ['Original result text', fact.raw_result],
      ['Source unit', fact.source_unit ?? 'Not reported'],
      [
        'Normalized quantity',
        fact.normalized
          ? `${fact.normalized.value} ${fact.normalized.unit} (${fact.normalized.basis})`
          : undefined,
      ],
      ['Collection', formatClinicalDate(fact.collection_date)],
      ['Collection source text', fact.collection_date.original_text],
      ['Reported', fact.report_date ? formatClinicalDate(fact.report_date) : undefined],
      [
        'Reference interval',
        fact.reference
          ? `${fact.reference.low != null ? `${fact.reference.low_comparator ?? '>='}${fact.reference.low}` : ''}${fact.reference.low != null && fact.reference.high != null ? ' to ' : ''}${fact.reference.high != null ? `${fact.reference.high_comparator ?? '<='}${fact.reference.high}` : ''}${fact.reference.unit ? ` ${fact.reference.unit}` : ''}${fact.reference.text ? ` ${fact.reference.text}` : ''}`.trim()
          : undefined,
      ],
      [
        'Printed laboratory flags',
        fact.printed_flags.length ? fact.printed_flags.join(', ') : 'Not reported',
      ],
      ['Derived interpretation', fact.derived_flag ?? 'Not calculated'],
      ['Panel', fact.panel_name],
      ['Report identity', fact.report_id],
      ['Accession', fact.accession_id],
      ['Specimen identity', fact.specimen_id],
      ['Specimen type', fact.specimen_type],
      ['Printed LOINC', fact.loinc_code],
      ['Fasting status', fact.fasting_status],
      ['Linked dose events', fact.medication_event_ids?.join(', ')]
    );
  if (fact.kind === 'medication')
    fields.push(
      ['Status', fact.status],
      ['Type', fact.supplement ? 'Supplement' : 'Medication'],
      ['Product strength', quantity(fact.product_strength)],
      [
        'Concentration',
        fact.concentration
          ? `${quantity(fact.concentration.numerator)} per ${quantity(fact.concentration.denominator)}`
          : undefined,
      ],
      ['Administered amount', quantity(fact.administered_amount)],
      ['Route', fact.route],
      ['As needed (PRN)', fact.prn === undefined ? 'Not reported' : fact.prn ? 'Yes' : 'No'],
      ['Prescribed directions', fact.prescribed_directions],
      ['Patient-reported actual use', fact.patient_reported_use],
      [
        'Schedule',
        fact.schedule.length
          ? fact.schedule
              .map((s) =>
                [
                  s.weekday !== undefined ? days[s.weekday] : null,
                  s.time_local,
                  s.amount ? quantity(s.amount) : null,
                  s.instructions,
                ]
                  .filter(Boolean)
                  .join(' · ')
              )
              .join('; ')
          : 'Not reported',
      ],
      ['Started', formatClinicalDate(fact.start_date)],
      ['Stopped', formatClinicalDate(fact.end_date)],
      ['Formulation', fact.formulation],
      ['RxNorm identifier', fact.rxcui],
      ['Notes', fact.notes]
    );
  if (fact.kind === 'medication_event')
    fields.push(
      ['Reported event', fact.event.replaceAll('_', ' ')],
      ['Medication record', fact.medication_id],
      ['Event date', formatClinicalDate(fact.event_date)],
      ['Administered amount', fact.amount ? quantity(fact.amount) : undefined],
      ['Notes', fact.notes]
    );
  fields.push(
    ['Evidence basis', fact.provenance.basis.replaceAll('_', ' ')],
    ['Verification', fact.provenance.verification],
    ['Source notes', fact.provenance.notes]
  );
  if (record)
    fields.push(
      ['Received', record.received_at ?? 'Unknown for legacy record'],
      ['Record revision', record.revision.slice(0, 12)]
    );
  return (
    <div className="space-y-3 text-sm">
      <dl className="space-y-2">
        {fields
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([label, value]) => (
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3" key={label}>
              <dt style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
              <dd className="break-words whitespace-pre-wrap min-w-0">{value}</dd>
            </div>
          ))}
      </dl>
      {fact.provenance.sources.length > 0 && (
        <div>
          <p className="font-medium">Source references</p>
          <ul className="list-disc pl-5 space-y-1">
            {fact.provenance.sources.map((source, i) => (
              <li className="break-words" key={i}>
                {source.reference}
                {source.document_id ? ` · Document ${source.document_id}` : ''}
                {source.page ? ` · Page ${source.page}` : ''}
              </li>
            ))}
          </ul>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            A source reference does not grant access to the original document.
          </p>
        </div>
      )}
    </div>
  );
}
