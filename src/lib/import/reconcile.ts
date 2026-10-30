import { normalizeName } from './dedupe';

export const IMPORT_DOMAINS = [
  'medications',
  'conditions',
  'allergies',
  'procedures',
  'vaccines',
  'lab_results',
] as const;
export type ImportDomain = (typeof IMPORT_DOMAINS)[number];
export type Claim = Record<string, unknown>;
export type Classification = 'new' | 'duplicate' | 'possible' | 'conflict';
export interface Candidate {
  id: string;
  values: Claim;
}
export interface Reconciliation {
  classification: Classification;
  matches: Candidate[];
}

export function isFullDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const dateFields: Record<ImportDomain, string> = {
  medications: 'start_date',
  conditions: 'diagnosed_date',
  allergies: 'diagnosed_date',
  procedures: 'procedure_date',
  vaccines: 'vaccine_date',
  lab_results: 'visit_date',
};
const descriptiveKeys: Record<ImportDomain, string[]> = {
  medications: ['name', 'dosage', 'frequency', 'start_date', 'end_date', 'active', 'notes'],
  conditions: ['name', 'status', 'diagnosed_date', 'notes'],
  allergies: ['name', 'severity', 'reaction', 'diagnosed_date', 'notes'],
  procedures: ['name', 'procedure_date', 'notes'],
  vaccines: [
    'name',
    'vaccine_date',
    'dose_number',
    'series_doses',
    'manufacturer',
    'lot_number',
    'notes',
  ],
  lab_results: [
    'test_name',
    'loinc_code',
    'visit_date',
    'panel_name',
    'value',
    'unit',
    'reference_range_low',
    'reference_range_high',
    'reference_range_text',
    'flag',
  ],
};
function canonical(value: unknown, key?: string): unknown {
  return typeof value === 'string'
    ? key === 'name' || key === 'test_name' || key === 'panel_name'
      ? normalizeName(value)
      : value.trim()
    : (value ?? null);
}
export function compatibleSpecimen(left: Claim, right: Claim): boolean {
  return !['accession_id', 'specimen_id', 'collected_at'].some(
    (key) =>
      typeof left[key] === 'string' &&
      left[key] !== '' &&
      typeof right[key] === 'string' &&
      right[key] !== '' &&
      left[key] !== right[key]
  );
}

function labCode(claim: Claim): string | null {
  return typeof claim.loinc_code === 'string' && claim.loinc_code.trim() !== ''
    ? claim.loinc_code.trim()
    : null;
}
function sameLabCode(left: Claim, right: Claim): boolean {
  return labCode(left) !== null && labCode(left) === labCode(right);
}
function conflictingLabCodes(left: Claim, right: Claim): boolean {
  return labCode(left) !== null && labCode(right) !== null && labCode(left) !== labCode(right);
}

/** Name and date identify candidates, never prove that a clinical event repeats. */
export function reconcile(
  domain: ImportDomain,
  claim: Claim,
  existing: Candidate[]
): Reconciliation {
  const nameKey = domain === 'lab_results' ? 'test_name' : 'name';
  const name = canonical(claim[nameKey], nameKey);
  const dateKey = dateFields[domain];
  let matches = existing.filter(
    (row) =>
      canonical(row.values[nameKey], nameKey) === name ||
      (domain === 'lab_results' && sameLabCode(claim, row.values))
  );
  // A differently printed label can still merit human review. Equal date/value/unit
  // supplies alternatives only; without the same printed LOINC, it cannot prove
  // analyte identity, even with matching accession/specimen evidence.
  if (domain === 'lab_results' && matches.length === 0 && isFullDate(claim.visit_date)) {
    matches = existing.filter(
      (row) =>
        row.values.visit_date === claim.visit_date &&
        typeof claim.value === 'number' &&
        Number.isFinite(claim.value) &&
        row.values.value === claim.value &&
        typeof claim.unit === 'string' &&
        claim.unit.trim() !== '' &&
        canonical(row.values.unit, 'unit') === canonical(claim.unit, 'unit') &&
        compatibleSpecimen(claim, row.values) &&
        !conflictingLabCodes(claim, row.values)
    );
  }
  if (matches.length === 0) return { classification: 'new', matches: [] };
  const dated = matches.filter(
    (row) => isFullDate(claim[dateKey]) && row.values[dateKey] === claim[dateKey]
  );
  const relevant = dated.length > 0 ? dated : matches;
  const allEqual = (row: Candidate) =>
    descriptiveKeys[domain].every(
      (key) =>
        (domain === 'lab_results' && key === 'test_name' && sameLabCode(claim, row.values)) ||
        canonical(row.values[key], key) === canonical(claim[key], key)
    );
  // Labs can have multiple draws on one day. Require a source accession/specimen
  // identity in addition to the complete value; name/date/value alone is ambiguous.
  const strongLabIdentity = (row: Candidate) =>
    ['accession_id', 'specimen_id', 'collected_at'].some((key) => {
      const value = claim[key];
      return (
        typeof value === 'string' &&
        value.trim() !== '' &&
        !/^(unknown|n\/?a|none)$/i.test(value.trim()) &&
        (key !== 'collected_at' || /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) &&
        row.values[key] === value
      );
    });
  const meaningfulDetail = descriptiveKeys[domain].some(
    (key) =>
      key !== nameKey &&
      key !== dateKey &&
      claim[key] !== null &&
      claim[key] !== undefined &&
      claim[key] !== ''
  );
  if (
    meaningfulDetail &&
    relevant.length === 1 &&
    dated.length === 1 &&
    allEqual(relevant[0]) &&
    (domain !== 'lab_results' ||
      (strongLabIdentity(relevant[0]) &&
        compatibleSpecimen(claim, relevant[0].values) &&
        !conflictingLabCodes(claim, relevant[0].values)))
  ) {
    return { classification: 'duplicate', matches: relevant };
  }
  const conflicts = dated.some((row) =>
    descriptiveKeys[domain].some(
      (key) =>
        !(domain === 'lab_results' && key === 'test_name') &&
        claim[key] !== null &&
        claim[key] !== undefined &&
        row.values[key] !== null &&
        row.values[key] !== undefined &&
        canonical(claim[key], key) !== canonical(row.values[key], key)
    )
  );
  return { classification: conflicts ? 'conflict' : 'possible', matches: relevant };
}
