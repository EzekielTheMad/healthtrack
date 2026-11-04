import {
  formatClinicalDate,
  type ClinicalDate,
  type ClinicalFact,
  type FidelityRecord,
} from './contracts';
type ReportedStatistic = Extract<ClinicalFact, { kind: 'pap_report' }>['statistics'][number];

/** Clinical chronology never falls back to report, signature or server receipt time. */
export function clinicalFactDate(fact: ClinicalFact): ClinicalDate | undefined {
  switch (fact.kind) {
    case 'lab':
      return fact.collection_date;
    case 'medication':
      return fact.start_date;
    case 'medication_event':
      return fact.event_date;
    case 'encounter':
      return fact.encounter_date;
    case 'sleep_study':
      return fact.study_date;
    case 'pap_report':
      return undefined; // A bounded aggregate window, not a daily event.
    case 'screening':
      return fact.administration_date;
    case 'procedure':
      return fact.procedure_date;
    case 'condition':
      return fact.onset_date ?? fact.diagnosis_date;
    case 'allergy_review':
      return fact.review_date;
    case 'genetic_report':
      return fact.event_date;
  }
}
export type EncounterObservationSeries = {
  id: string;
  label: string;
  unit: string;
  context: string;
  statistic: string;
  definition: string;
  source: string;
  points: { id: string; record_id: string; date: string; value: number; observation_key: string }[];
};
/** Only actual, comparable dated observations enter a trend; no daily averaging or carry-forward. */
export function encounterObservationSeries(
  records: FidelityRecord[]
): EncounterObservationSeries[] {
  const groups = new Map<string, EncounterObservationSeries>();
  for (const record of records) {
    const f = record.fact;
    if (
      f.kind !== 'encounter' ||
      record.legacy_conflict ||
      f.provenance.verification === 'conflict'
    )
      continue;
    const source = f.provenance.sources
      .map((s) => s.document_id ?? s.reference)
      .sort()
      .join('; ');
    if (!source) continue;
    for (const o of f.observations) {
      const observed = o.observed_at ?? f.encounter_date;
      if (
        !['day', 'instant'].includes(observed.precision) ||
        observed.approximate ||
        o.context === 'unknown' ||
        o.statistic === 'unknown'
      )
        continue;
      if (o.metric === 'other' && !o.definition) continue;
      const id = JSON.stringify([
        o.metric,
        o.label ?? '',
        o.quantity.unit,
        o.context,
        o.statistic,
        o.definition ?? '',
        source,
        observed.precision,
      ]);
      if (!groups.has(id))
        groups.set(id, {
          id,
          label: o.label ?? human(o.metric),
          unit: o.quantity.unit,
          context: o.context,
          statistic: o.statistic,
          definition: o.definition ?? 'Not reported',
          source,
          points: [],
        });
      groups.get(id)!.points.push({
        id: `${record.id}:${o.observation_key}`,
        record_id: record.id,
        date: observed.value!,
        value: o.quantity.value,
        observation_key: o.observation_key,
      });
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    points: group.points.sort(
      (a, b) =>
        (a.date.includes('T') && b.date.includes('T')
          ? Date.parse(a.date) - Date.parse(b.date)
          : a.date.localeCompare(b.date)) || a.id.localeCompare(b.id)
    ),
  }));
}
const human = (text: string) => text.replaceAll('_', ' ');
const shown = (value: string | number | boolean | null | undefined) =>
  value == null ? 'not reported' : String(value);
const date = (value?: ClinicalDate) =>
  value
    ? `${formatClinicalDate(value)}${value.precision !== 'unknown' ? ` [${value.precision}]${value.original_text ? `; original: ${value.original_text}` : ''}` : ''}`
    : 'Date not reported';
function statistic(s: ReportedStatistic): string {
  const value =
    s.value == null
      ? (s.qualitative ?? 'not reported')
      : `${s.value}${s.unit ? ` ${s.unit}` : ''}${s.qualitative ? `; ${s.qualitative}` : ''}`;
  return `${s.label} [${s.key}]: ${value}; statistic: ${human(s.statistic)}${s.definition ? `; definition: ${s.definition}` : ''}${s.averaging_denominator ? `; averaging denominator: ${s.averaging_denominator.label}, ${shown(s.averaging_denominator.value)}${s.averaging_denominator.unit ? ` ${s.averaging_denominator.unit}` : ''}` : ''}`;
}
/** Lossless, labelled text for the web, authorized context, doctor summary and exports. */
export function webClinicalSummaryRow(record: FidelityRecord): {
  id: string;
  title: string;
  date: string;
  lines: string[];
} {
  const f = record.fact;
  const lines: string[] = [];
  const pushDate = (label: string, value?: ClinicalDate) => {
    if (value) lines.push(`${label}: ${date(value)}`);
  };
  let title = human(f.kind);
  let primaryDate = date(clinicalFactDate(f));
  if ('name' in f) title = f.name;
  switch (f.kind) {
    case 'encounter':
      lines.push(
        `Encounter ID: ${shown(f.encounter_id)}`,
        `Provider: ${shown(f.provider)}; location: ${shown(f.location)}`
      );
      for (const o of f.observations)
        lines.push(
          `${o.label ?? human(o.metric)} [${o.observation_key}]: ${o.quantity.value} ${o.quantity.unit}; context: ${human(o.context)}; statistic: ${human(o.statistic)}${o.observed_at ? `; observed: ${date(o.observed_at)}` : ''}${o.definition ? `; definition: ${o.definition}` : ''}`
        );
      pushDate('Signed', f.signed_date);
      break;
    case 'sleep_study':
      lines.push(`Study type: ${human(f.study_type)}; study ID: ${shown(f.study_id)}`);
      if (f.reported_interpretation)
        lines.push(`Reported interpretation: ${f.reported_interpretation}`);
      lines.push(...f.indices.map(statistic));
      for (const s of f.oxygen_statistics)
        lines.push(
          `${s.label}: ${s.value} ${s.unit}; oxygen statistic: ${human(s.statistic)}${s.definition ? `; definition: ${s.definition}` : ''}`
        );
      for (const s of f.time_below_thresholds)
        lines.push(
          `${s.label}: ${s.duration.value} ${s.duration.unit} at ${s.comparator}${s.threshold_percent}%${s.denominator ? `; denominator: ${s.denominator}` : ''}`
        );
      if (f.total_recording_time)
        lines.push(
          `Total recording time: ${f.total_recording_time.value} ${f.total_recording_time.unit}`
        );
      if (f.total_sleep_time)
        lines.push(`Total sleep time: ${f.total_sleep_time.value} ${f.total_sleep_time.unit}`);
      pushDate('Signed', f.signed_date);
      break;
    case 'pap_report':
      primaryDate = `Report window: ${date(f.window_start)} – ${date(f.window_end)}`;
      lines.push(
        `Therapy: ${human(f.therapy)}; report ID: ${shown(f.report_id)}`,
        'Aggregate report window; no daily measurements inferred. Overlapping windows must not be summed.'
      );
      lines.push(...f.statistics.map(statistic));
      for (const a of f.adherence)
        lines.push(
          `${a.label}: ${shown(a.numerator)} / ${shown(a.denominator)} ${a.count_unit}; denominator definition: ${shown(a.denominator_definition)}${a.threshold ? `; threshold: ${a.threshold_comparator ?? '(comparator unknown)'} ${a.threshold.value} ${a.threshold.unit}` : ''}; reported percentage: ${a.reported_percentage == null ? 'not reported' : a.reported_percentage + '%'}`
        );
      break;
    case 'screening':
      title = `${f.instrument.name}${f.instrument.version ? ` (${f.instrument.version})` : ''}`;
      lines.push(
        `Instrument: ${f.instrument.name}; version: ${shown(f.instrument.version)}`,
        `Record type: ${human(f.record_type)}; completeness: ${f.completeness}`,
        `Reported total: ${shown(f.reported_total)}${f.score_unit ? ` ${f.score_unit}` : ''}`
      );
      if (f.copied_from_record_id) lines.push(`Copied from record: ${f.copied_from_record_id}`);
      for (const r of f.item_responses)
        lines.push(`Item ${r.label ?? r.key} [${r.key}]: ${shown(r.value)}`);
      for (const r of f.functional_responses)
        lines.push(`Functional response ${r.label ?? r.key} [${r.key}]: ${shown(r.value)}`);
      if (f.qualitative_result) lines.push(`Reported qualitative result: ${f.qualitative_result}`);
      lines.push(
        'Reported total, individual items and functional responses are separate evidence; no score or diagnosis calculated.'
      );
      break;
    case 'condition':
      lines.push(
        `Certainty: ${f.certainty}; activity: ${f.activity}; temporal scope: ${human(f.temporal_scope)}`
      );
      pushDate('Onset', f.onset_date);
      pushDate('Diagnosis', f.diagnosis_date);
      pushDate('End', f.end_date);
      lines.push(
        ...f.codes.map((c) => `Code: ${c.system} ${c.code}${c.display ? ` (${c.display})` : ''}`)
      );
      break;
    case 'procedure':
      lines.push(`Procedure status: ${f.status}`, `Provider: ${shown(f.provider)}`);
      lines.push(
        ...f.events.map(
          (e) => `Event: ${e.status}; ${date(e.event_date)}${e.notes ? `; ${e.notes}` : ''}`
        )
      );
      lines.push(
        ...f.codes.map((c) => `Code: ${c.system} ${c.code}${c.display ? ` (${c.display})` : ''}`)
      );
      break;
    case 'allergy_review':
      title = `Allergy review: ${human(f.review_status)}`;
      lines.push(
        `Review status: ${human(f.review_status)}`,
        `Review scope: ${f.scope}; reviewed by: ${shown(f.reviewed_by)}`,
        'Review evidence is separate from individual allergen records; an empty allergy list does not establish a negative review.'
      );
      break;
    case 'genetic_report':
      lines.push(`Report type: ${human(f.report_type)}`);
      lines.push(
        ...f.findings.map(
          (r) =>
            `${r.label}: ${r.qualitative_result}; gene: ${shown(r.gene)}; variant: ${shown(r.variant)}; reported classification: ${shown(r.reported_classification)}`
        )
      );
      if (f.counseling_summary) lines.push(`Counseling summary: ${f.counseling_summary}`);
      break;
    default:
      throw new Error('Use the existing lab and medication presentation for this record.');
  }
  if ('report_date' in f) pushDate('Reported', f.report_date);
  if ('notes' in f && f.notes) lines.push(`Notes: ${f.notes}`);
  lines.push(`Evidence: ${human(f.provenance.basis)}; ${human(f.provenance.verification)}`);
  lines.push(
    ...f.provenance.sources.map(
      (s) =>
        `Source: ${s.reference}${s.document_id ? `; document: ${s.document_id}` : ''}${s.page ? `; page ${s.page}` : ''}`
    )
  );
  if (f.provenance.notes) lines.push(`Evidence notes: ${f.provenance.notes}`);
  if (record.legacy)
    lines.unshift('Legacy evidence; unrecorded certainty and completion remain unknown.');
  if (record.legacy_conflict)
    lines.unshift(
      'CONFLICT: Legacy source changed after correction. Review both versions before treating either as current.'
    );
  else if (f.provenance.verification === 'conflict')
    lines.unshift(
      'CONFLICT: Source evidence is explicitly marked conflicting; review before treating it as current.'
    );
  return { id: record.id, title, date: primaryDate, lines };
}
