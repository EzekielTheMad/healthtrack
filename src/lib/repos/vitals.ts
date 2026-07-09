/**
 * vitals repository (vitals + vital_reference_ranges + vital_source_preferences).
 *
 * Authorization (003/012/014, encoded in src/lib/authz):
 *   vitals — standard matrix: owner full; shares READ-ONLY with section
 *     'vitals' + exact dependent match; delegates read (read_only+),
 *     insert/update (read_write+), delete (admin).
 *   vital_reference_ranges — world-readable seed data ("using (true)" in 003);
 *     no writes from the app.
 *   vital_source_preferences — strictly owner-only (`auth.uid() = user_id`
 *     policies in 003; no share/delegate grants, no dependent column).
 */
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, type DB } from '@/db';
import { vitals, vitalReferenceRanges, vitalSourcePreferences } from '@/db/schema';
import { requireAuthz } from '@/lib/authz';
import { getMetric } from '@/lib/metrics/registry';
import { weightToLbs } from '@/lib/units';
import { camelToSnakeKey } from '@/lib/api/snake';
import { dependentFilter, requireListAuthz, type ListScope } from './_scope';

export type VitalRow = typeof vitals.$inferSelect;
export type VitalReferenceRangeRow = typeof vitalReferenceRanges.$inferSelect;
export type VitalSourcePreferenceRow = typeof vitalSourcePreferences.$inferSelect;

export interface ListVitalsOptions {
  /** Inclusive recorded_at lower bound (ISO string). */
  startDate?: string;
  /** Inclusive recorded_at upper bound (ISO string). */
  endDate?: string;
  /** Exact metric filter (v1 API `?metric=`). */
  metricKey?: string;
  /** Row cap (v1 API `?limit=`). */
  limit?: number;
}

export async function listVitals(
  actorId: string,
  scope: ListScope,
  opts: ListVitalsOptions = {},
): Promise<VitalRow[]> {
  await requireListAuthz(actorId, scope, 'vitals', 'read');
  const query = db
    .select()
    .from(vitals)
    .where(
      and(
        eq(vitals.userId, scope.ownerId),
        dependentFilter(vitals.dependentId, scope.dependentId),
        opts.metricKey ? eq(vitals.metricKey, opts.metricKey) : undefined,
        opts.startDate ? gte(vitals.recordedAt, opts.startDate) : undefined,
        opts.endDate ? lte(vitals.recordedAt, opts.endDate) : undefined,
      ),
    )
    .orderBy(desc(vitals.recordedAt));
  return opts.limit !== undefined ? query.limit(opts.limit) : query;
}

/**
 * Session write path (manual entry, delegates). Keeps the standard authz
 * matrix (owner/delegate write into the given scope) but validates and
 * normalizes the record through the same registry rules as the v1 ingest
 * API — closed metric registry, ordinal label resolution + metadata.label
 * stamping, canonical units (weight accepts kg), day-normalized recorded_at
 * for non-intraday metrics. Scope keys in the input are stripped — row scope
 * is never client-controlled. Throws VitalWriteError (→ 400) on bad input.
 *
 * Writes are idempotent on (user_id, metric_key, recorded_at, source,
 * dependent_id): re-entering the same metric/day/source updates the existing
 * row instead of duplicating it, matching the v1 ingest semantics.
 */
export async function createVital(
  actorId: string,
  scope: { ownerId: string; dependentId: string | null },
  input: unknown,
): Promise<VitalRow> {
  await requireAuthz(actorId, scope, 'vitals', 'write');
  const values = validateVitalWrite(input);
  upsertOwnVital(db, scope.ownerId, values, scope.dependentId);
  const row = findOwnVital(db, scope.ownerId, values, scope.dependentId);
  if (!row) throw new Error('vitals upsert did not persist'); // unreachable
  return row;
}

// ---------------------------------------------------------------------------
// Registry-validated write path (v1 ingest API + Oura sync).
//
// Trusted-scope variant: callers pass the OWNER's id directly (PAT routes
// resolve the token to exactly one user; the Oura sync runs as the session
// user), so there is no delegate/share authz here — rows are always written
// with user_id = userId and dependent_id NULL.
// ---------------------------------------------------------------------------

/** 400-shaped validation failure for the vitals write path. Messages use the
    API wire field names (snake_case) so they can be returned verbatim. */
export class VitalWriteError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'VitalWriteError';
  }
}

export interface UpsertVitalInput {
  metricKey: string;
  /** Required for number metrics; ordinals accept value OR valueLabel. */
  value?: number;
  /** Ordinal metrics only — resolved to the 1-based value via the registry. */
  valueLabel?: string;
  /** Optional; must equal the registry canonical unit when provided
      (exception: weight accepts 'kg' and converts to lbs). */
  unit?: string | null;
  source: string;
  recordedAt: string;
  metadata?: Record<string, unknown>;
}

/** Fully-resolved write: value numeric, unit canonical, recordedAt normalized,
    metadata.label stamped for ordinals. */
export interface ValidatedVitalWrite {
  metricKey: string;
  value: number;
  unit: string | null;
  source: string;
  recordedAt: string;
  metadata: Record<string, unknown>;
}

/** Abuse bounds on client-controlled sizes: metric_key is capped so the
    unknown-key error can never echo a megabyte string; source is a short
    device/app identifier; metadata is bounded by its JSON serialization. */
const MAX_KEY_CHARS = 64;
const MAX_SOURCE_CHARS = 64;
const MAX_METADATA_JSON_CHARS = 4096;

// Unknown keys (user_id, dependent_id, id…) are stripped — row scope is never
// client-controlled.
const vitalWriteSchema = z
  .object({
    metricKey: z
      .string()
      .trim()
      .min(1)
      .max(MAX_KEY_CHARS, `must be at most ${MAX_KEY_CHARS} characters`),
    value: z.number().optional(),
    valueLabel: z.string().trim().min(1).optional(),
    unit: z.string().trim().nullish(),
    source: z
      .string()
      .trim()
      .min(1)
      .max(MAX_SOURCE_CHARS, `must be at most ${MAX_SOURCE_CHARS} characters`),
    recordedAt: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strip();

/**
 * Validate + normalize a vitals write against the metric registry:
 *  - metricKey must exist in the registry (closed registry);
 *  - ordinal metrics: valueLabel resolves to its 1-based value (or an integer
 *    value within the label range is accepted); metadata.label is stamped;
 *  - number metrics: value required; registry min/max enforced (pain_level);
 *  - unit, when provided, must equal the registry canonical unit — except
 *    weight, which accepts 'kg' and converts via weightToLbs. The stored unit
 *    is always the canonical one;
 *  - recordedAt normalizes to `${day}T00:00:00Z` unless the metric is
 *    intraday-flagged, in which case the full timestamp is kept (ISO UTC);
 *    the year must fall within 1900–2100;
 *  - abuse bounds: metric_key/source max 64 chars, metadata max 4096 chars
 *    of JSON.
 * Throws VitalWriteError (status 400) with an API-ready message.
 */
export function validateVitalWrite(input: unknown): ValidatedVitalWrite {
  const parsed = vitalWriteSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.map((p) => camelToSnakeKey(String(p))).join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new VitalWriteError(`Invalid vital record — ${detail}`);
  }
  const { metricKey, valueLabel, unit, source, recordedAt, metadata } = parsed.data;
  let value = parsed.data.value;

  if (
    metadata !== undefined &&
    JSON.stringify(metadata).length > MAX_METADATA_JSON_CHARS
  ) {
    throw new VitalWriteError(
      `metadata is too large — its JSON serialization must be at most ${MAX_METADATA_JSON_CHARS} characters.`,
    );
  }

  const metric = getMetric(metricKey);
  if (!metric) {
    throw new VitalWriteError(
      `Unknown metric key '${metricKey}'. The metric registry is closed — see /docs/api for the list of supported metrics.`,
    );
  }

  const outMetadata: Record<string, unknown> = { ...(metadata ?? {}) };

  if (metric.valueType === 'ordinal') {
    const labels = metric.ordinalLabels ?? [];
    if (valueLabel !== undefined) {
      const idx = labels.findIndex((l) => l.toLowerCase() === valueLabel.toLowerCase());
      if (idx === -1) {
        throw new VitalWriteError(
          `Unknown value_label '${valueLabel}' for '${metricKey}'. Valid labels: ${labels.join(', ')}.`,
        );
      }
      if (value !== undefined && value !== idx + 1) {
        throw new VitalWriteError(
          `value ${value} does not match value_label '${valueLabel}' (= ${idx + 1}) for '${metricKey}' — send one or the other.`,
        );
      }
      value = idx + 1;
    } else if (value !== undefined) {
      if (!Number.isInteger(value)) {
        throw new VitalWriteError(`'${metricKey}' is an ordinal metric — value must be an integer.`);
      }
      if (value < 1 || value > labels.length) {
        throw new VitalWriteError(
          `value ${value} out of range for '${metricKey}' — must be between 1 and ${labels.length} (${labels.join(', ')}).`,
        );
      }
    } else {
      throw new VitalWriteError(`'${metricKey}' requires a value or value_label.`);
    }
    outMetadata.label = labels[value - 1];
  } else {
    if (valueLabel !== undefined) {
      throw new VitalWriteError(
        `value_label is only valid for ordinal metrics — '${metricKey}' takes a numeric value.`,
      );
    }
    if (value === undefined) {
      throw new VitalWriteError(`'${metricKey}' requires a numeric value.`);
    }
    if (!Number.isFinite(value)) {
      throw new VitalWriteError(`'${metricKey}' value must be a finite number.`);
    }
    if (
      (metric.min !== undefined && value < metric.min) ||
      (metric.max !== undefined && value > metric.max)
    ) {
      throw new VitalWriteError(
        `'${metricKey}' must be between ${metric.min} and ${metric.max}.`,
      );
    }
  }

  // Unit: reject anything that isn't the canonical stored unit (no silent
  // conversion in v1) — except weight, which accepts kg for parity with
  // manual entry. Stored unit is always canonical.
  if (unit != null && unit !== '' && unit !== metric.unit) {
    if (metric.key === 'weight' && unit === 'kg') {
      value = weightToLbs(value, 'metric');
    } else if (metric.unit === null) {
      throw new VitalWriteError(`'${metricKey}' does not take a unit (got '${unit}').`);
    } else {
      throw new VitalWriteError(
        `Unit '${unit}' does not match the canonical unit '${metric.unit}' for '${metricKey}'. Convert before sending.`,
      );
    }
  }

  const ts = new Date(recordedAt);
  if (Number.isNaN(ts.getTime())) {
    throw new VitalWriteError(
      `recorded_at '${recordedAt}' is not a valid ISO date or datetime.`,
    );
  }
  const year = ts.getUTCFullYear();
  if (year < 1900 || year > 2100) {
    throw new VitalWriteError(
      `recorded_at year ${year} is out of range — must be between 1900 and 2100.`,
    );
  }
  const normalizedAt = metric.intraday
    ? ts.toISOString()
    : `${ts.toISOString().slice(0, 10)}T00:00:00Z`;

  return {
    metricKey,
    value,
    unit: metric.unit,
    source,
    recordedAt: normalizedAt,
    metadata: outMetadata,
  };
}

/** A drizzle handle usable for the synchronous write path: the shared `db`
    singleton or a better-sqlite3 transaction handle from `db.transaction`. */
export type VitalsWriteDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

/** WHERE fragment for the idempotency tuple (user_id, metric_key,
    recorded_at, source, dependent_id) — dependent NULL matches IS NULL. */
function upsertTupleFilter(
  userId: string,
  key: { metricKey: string; recordedAt: string; source: string },
  dependentId: string | null,
) {
  return and(
    eq(vitals.userId, userId),
    eq(vitals.metricKey, key.metricKey),
    eq(vitals.recordedAt, key.recordedAt),
    eq(vitals.source, key.source),
    dependentId === null ? isNull(vitals.dependentId) : eq(vitals.dependentId, dependentId),
  );
}

/**
 * Idempotent write keyed on (user_id, metric_key, recorded_at, source,
 * dependent_id) — update-else-insert, promoted from the Oura sync.
 * Validates/normalizes via validateVitalWrite (throws VitalWriteError).
 * Synchronous so batches can run inside one better-sqlite3 transaction.
 * `dependentId` defaults to null (owner rows) — the trusted-scope v1/Oura
 * callers never pass it; the session path passes its authorized scope.
 */
export function upsertOwnVital(
  dbh: VitalsWriteDb,
  userId: string,
  input: UpsertVitalInput | unknown,
  dependentId: string | null = null,
): 'inserted' | 'updated' {
  const v = validateVitalWrite(input);
  const updated = dbh
    .update(vitals)
    .set({ value: v.value, unit: v.unit, metadata: v.metadata })
    .where(upsertTupleFilter(userId, v, dependentId))
    .run();
  if (updated.changes > 0) return 'updated';
  dbh.insert(vitals).values({ ...v, userId, dependentId }).run();
  return 'inserted';
}

/** Fetch the row for a normalized upsert tuple (dependent_id NULL unless
    given) — used by the v1 POST and session create to echo the written
    record. */
export function findOwnVital(
  dbh: VitalsWriteDb,
  userId: string,
  key: { metricKey: string; recordedAt: string; source: string },
  dependentId: string | null = null,
): VitalRow | undefined {
  return dbh
    .select()
    .from(vitals)
    .where(upsertTupleFilter(userId, key, dependentId))
    .get();
}

/** World-readable reference ranges (seeded from 002) — no authz by design. */
export async function listVitalReferenceRanges(): Promise<VitalReferenceRangeRow[]> {
  return db
    .select()
    .from(vitalReferenceRanges)
    .orderBy(asc(vitalReferenceRanges.metricKey), asc(vitalReferenceRanges.rangeLow));
}

/** Owner-only: the actor's own source preferences. */
export async function listVitalSourcePreferences(
  actorId: string,
): Promise<VitalSourcePreferenceRow[]> {
  return db
    .select()
    .from(vitalSourcePreferences)
    .where(eq(vitalSourcePreferences.userId, actorId))
    .orderBy(asc(vitalSourcePreferences.metricKey));
}

/** Owner-only upsert keyed by the (user_id, metric_key) unique constraint. */
export async function setVitalSourcePreference(
  actorId: string,
  metricKey: string,
  preferredSource: string,
): Promise<VitalSourcePreferenceRow> {
  const values = z
    .object({
      metricKey: z.string().trim().min(1),
      preferredSource: z.string().trim().min(1),
    })
    .parse({ metricKey, preferredSource });
  const [row] = await db
    .insert(vitalSourcePreferences)
    .values({ ...values, userId: actorId })
    .onConflictDoUpdate({
      target: [vitalSourcePreferences.userId, vitalSourcePreferences.metricKey],
      set: { preferredSource: values.preferredSource },
    })
    .returning();
  return row;
}
