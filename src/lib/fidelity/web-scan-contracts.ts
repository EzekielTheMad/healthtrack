/** Report-only scan extensions; never add these outputs to legacy feed write grants. */
import { z } from 'zod';
const label = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(4000);
const reference = z
  .object({
    low: z.number().finite().nullish(),
    high: z.number().finite().nullish(),
    unit: label.nullish(),
    text: note.nullish(),
  })
  .strict();
export const vendorScanResultsSchema = z
  .object({
    scores: z
      .array(
        z
          .object({
            key: label,
            name: label,
            value: z.union([z.number().finite(), note]),
            unit: label.nullish(),
            definition: note.nullish(),
            reference: reference.optional(),
          })
          .strict()
      )
      .max(50)
      .default([]),
    body_age: z
      .object({
        value: z.union([z.number().finite().nonnegative(), note]),
        unit: label,
        definition: note.nullish(),
        reference: reference.optional(),
      })
      .strict()
      .optional(),
    reference_bands: z
      .array(z.object({ metric_key: label.optional(), label, reference }).strict())
      .max(100)
      .default([]),
    recommendations: z
      .array(
        z
          .object({
            name: label,
            text: note,
            value: z.number().finite().nullish(),
            unit: label.nullish(),
          })
          .strict()
      )
      .max(50)
      .default([]),
  })
  .strict();
export const WEB_SCAN_METRICS = [
  'lean_mass_left_arm',
  'lean_mass_right_arm',
  'lean_mass_left_leg',
  'lean_mass_right_leg',
  'lean_mass_trunk',
  'fat_mass_left_arm',
  'fat_mass_right_arm',
  'fat_mass_left_leg',
  'fat_mass_right_leg',
  'fat_mass_trunk',
  'soft_lean_mass',
  'subcutaneous_fat_mass',
  'visceral_fat_mass',
  'protein_mass',
  'mineral_mass',
  'bone_mineral_content',
  'body_cell_mass',
  'phase_angle',
  'skeletal_muscle_index',
  'ecw_ratio_left_arm',
  'ecw_ratio_right_arm',
  'ecw_ratio_left_leg',
  'ecw_ratio_right_leg',
  'ecw_ratio_trunk',
] as const;
export type DerivedScanMeasurement = {
  metric_key: 'ecw_ratio' | 'body_fat_pct' | 'body_water_pct';
  value: number;
  unit: 'fraction' | '%';
  basis: 'derived';
  formula: string;
  input_metric_keys: string[];
};
