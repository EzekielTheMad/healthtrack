/** WC1 reported clinical evidence. No automatic scoring, diagnoses or daily expansion. */
import { z } from 'zod';
import { clinicalDateSchema, provenanceSchema } from './base-contracts';

const label = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(4000);
const notes = note.nullish();
const quantity = z.object({ value: z.number().finite(), unit: label }).strict();
const duration = z
  .object({ value: z.number().finite().nonnegative(), unit: z.enum(['s', 'min', 'h']) })
  .strict();
const common = { provenance: provenanceSchema, notes };
const code = z.object({ system: label, code: label, display: notes }).strict();
export const observationContexts = [
  'office_spot',
  'home_spot',
  'overnight_aggregate',
  'other',
  'unknown',
] as const;
export const encounterMeasurementSchema = z
  .object({
    observation_key: label,
    metric: z.enum([
      'heart_rate',
      'height',
      'weight',
      'systolic_bp',
      'diastolic_bp',
      'respiratory_rate',
      'oxygen_saturation',
      'temperature',
      'other',
    ]),
    label: label.optional(),
    quantity,
    context: z.enum(observationContexts).default('unknown'),
    observed_at: clinicalDateSchema.optional(),
    statistic: z
      .enum(['spot', 'mean', 'median', 'minimum', 'maximum', 'unknown'])
      .default('unknown'),
    definition: notes,
  })
  .strict()
  .superRefine((v, ctx) => {
    const units: Partial<Record<typeof v.metric, string[]>> = {
      heart_rate: ['bpm', 'beats/min'],
      height: ['cm', 'in', 'm'],
      weight: ['kg', 'lbs'],
      systolic_bp: ['mmHg'],
      diastolic_bp: ['mmHg'],
      respiratory_rate: ['breaths/min'],
      oxygen_saturation: ['%'],
      temperature: ['°C', '°F', 'C', 'F'],
    };
    if (units[v.metric] && !units[v.metric]!.includes(v.quantity.unit))
      ctx.addIssue({
        code: 'custom',
        path: ['quantity', 'unit'],
        message: `Unsupported ${v.metric} unit.`,
      });
    if (v.metric === 'oxygen_saturation' && (v.quantity.value < 0 || v.quantity.value > 100))
      ctx.addIssue({
        code: 'custom',
        path: ['quantity', 'value'],
        message: 'Oxygen saturation must be a percentage from 0 through 100.',
      });
  });
export const encounterFactSchema = z
  .object({
    ...common,
    kind: z.literal('encounter'),
    name: label,
    encounter_date: clinicalDateSchema,
    signed_date: clinicalDateSchema.optional(),
    report_date: clinicalDateSchema.optional(),
    encounter_id: label.optional(),
    provider: notes,
    location: notes,
    observations: z.array(encounterMeasurementSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.observations.map((o) => o.observation_key)).size === v.observations.length,
    'Observation keys must be unique; same-day measurements need distinct keys, not collapsing.'
  );

export const reportedStatisticSchema = z
  .object({
    key: label,
    label,
    value: z.number().finite().nullish(),
    unit: label.nullish(),
    qualitative: notes,
    statistic: z
      .enum([
        'reported',
        'spot',
        'mean',
        'median',
        'minimum',
        'maximum',
        'total',
        'percentile',
        'unknown',
      ])
      .default('unknown'),
    definition: notes,
    averaging_denominator: z
      .object({ label, value: z.number().finite().nonnegative().nullish(), unit: label.nullish() })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => (v.value != null && Boolean(v.unit)) || Boolean(v.qualitative),
    'Provide a numeric value with its reported unit, or a qualitative result.'
  );
const oxygenStatistic = z
  .object({
    label,
    statistic: z.enum(['minimum', 'mean', 'baseline', 'other', 'unknown']),
    value: z.number().finite().min(0).max(100),
    unit: z.literal('%'),
    definition: notes,
  })
  .strict();
const timeBelow = z
  .object({
    label,
    comparator: z.enum(['<', '<=', '>', '>=']),
    threshold_percent: z.number().finite().min(0).max(100),
    duration,
    denominator: notes,
  })
  .strict();
export const sleepStudyFactSchema = z
  .object({
    ...common,
    kind: z.literal('sleep_study'),
    name: label,
    study_type: z.enum([
      'polysomnography',
      'home_sleep_apnea_test',
      'titration',
      'split_night',
      'other',
      'unknown',
    ]),
    study_date: clinicalDateSchema,
    report_date: clinicalDateSchema.optional(),
    signed_date: clinicalDateSchema.optional(),
    study_id: label.optional(),
    reported_interpretation: notes,
    indices: z.array(reportedStatisticSchema).max(50).default([]),
    oxygen_statistics: z.array(oxygenStatistic).max(30).default([]),
    time_below_thresholds: z.array(timeBelow).max(30).default([]),
    total_recording_time: duration.optional(),
    total_sleep_time: duration.optional(),
  })
  .strict();
export const papAdherenceSchema = z
  .object({
    label,
    numerator: z.number().int().nonnegative().nullish(),
    denominator: z.number().int().nonnegative().nullish(),
    count_unit: label,
    denominator_definition: notes,
    threshold: quantity.optional(),
    threshold_comparator: z.enum(['>', '>=', '<', '<=', '=']).optional(),
    reported_percentage: z.number().finite().min(0).max(100).nullish(),
  })
  .strict();
export const papReportFactSchema = z
  .object({
    ...common,
    kind: z.literal('pap_report'),
    name: label,
    window_start: clinicalDateSchema,
    window_end: clinicalDateSchema,
    report_date: clinicalDateSchema.optional(),
    report_id: label.optional(),
    therapy: z.enum(['cpap', 'apap', 'bilevel', 'asv', 'other', 'unknown']).default('unknown'),
    statistics: z.array(reportedStatisticSchema).max(100).default([]),
    adherence: z.array(papAdherenceSchema).max(30).default([]),
  })
  .strict()
  .refine((v) => {
    if (v.window_start.precision === 'day' && v.window_end.precision === 'day')
      return v.window_start.value <= v.window_end.value;
    if (v.window_start.precision === 'instant' && v.window_end.precision === 'instant')
      return Date.parse(v.window_start.value) <= Date.parse(v.window_end.value);
    return true;
  }, 'An exact report-window end must not precede its start.');

const response = z
  .object({
    key: label,
    label: label.optional(),
    value: z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]),
  })
  .strict();
export const screeningFactSchema = z
  .object({
    ...common,
    kind: z.literal('screening'),
    instrument: z.object({ name: label, version: label.nullish() }).strict(),
    administration_date: clinicalDateSchema,
    report_date: clinicalDateSchema.optional(),
    record_type: z.enum(['administration', 'copied_history', 'unknown']),
    copied_from_record_id: label.optional(),
    reported_total: z.number().finite().nullish(),
    score_unit: label.nullish(),
    item_responses: z.array(response).max(200).default([]),
    functional_responses: z.array(response).max(50).default([]),
    qualitative_result: notes,
    completeness: z.enum(['complete', 'partial', 'unknown']).default('unknown'),
  })
  .strict()
  .refine(
    (v) => !v.copied_from_record_id || v.record_type === 'copied_history',
    'A copied source reference must be identified as copied history.'
  );

export const procedureStatuses = [
  'ordered',
  'planned',
  'cancelled',
  'deferred',
  'completed',
  'unknown',
] as const;
export const procedureFactSchema = z
  .object({
    ...common,
    kind: z.literal('procedure'),
    name: label,
    status: z.enum(procedureStatuses),
    procedure_date: clinicalDateSchema.optional(),
    report_date: clinicalDateSchema.optional(),
    events: z
      .array(
        z
          .object({ status: z.enum(procedureStatuses), event_date: clinicalDateSchema, notes })
          .strict()
      )
      .max(100)
      .default([]),
    codes: z.array(code).max(30).default([]),
    provider: notes,
  })
  .strict();
export const conditionFactSchema = z
  .object({
    ...common,
    kind: z.literal('condition'),
    name: label,
    certainty: z.enum(['confirmed', 'suspected', 'ruled_out', 'unknown']),
    activity: z.enum(['active', 'resolved', 'inactive', 'remission', 'unknown']),
    temporal_scope: z.enum(['current', 'historical', 'family_history', 'unknown']),
    onset_date: clinicalDateSchema.optional(),
    diagnosis_date: clinicalDateSchema.optional(),
    end_date: clinicalDateSchema.optional(),
    report_date: clinicalDateSchema.optional(),
    codes: z.array(code).max(30).default([]),
  })
  .strict();
export const allergyReviewFactSchema = z
  .object({
    ...common,
    kind: z.literal('allergy_review'),
    review_status: z.enum(['unknown', 'reviewed_no_known_allergies', 'allergies_recorded']),
    review_date: clinicalDateSchema,
    scope: label,
    reviewed_by: notes,
  })
  .strict();
export const geneticReportFactSchema = z
  .object({
    ...common,
    kind: z.literal('genetic_report'),
    name: label,
    report_type: z.enum([
      'test_result',
      'counseling',
      'family_history',
      'personal_history',
      'unknown',
    ]),
    event_date: clinicalDateSchema,
    report_date: clinicalDateSchema.optional(),
    findings: z
      .array(
        z
          .object({
            label,
            qualitative_result: note,
            gene: label.nullish(),
            variant: notes,
            reported_classification: notes,
          })
          .strict()
      )
      .max(100)
      .default([]),
    counseling_summary: notes,
  })
  .strict();

export const webClinicalFactSchemas = [
  encounterFactSchema,
  sleepStudyFactSchema,
  papReportFactSchema,
  screeningFactSchema,
  procedureFactSchema,
  conditionFactSchema,
  allergyReviewFactSchema,
  geneticReportFactSchema,
] as const;
export const webClinicalFactSchema = z.union(webClinicalFactSchemas);
export type WebClinicalFact = z.infer<typeof webClinicalFactSchema>;
export const WEB_CLINICAL_KINDS = [
  'encounter',
  'sleep_study',
  'pap_report',
  'screening',
  'procedure',
  'condition',
  'allergy_review',
  'genetic_report',
] as const;
export const CLINICAL_KIND_SECTIONS = {
  lab: 'labs',
  medication: 'medications',
  medication_event: 'medications',
  encounter: 'vitals',
  sleep_study: 'vitals',
  pap_report: 'vitals',
  screening: 'conditions',
  procedure: 'procedures',
  condition: 'conditions',
  allergy_review: 'allergies',
  genetic_report: 'conditions',
} as const;
