/**
 * Pure dedupe helpers for the medical-history importer.
 *
 * Extracted items are matched against the target profile's existing rows and
 * marked with a {@link DedupeStatus}:
 *
 *   - medications / conditions / allergies: normalized-name match → 'duplicate'
 *   - procedures / vaccines: name + date exact → 'duplicate';
 *     name-only match → 'possible'
 *   - lab results: visit_date + test_name match → 'duplicate'
 *
 * Everything here is pure (no DB, no I/O) so the same logic runs in the parse
 * route (annotating the review payload) and the import route (authoritative
 * server-side re-check — client checkboxes are advisory only).
 *
 * The index builders return plain Sets so callers can add newly created rows
 * during an import batch, making repeated items within one document dedupe
 * against each other.
 */

export type DedupeStatus = 'new' | 'duplicate' | 'possible';

/** Lowercase, trim, and collapse internal whitespace runs to single spaces. */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Trimmed date string, or null when absent/blank. */
export function normalizeDate(date: string | null | undefined): string | null {
  const trimmed = date?.trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Name-only domains (medications, conditions, allergies)
// ---------------------------------------------------------------------------

/** Index of normalized names. */
export function buildNameIndex(names: Iterable<string>): Set<string> {
  const index = new Set<string>();
  for (const name of names) index.add(normalizeName(name));
  return index;
}

/** Name match → 'duplicate'; otherwise 'new'. */
export function dedupeByName(
  name: string,
  index: ReadonlySet<string>,
): DedupeStatus {
  return index.has(normalizeName(name)) ? 'duplicate' : 'new';
}

// ---------------------------------------------------------------------------
// Name + date domains (procedures, vaccines)
// ---------------------------------------------------------------------------

export interface NameDateIndex {
  /** `${normalizedName}@@${date}` keys for rows that have a date. */
  nameDates: Set<string>;
  /** Normalized names of all rows (dated or not). */
  names: Set<string>;
}

function nameDateKey(name: string, date: string): string {
  return `${normalizeName(name)}@@${date}`;
}

export function buildNameDateIndex(
  rows: Iterable<{ name: string; date: string | null | undefined }>,
): NameDateIndex {
  const index: NameDateIndex = { nameDates: new Set(), names: new Set() };
  for (const row of rows) addNameDate(index, row.name, row.date);
  return index;
}

/** Record a row (e.g. one just created) so later items dedupe against it. */
export function addNameDate(
  index: NameDateIndex,
  name: string,
  date: string | null | undefined,
): void {
  index.names.add(normalizeName(name));
  const normalizedDate = normalizeDate(date);
  if (normalizedDate !== null) {
    index.nameDates.add(nameDateKey(name, normalizedDate));
  }
}

/**
 * Exact name + date match → 'duplicate'; name-only match (including items
 * with no date) → 'possible'; otherwise 'new'.
 */
export function dedupeByNameDate(
  name: string,
  date: string | null | undefined,
  index: NameDateIndex,
): DedupeStatus {
  const normalizedDate = normalizeDate(date);
  if (normalizedDate !== null && index.nameDates.has(nameDateKey(name, normalizedDate))) {
    return 'duplicate';
  }
  return index.names.has(normalizeName(name)) ? 'possible' : 'new';
}

// ---------------------------------------------------------------------------
// Lab results (visit_date + test_name)
// ---------------------------------------------------------------------------

/** Key for one lab result: visit date + normalized test name. */
export function labResultKey(visitDate: string, testName: string): string {
  return `${normalizeDate(visitDate) ?? ''}@@${normalizeName(testName)}`;
}

export function buildLabResultIndex(
  rows: Iterable<{ visitDate: string; testName: string }>,
): Set<string> {
  const index = new Set<string>();
  for (const row of rows) index.add(labResultKey(row.visitDate, row.testName));
  return index;
}

/** visit_date + test_name match → 'duplicate'; otherwise 'new'. */
export function dedupeLabResult(
  visitDate: string | null | undefined,
  testName: string,
  index: ReadonlySet<string>,
): DedupeStatus {
  const normalizedDate = normalizeDate(visitDate);
  if (normalizedDate === null) return 'new';
  return index.has(labResultKey(normalizedDate, testName)) ? 'duplicate' : 'new';
}
