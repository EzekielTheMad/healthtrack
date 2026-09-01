/**
 * Structural validation of ONE relay record, driven by the pinned schema.
 *
 * Scope, deliberately narrow (PRD §6.3):
 *   - a KNOWN record type is checked against the required fields and primitive
 *     types the vendored schema declares for it;
 *   - UNKNOWN fields always pass and are retained verbatim — a relay that adds
 *     a field must not start failing deliveries;
 *   - an UNKNOWN record type is not validated at all, because we have no
 *     contract for it. It is still retained (the raw layer is lossless) and
 *     still never normalized.
 *
 * Validation is per record, and a failure is COUNTED rather than thrown: one
 * malformed heart-rate sample must never discard the nutrition records that
 * arrived in the same delivery.
 */
import { RELAY_CONTRACT } from './generated/relay-schema';
import type { RelayField, RelayFieldKind } from './derive-relay-schema';
import { isSupportedTimestamp } from './schema';

const FIELDS_BY_TYPE = new Map<string, RelayField[]>(
  RELAY_CONTRACT.recordArrays.map((a) => [a.type, a.fields]),
);

export interface RecordValidation {
  valid: boolean;
  /** Human-readable reasons, safe to surface in an ingest run summary. */
  issues: string[];
}

const VALID: RecordValidation = { valid: true, issues: [] };

/** Whether the pinned schema describes this envelope array at all. */
export function isKnownRecordType(recordType: string): boolean {
  return FIELDS_BY_TYPE.has(recordType);
}

function matchesKind(value: unknown, kind: RelayFieldKind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * Check a record body against the pinned contract for its type.
 *
 * `null` on a declared field is treated as ABSENT, not as a type error: the
 * relay uses null for "Health Connect had no value", and the nutrition path
 * depends on absent staying distinguishable from zero.
 */
export function validateRelayRecord(
  recordType: string,
  entry: unknown,
): RecordValidation {
  const fields = FIELDS_BY_TYPE.get(recordType);
  // No contract for this array — retained raw, never normalized, never
  // rejected for a shape we never promised to understand.
  if (!fields) return VALID;

  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return { valid: false, issues: [`${recordType}: record must be a JSON object`] };
  }
  const record = entry as Record<string, unknown>;
  const issues: string[] = [];

  for (const field of fields) {
    const value = record[field.name];
    const absent = value === undefined || value === null;

    if (absent) {
      if (field.required) issues.push(`${recordType}: missing required '${field.name}'`);
      continue;
    }
    if (!matchesKind(value, field.kind)) {
      issues.push(`${recordType}: '${field.name}' must be ${field.kind}`);
      continue;
    }
    if (
      (field.format === 'date-time' || field.format === 'date') &&
      !isSupportedTimestamp(value)
    ) {
      issues.push(`${recordType}: '${field.name}' is not a supported timestamp`);
    }
  }

  return issues.length === 0 ? VALID : { valid: false, issues };
}
