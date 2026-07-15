/**
 * Pure merge of per-chunk medical-history extractions into one result.
 *
 * When a large PDF is split into page chunks (see chunk-pdf.ts), items that
 * span or repeat across chunk boundaries (medication lists reprinted on every
 * page, a lab visit whose results straddle two chunks, ...) come back more
 * than once. This module concatenates each domain across chunks and collapses
 * cross-chunk repeats using the SAME normalization as the dedupe helpers:
 *
 *   - medications / conditions / allergies: keyed by normalized name; when a
 *     name repeats, the entry with MORE non-null fields wins (first wins ties)
 *   - procedures / vaccines: keyed by normalized name + normalized date; the
 *     richer entry wins. Entries without a date are kept separately from dated
 *     entries with the same name (identical undated repeats still collapse)
 *   - lab_visits: merged by visit_date; within a visit, results are deduped by
 *     normalized test_name (first occurrence wins)
 *
 * First-seen order is preserved everywhere. Pure (no DB, no I/O).
 */
import type {
  ExtractedLabResult,
  ExtractedLabVisit,
  ParsedMedicalHistory,
} from '@/lib/claude/parse-medical-history';
import { normalizeDate, normalizeName } from './dedupe';

/** One chunk's extraction result. */
export type MedicalHistoryExtraction = ParsedMedicalHistory;

/** How many fields of an entry carry a value (not null/undefined). */
function nonNullFieldCount(entry: Record<string, unknown>): number {
  let count = 0;
  for (const value of Object.values(entry)) {
    if (value !== null && value !== undefined) count += 1;
  }
  return count;
}

/**
 * Collapse repeats by key, keeping the entry with more non-null fields.
 * Ties keep the first-seen entry; first-seen order is preserved (replacing a
 * Map value does not move its position).
 */
function collapseByKey<T extends Record<string, unknown>>(
  items: T[],
  keyOf: (item: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = byKey.get(key);
    if (!existing || nonNullFieldCount(item) > nonNullFieldCount(existing)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

/** Name + date key; undated entries get their own key space (`@@` suffix). */
function nameDateKey(name: string, date: string | null): string {
  return `${normalizeName(name)}@@${normalizeDate(date) ?? ''}`;
}

function mergeLabVisits(visits: ExtractedLabVisit[]): ExtractedLabVisit[] {
  const byDate = new Map<
    string,
    { visit_date: string; results: Map<string, ExtractedLabResult> }
  >();

  for (const visit of visits) {
    const dateKey = normalizeDate(visit.visit_date) ?? '';
    let merged = byDate.get(dateKey);
    if (!merged) {
      merged = { visit_date: visit.visit_date, results: new Map() };
      byDate.set(dateKey, merged);
    }
    for (const result of visit.results) {
      const testKey = normalizeName(result.test_name);
      // First occurrence wins.
      if (!merged.results.has(testKey)) merged.results.set(testKey, result);
    }
  }

  return [...byDate.values()].map((visit) => ({
    visit_date: visit.visit_date,
    results: [...visit.results.values()],
  }));
}

/**
 * Merge per-chunk extractions into a single extraction, collapsing
 * cross-chunk repeats. `mergeExtractions([])` returns an all-empty result;
 * a single part is still passed through the collapse (so in-document repeats
 * within one chunk collapse identically).
 */
export function mergeExtractions(
  parts: MedicalHistoryExtraction[],
): MedicalHistoryExtraction {
  const nameKey = (item: { name: string }) => normalizeName(item.name);

  return {
    medications: collapseByKey(
      parts.flatMap((p) => p.medications),
      nameKey,
    ),
    conditions: collapseByKey(
      parts.flatMap((p) => p.conditions),
      nameKey,
    ),
    allergies: collapseByKey(
      parts.flatMap((p) => p.allergies),
      nameKey,
    ),
    procedures: collapseByKey(
      parts.flatMap((p) => p.procedures),
      (p) => nameDateKey(p.name, p.procedure_date),
    ),
    vaccines: collapseByKey(
      parts.flatMap((p) => p.vaccines),
      (v) => nameDateKey(v.name, v.vaccine_date),
    ),
    lab_visits: mergeLabVisits(parts.flatMap((p) => p.lab_visits)),
  };
}
