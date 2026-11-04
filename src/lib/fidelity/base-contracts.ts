/** Shared clinical calendar dates and source evidence; client-safe. */
import { z } from 'zod';
import { isValidDayKey } from '@/lib/dates';

const text = z.string().trim().min(1).max(4000);
const optionalText = text.nullish();
const dateBase = {
  original_text: z.string().max(1000).nullish(),
  approximate: z.boolean().optional(),
};
export const clinicalDateSchema = z.discriminatedUnion('precision', [
  z.object({ ...dateBase, precision: z.literal('unknown'), value: z.null() }).strict(),
  z
    .object({
      ...dateBase,
      precision: z.literal('year'),
      value: z
        .string()
        .regex(/^\d{4}$/)
        .refine((v) => Number(v) > 0),
    })
    .strict(),
  z
    .object({
      ...dateBase,
      precision: z.literal('month'),
      value: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .refine((v) => Number(v.slice(0, 4)) > 0),
    })
    .strict(),
  z
    .object({ ...dateBase, precision: z.literal('day'), value: z.string().refine(isValidDayKey) })
    .strict(),
  z
    .object({
      ...dateBase,
      precision: z.literal('instant'),
      value: z.iso.datetime({ offset: true }),
      timezone: z
        .string()
        .max(100)
        .refine((v) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: v });
            return true;
          } catch {
            return false;
          }
        })
        .optional(),
    })
    .strict(),
]);
export type ClinicalDate = z.infer<typeof clinicalDateSchema>;
export const unknownClinicalDate = (originalText?: string | null): ClinicalDate => ({
  precision: 'unknown',
  value: null,
  ...(originalText ? { original_text: originalText } : {}),
});
export function formatClinicalDate(date?: ClinicalDate | null): string {
  if (!date) return 'Date not reported';
  if (date.precision === 'unknown')
    return date.original_text ? `${date.original_text} (precision unknown)` : 'Date unknown';
  return `${date.approximate ? 'Approximately ' : ''}${date.value}${date.precision === 'instant' && date.timezone ? ` (${date.timezone})` : ''}`;
}
export const sourceReferenceSchema = z
  .object({
    reference: text,
    document_id: z.string().min(1).max(200).optional(),
    page: z.number().int().min(1).max(100000).optional(),
  })
  .strict();
export const provenanceSchema = z
  .object({
    basis: z.enum(['source_reported', 'patient_reported', 'derived', 'legacy_unknown']),
    verification: z.enum(['unconfirmed', 'source_verified', 'conflict']).default('unconfirmed'),
    sources: z.array(sourceReferenceSchema).max(30).default([]),
    notes: optionalText,
  })
  .strict();
