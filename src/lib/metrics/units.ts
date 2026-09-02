// ---------------------------------------------------------------------------
// Vitals input-unit normalization.
//
// The registry pins ONE canonical stored unit per metric (src/lib/metrics/
// registry.ts). Integrations, however, speak whatever unit their source
// hardware or locale produces, so the write path accepts a small, explicit set
// of alternate input units and converts them to the canonical unit BEFORE
// persistence.
//
// The table is keyed on the CANONICAL UNIT, not on a metric key and never on a
// source: acceptance is a property of the unit pair, so every metric stored in
// inches accepts centimetres and every metric stored in pounds accepts
// kilograms, with no per-metric or per-vendor branch anywhere.
//
// Anything not listed here is rejected — the write path never guesses at an
// unrecognized unit.
// ---------------------------------------------------------------------------

import { cmToInches, weightToLbs } from '@/lib/units';

/**
 * canonical unit → alternate input unit → converter into the canonical unit.
 *
 * Matching is exact and case-sensitive (units arrive trimmed from the write
 * schema); an unlisted unit is a 400 rather than a guess.
 *
 * Converters do NOT round to a display precision. Rounding is a presentation
 * concern and lives in src/lib/metrics/format.ts, which renders whatever a
 * metric's `decimals` says (one decimal for circumferences). The one exception
 * is weight, whose kg conversion has always quantized to a tenth of a pound;
 * that is pre-existing stored-value behaviour, not display rounding, so it is
 * preserved deliberately rather than generalized.
 */
const ALTERNATE_INPUT_UNITS: Readonly<
  Record<string, Readonly<Record<string, (value: number) => number>>>
> = {
  // Body-composition mass (weight, fat_free_mass). weightToLbs keeps the
  // established one-decimal quantization so manual entry and the ingest API
  // agree to the gram-ish.
  lbs: { kg: (v) => weightToLbs(v, 'metric') },
  // Body circumferences. The exact quotient is stored — inches are the storage
  // unit, not the display unit, so nothing is discarded on the way in.
  in: { cm: cmToInches },
};

/** Every unit a metric with this canonical unit accepts, canonical first. */
export function acceptedUnitsFor(canonicalUnit: string): readonly string[] {
  return [canonicalUnit, ...Object.keys(ALTERNATE_INPUT_UNITS[canonicalUnit] ?? {})];
}

/**
 * Convert `value` from `unit` into `canonicalUnit`.
 *
 * Returns the converted value, or `undefined` when `unit` is not an accepted
 * input unit for that canonical unit (the caller raises the 400). Passing the
 * canonical unit itself is a no-op, so existing writes that already send the
 * canonical unit are byte-for-byte unchanged.
 */
export function convertToCanonicalUnit(
  canonicalUnit: string,
  unit: string,
  value: number,
): number | undefined {
  if (unit === canonicalUnit) return value;
  const convert = ALTERNATE_INPUT_UNITS[canonicalUnit]?.[unit];
  return convert ? convert(value) : undefined;
}
