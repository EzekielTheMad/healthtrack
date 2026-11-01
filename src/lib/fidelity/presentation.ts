import {
  formatClinicalDate,
  formatLabOutcome,
  type BodyScan,
  type ClinicalDate,
  type FidelityRecord,
} from './contracts';
import { calendarDayInTimeZone } from '@/lib/oura/timezone';
import { isValidDayKey } from '@/lib/dates';

export interface FidelitySummaryRow {
  id: string;
  title: string;
  date: string;
  lines: string[];
}
/** Existing legacy arrays already carry untouched rows; only add typed/explicit conflict evidence. */
export function clinicalConsumerRecords(records: FidelityRecord[]): FidelityRecord[] {
  const conflictedBases = new Set(
    records
      .filter((record) => record.legacy_conflict && record.supersedes_legacy)
      .map(
        (record) =>
          `legacy:${record.supersedes_legacy!.table === 'lab_results' ? 'lab' : 'medication'}:${record.supersedes_legacy!.id}`
      )
  );
  return records
    .filter((record) => !record.legacy || conflictedBases.has(record.id))
    .map((record) =>
      conflictedBases.has(record.id) ? { ...record, legacy_conflict: true } : record
    );
}
/** Doctor summaries use collection dates, never late-import receipt order, for exact labs. */
type LegacyDoctorLab = {
  testName: string;
  loincCode?: string | null;
  unit?: string | null;
  visitDate: string;
};
export function doctorLabIdentity(name: string, loinc?: string | null, unit?: string | null) {
  return `${loinc ?? name.trim().toLowerCase()}@@${unit ?? ''}`;
}
export function clinicalDoctorRecords(
  records: FidelityRecord[],
  timezone: string,
  legacyLabs: LegacyDoctorLab[] = []
) {
  const current = clinicalConsumerRecords(records);
  const exactDay = (record: FidelityRecord) =>
    record.fact.kind !== 'lab' || record.fact.collection_date.approximate
      ? null
      : record.fact.collection_date.precision === 'day'
        ? record.fact.collection_date.value
        : record.fact.collection_date.precision === 'instant'
          ? calendarDayInTimeZone(new Date(record.fact.collection_date.value), timezone)
          : null;
  const key = (record: FidelityRecord) =>
    record.fact.kind === 'lab'
      ? doctorLabIdentity(record.fact.test_name, record.fact.loinc_code, record.fact.source_unit)
      : record.id;
  const latest = new Map<string, string>();
  for (const lab of legacyLabs) {
    const identity = doctorLabIdentity(lab.testName, lab.loincCode, lab.unit);
    if (isValidDayKey(lab.visitDate) && lab.visitDate > (latest.get(identity) ?? ''))
      latest.set(identity, lab.visitDate);
  }
  for (const record of current) {
    const day = exactDay(record);
    if (day && !record.legacy_conflict && day > (latest.get(key(record)) ?? ''))
      latest.set(key(record), day);
  }
  const selected = current.filter(
    (record) =>
      record.legacy_conflict ||
      record.fact.kind !== 'lab' ||
      exactDay(record) === null ||
      exactDay(record) === latest.get(key(record))
  );
  const limited = selected.slice(0, 200);
  return {
    records: limited,
    latestLabDates: latest,
    warnings: [
      ...(selected.length > 200
        ? [
            'Typed clinical doctor history is limited to 200 results/courses/events; full export retains all evidence.',
          ]
        : []),
      ...(current.some((record) => record.fact.kind === 'lab' && !exactDay(record))
        ? [
            'Labs with partial or unknown collection dates are shown as uncertain history, not ranked as latest exact results.',
          ]
        : []),
    ],
  };
}
/** Partial dates are compared at their own precision, never assigned invented days. */
export function dateIntersectsWindow(
  date: ClinicalDate | undefined,
  start: string,
  end: string,
  timezone: string
): boolean {
  if (!date || date.precision === 'unknown') return true;
  if (date.precision === 'instant') {
    const day = calendarDayInTimeZone(new Date(date.value), timezone);
    return day >= start && day <= end;
  }
  return (
    date.value >= start.slice(0, date.value.length) && date.value <= end.slice(0, date.value.length)
  );
}
export function clinicalSummaryRow(record: FidelityRecord): FidelitySummaryRow {
  const f = record.fact;
  const source = f.provenance.sources
    .map((s) => `${s.reference}${s.page ? `, page ${s.page}` : ''}`)
    .join('; ');
  const lines: string[] = [
    `Evidence: ${f.provenance.basis}; ${f.provenance.verification}${source ? `; ${source}` : ''}`,
  ];
  if (record.legacy_conflict)
    lines.unshift(
      'CONFLICT: The legacy source changed after typed correction. These versions require review; neither establishes an unqualified current result.'
    );
  if (record.legacy) lines.unshift('Historical legacy source evidence, shown for conflict review.');
  let title: string, date: string;
  if (f.kind === 'lab') {
    title = `${f.test_name}: ${formatLabOutcome(f.outcome)}${f.source_unit ? ` ${f.source_unit}` : ''}`;
    date = formatClinicalDate(f.collection_date);
    if (f.raw_result) lines.push(`Original result: ${f.raw_result}`);
    if (f.normalized)
      lines.push(
        `Normalized: ${f.normalized.value} ${f.normalized.unit}; basis: ${f.normalized.basis}; comparator remains ${'comparator' in f.outcome ? f.outcome.comparator : 'not applicable'}`
      );
    if (f.reference)
      lines.push(
        `Reference: ${f.reference.text ?? ''}${f.reference.low != null ? ` ${f.reference.low_comparator ?? '>='}${f.reference.low}` : ''}${f.reference.high != null ? ` ${f.reference.high_comparator ?? '<='}${f.reference.high}` : ''}${f.reference.unit ? ` ${f.reference.unit}` : ''}`.trim()
      );
    lines.push(
      `Printed flags: ${f.printed_flags.length ? f.printed_flags.join(', ') : 'not reported'}`
    );
    if (f.derived_flag)
      lines.push(`Derived interpretation (not a printed flag): ${f.derived_flag}`);
    if (f.report_date) lines.push(`Report: ${formatClinicalDate(f.report_date)}`);
    if (f.panel_name) lines.push(`Panel: ${f.panel_name}`);
    if (f.specimen_id || f.specimen_type)
      lines.push(
        `Specimen: ${f.specimen_id ?? 'identity unknown'}; ${f.specimen_type ?? 'type unknown'}`
      );
    if (f.report_id || f.accession_id)
      lines.push(`Report/accession: ${f.report_id ?? 'unknown'} / ${f.accession_id ?? 'unknown'}`);
    if (f.fasting_status) lines.push(`Fasting status: ${f.fasting_status}`);
    if (f.medication_event_ids?.length)
      lines.push(`Linked dose events: ${f.medication_event_ids.join(', ')}`);
  } else if (f.kind === 'medication') {
    title = `${f.name}${f.supplement ? ' (supplement)' : ''} — ${f.status}`;
    date = `${formatClinicalDate(f.start_date)} to ${formatClinicalDate(f.end_date)}`;
    if (f.product_strength)
      lines.push(`Product strength: ${f.product_strength.value} ${f.product_strength.unit}`);
    if (f.concentration)
      lines.push(
        `Concentration: ${f.concentration.numerator.value} ${f.concentration.numerator.unit} / ${f.concentration.denominator.value} ${f.concentration.denominator.unit}`
      );
    if (f.administered_amount)
      lines.push(`Reported amount: ${f.administered_amount.value} ${f.administered_amount.unit}`);
    if (f.route) lines.push(`Route: ${f.route}`);
    if (f.prn !== undefined) lines.push(`As needed: ${f.prn ? 'yes' : 'no'}`);
    lines.push(
      `Prescribed directions: ${f.prescribed_directions ?? 'not reported'}`,
      `Patient-reported actual use: ${f.patient_reported_use ?? 'not reported'}`
    );
    for (const dose of f.schedule)
      lines.push(
        `Schedule: ${dose.weekday === undefined ? 'day not specified' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dose.weekday]}${dose.time_local ? ` ${dose.time_local}` : ''}${dose.amount ? `; ${dose.amount.value} ${dose.amount.unit}` : ''}${dose.instructions ? `; ${dose.instructions}` : ''}`
      );
    if (f.notes) lines.push(f.notes);
  } else {
    title = `Medication event: ${f.event.replaceAll('_', ' ')} (${f.medication_id})`;
    date = formatClinicalDate(f.event_date);
    if (f.amount) lines.push(`Administered amount: ${f.amount.value} ${f.amount.unit}`);
    if (f.notes) lines.push(f.notes);
    lines.push(
      'This is an explicitly reported event. Missing events do not establish missed doses.'
    );
  }
  if (f.provenance.notes) lines.push(`Source notes: ${f.provenance.notes}`);
  lines.push(
    `Record ${record.id}; revision ${record.revision}; ${record.received_at ? `received ${record.received_at} (not the clinical date)` : 'receipt time unknown'}`
  );
  return { id: record.id, title, date, lines };
}
export function scanSummaryRow(record: BodyScan): FidelitySummaryRow {
  const s = record.scan;
  return {
    id: record.id,
    title: `${s.source} — ${s.manufacturer ?? 'manufacturer unknown'} ${s.model ?? ''} (${s.method}${s.method === 'bia' ? ' estimates' : ''})`,
    date: formatClinicalDate(s.measured_at),
    lines: [
      ...record.measurements.map(
        (m) =>
          `${m.metric_key}: ${m.source_value} ${m.source_unit}${m.raw_text ? ` [original: ${m.raw_text}]` : ''}; canonical ${m.value} ${m.unit ?? ''}${m.estimated ? ' (estimate)' : ''}`
      ),
      `Conditions: workout ${s.conditions?.workout_status ?? 'unknown'}; fasting ${s.conditions?.fasting_status ?? 'unknown'}${s.conditions?.notes ? `; ${s.conditions.notes}` : ''}`,
      ...(s.conditions?.workout_at
        ? [`Workout time: ${formatClinicalDate(s.conditions.workout_at)}`]
        : []),
      ...s.provenance.sources.map(
        (source) => `Source: ${source.reference}${source.page ? `, page ${source.page}` : ''}`
      ),
      `Evidence: ${s.provenance.basis}; ${s.provenance.verification}`,
      `Scan ${record.id}; received ${record.received_at} (not the measurement date)`,
      'Compare only compatible sources/devices/collection conditions. Muscle and water compartments overlap and must not be added together.',
    ],
  };
}
