// ---------------------------------------------------------------------------
// Unit conversion utilities.
// DB always stores imperial (height_inches, weight_lbs).
// Conversion happens at the display/input layer only.
// ---------------------------------------------------------------------------

export type UnitSystem = 'imperial' | 'metric';

// -- Conversion constants --
const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.453592;

// -- Low-level converters --

export function inchesToCm(inches: number): number {
  return inches * CM_PER_INCH;
}

export function cmToInches(cm: number): number {
  return cm / CM_PER_INCH;
}

export function lbsToKg(lbs: number): number {
  return lbs * KG_PER_LB;
}

export function kgToLbs(kg: number): number {
  return kg / KG_PER_LB;
}

// -- Display formatters --

/** Format height stored as total inches for display. */
export function formatHeight(totalInches: number, system: UnitSystem): string {
  if (system === 'metric') {
    const cm = Math.round(inchesToCm(totalInches));
    return `${cm} cm`;
  }
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

/** Format weight stored as lbs for display. */
export function formatWeight(lbs: number, system: UnitSystem): string {
  if (system === 'metric') {
    const kg = lbsToKg(lbs);
    return `${kg.toFixed(1)} kg`;
  }
  return `${lbs} lbs`;
}

// -- Input parsers (convert user input back to DB units) --

/** Convert a height input value to total inches for DB storage. */
export function heightToInches(
  value: number,
  system: UnitSystem,
): number {
  if (system === 'metric') {
    return Math.round(cmToInches(value));
  }
  // If imperial, value is already total inches
  return value;
}

/** Convert a weight input value to lbs for DB storage. */
export function weightToLbs(
  value: number,
  system: UnitSystem,
): number {
  if (system === 'metric') {
    return Math.round(kgToLbs(value) * 10) / 10;
  }
  return value;
}

/** Convert stored inches to display value for an input field. */
export function inchesToDisplayHeight(totalInches: number, system: UnitSystem): number {
  if (system === 'metric') {
    return Math.round(inchesToCm(totalInches));
  }
  return totalInches;
}

/** Convert stored lbs to display value for an input field. */
export function lbsToDisplayWeight(lbs: number, system: UnitSystem): number {
  if (system === 'metric') {
    return Math.round(lbsToKg(lbs) * 10) / 10;
  }
  return lbs;
}
