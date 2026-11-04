/** Shared typed fidelity contracts. Existing numeric/day interfaces remain compatible. */
import { z } from 'zod';
import { clinicalDateSchema, provenanceSchema } from './base-contracts';
export * from './base-contracts';
import { webClinicalFactSchemas, WEB_CLINICAL_KINDS } from './web-clinical-contracts';
import { vendorScanResultsSchema, type DerivedScanMeasurement } from './web-scan-contracts';
export * from './web-clinical-contracts';
export * from './web-scan-contracts';
export const CLINICAL_KINDS = [
  'lab',
  'medication',
  'medication_event',
  ...WEB_CLINICAL_KINDS,
] as const;
const text = z.string().trim().min(1).max(4000);
const optionalText = text.nullish();
const comparator = z.enum(['=', '<', '<=', '>', '>=']);
export const labOutcomeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('numeric'),
      value: z.number().finite(),
      comparator: z.literal('=').default('='),
    })
    .strict(),
  z
    .object({
      kind: z.literal('censored'),
      value: z.number().finite(),
      comparator: z.enum(['<', '<=', '>', '>=']),
    })
    .strict(),
  z.object({ kind: z.literal('text'), text }).strict(),
  z.object({ kind: z.literal('canceled'), reason: optionalText }).strict(),
]);
export type LabOutcome = z.infer<typeof labOutcomeSchema>;
export function formatLabOutcome(outcome: LabOutcome): string {
  if (outcome.kind === 'text') return outcome.text;
  if (outcome.kind === 'canceled') return `Canceled${outcome.reason ? `: ${outcome.reason}` : ''}`;
  return `${outcome.comparator === '=' ? '' : outcome.comparator}${outcome.value}`;
}
export const labFactSchema = z
  .object({
    kind: z.literal('lab'),
    test_name: text,
    outcome: labOutcomeSchema,
    raw_result: optionalText,
    source_unit: z.string().max(100).nullish(),
    normalized: z
      .object({ value: z.number().finite(), unit: text, basis: text })
      .strict()
      .optional(),
    reference: z
      .object({
        low: z.number().finite().nullish(),
        high: z.number().finite().nullish(),
        low_comparator: comparator.optional(),
        high_comparator: comparator.optional(),
        text: optionalText,
        unit: z.string().max(100).nullish(),
      })
      .strict()
      .refine(
        (v) => v.low == null || v.high == null || v.low <= v.high,
        'Reference bounds are reversed.'
      )
      .optional(),
    printed_flags: z.array(z.string().max(100)).max(20).default([]),
    derived_flag: z.enum(['high', 'low', 'within_range', 'unknown']).optional(),
    collection_date: clinicalDateSchema,
    report_date: clinicalDateSchema.optional(),
    panel_name: optionalText,
    specimen_id: optionalText,
    specimen_type: optionalText,
    report_id: optionalText,
    accession_id: optionalText,
    loinc_code: optionalText,
    fasting_status: z.enum(['fasted', 'fed', 'unknown']).optional(),
    medication_event_ids: z.array(z.string().min(1).max(200)).max(30).optional(),
    provenance: provenanceSchema,
  })
  .strict()
  .refine(
    (v) => !v.normalized || v.outcome.kind === 'numeric' || v.outcome.kind === 'censored',
    'Only numeric/bounded outcomes may have a normalized quantity.'
  );
const quantity = z.object({ value: z.number().finite().nonnegative(), unit: text }).strict();
export const medicationFactSchema = z
  .object({
    kind: z.literal('medication'),
    name: text,
    supplement: z.boolean().default(false),
    status: z.enum(['active', 'historical', 'discontinued', 'unconfirmed']),
    product_strength: quantity.optional(),
    concentration: z.object({ numerator: quantity, denominator: quantity }).strict().optional(),
    administered_amount: quantity.optional(),
    route: optionalText,
    prn: z.boolean().optional(),
    prescribed_directions: optionalText,
    patient_reported_use: optionalText,
    schedule: z
      .array(
        z
          .object({
            weekday: z.number().int().min(0).max(6).optional(),
            time_local: z
              .string()
              .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
              .optional(),
            amount: quantity.optional(),
            instructions: optionalText,
          })
          .strict()
      )
      .max(28)
      .default([]),
    start_date: clinicalDateSchema.optional(),
    end_date: clinicalDateSchema.optional(),
    rxcui: z.string().max(100).nullish(),
    formulation: optionalText,
    notes: optionalText,
    provenance: provenanceSchema,
  })
  .strict();
export const medicationEventSchema = z
  .object({
    kind: z.literal('medication_event'),
    medication_id: z.string().min(1).max(200),
    event: z.enum(['administration', 'missed', 'intentional_skip']),
    event_date: clinicalDateSchema,
    amount: quantity.optional(),
    notes: optionalText,
    provenance: provenanceSchema,
  })
  .strict()
  .refine(
    (v) => v.event === 'administration' || v.amount === undefined,
    'A missed/skipped event cannot record an administered amount.'
  );
export const clinicalFactSchema = z.union([
  labFactSchema,
  medicationFactSchema,
  medicationEventSchema,
  ...webClinicalFactSchemas,
]);
export type ClinicalFact = z.infer<typeof clinicalFactSchema>;
export const intakeItemSchema = z
  .object({
    item_key: z.string().min(1).max(200),
    action: z.enum(['add', 'correct', 'link', 'skip']),
    target_id: z.string().min(1).max(200).optional(),
    expected_revision: z.string().min(1).max(200).optional(),
    reason: optionalText,
    fact: clinicalFactSchema,
  })
  .strict()
  .refine(
    (v) => !['correct', 'link'].includes(v.action) || Boolean(v.target_id && v.expected_revision),
    'Correction/link requires selected target and expected revision.'
  );
export const intakeSchema = z
  .object({
    external_id: z.string().min(1).max(200),
    items: z.array(intakeItemSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.item_key)).size === v.items.length,
    'Item keys must be unique.'
  );
export type ClinicalIntake = z.infer<typeof intakeSchema>;
export type FidelityRecord = {
  id: string;
  user_id: string;
  dependent_id: string | null;
  kind: ClinicalFact['kind'];
  fact: ClinicalFact;
  revision: string;
  received_at: string | null;
  updated_at: string;
  legacy?: boolean;
  supersedes_legacy?: {
    table: 'lab_results' | 'medications' | 'conditions' | 'procedures';
    id: string;
    revision: string;
  };
  legacy_conflict?: boolean;
};

export const CORE_SCAN_METRICS = [
  'skeletal_muscle_mass',
  'body_fat_mass',
  'total_body_water',
  'intracellular_water',
  'extracellular_water',
  'ecw_ratio',
  'visceral_fat_area',
] as const;
export const scanInputSchema = z
  .object({
    external_id: z.string().min(1).max(200),
    source: z.string().trim().min(1).max(100),
    manufacturer: optionalText,
    model: optionalText,
    method: z.enum(['bia', 'dxa', 'tape', 'other', 'unknown']),
    measured_at: clinicalDateSchema,
    conditions: z
      .object({
        workout_status: z.enum(['pre_workout', 'post_workout', 'unknown']).default('unknown'),
        workout_at: clinicalDateSchema.optional(),
        fasting_status: z.enum(['fasted', 'fed', 'unknown']).default('unknown'),
        notes: optionalText,
      })
      .strict()
      .optional(),
    supplement_record_ids: z.array(z.string().min(1).max(200)).max(30).optional(),
    measurements: z
      .array(
        z
          .object({
            metric_key: z.string().min(1).max(100),
            value: z.number().finite(),
            unit: z.string().min(1).max(100),
            raw_text: z.string().max(1000).optional(),
            definition: z.string().trim().min(1).max(4000).optional(),
          })
          .strict()
      )
      .min(1)
      .max(50),
    provenance: provenanceSchema,
    vendor_results: vendorScanResultsSchema.optional(),
  })
  .strict()
  .refine(
    (v) => new Set(v.measurements.map((m) => m.metric_key)).size === v.measurements.length,
    'A scan cannot contain the same metric twice.'
  );
export type ScanInput = z.infer<typeof scanInputSchema>;
export type ScanMeasurement = {
  metric_key: string;
  value: number;
  unit: string | null;
  source_value: number;
  source_unit: string;
  raw_text?: string;
  definition?: string;
  estimated: boolean;
};
export type BodyScan = {
  id: string;
  user_id: string;
  dependent_id: string | null;
  scan: ScanInput;
  measurements: ScanMeasurement[];
  derived_measurements?: DerivedScanMeasurement[];
  revision: string;
  received_at: string;
};
