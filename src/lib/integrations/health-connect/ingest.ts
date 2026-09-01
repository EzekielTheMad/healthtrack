/**
 * Health Connect ingestion — envelope → raw records → canonical normalization.
 *
 * Everything below the HTTP layer lives here. The route handles auth,
 * signature, size and rate limiting; this module owns the ONE better-sqlite3
 * transaction in which raw persistence and normalization either both commit
 * or both roll back (PRD §10 transaction tests).
 *
 * Ordering guarantees:
 *  - raw records are written BEFORE normalization, so a day is always
 *    recomputed from the complete retained set, including the records that
 *    just arrived;
 *  - the ingest-run row is written INSIDE the transaction, so a rolled-back
 *    ingestion leaves no run behind and the payload is not mistaken for an
 *    already-processed retry on the next attempt.
 */
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { healthConnectIntegrations } from '@/db/schema';
import type {
  HcWriteDb,
  HealthConnectIntegrationRow,
} from '@/lib/repos/health-connect';
import {
  findRunByBodyDigest,
  insertIngestRun,
  upsertRawRecord,
  type RawRecordInput,
} from '@/lib/repos/health-connect';
import { normalizeDailyTotals } from './normalize-activity';
import { normalizeNutritionDays, phoenixDate } from './normalize-nutrition';
import {
  AGGREGATE_SOURCE_PACKAGE,
  MAX_ARRAYS_PER_PAYLOAD,
  MAX_RECORDS_PER_ARRAY,
  MAX_RECORDS_PER_PAYLOAD,
  MAX_RECORD_JSON_CHARS,
  MAX_SOURCE_PACKAGE_CHARS,
  MAX_UUID_CHARS,
  RAW_ENVELOPE_MAX_CHARS,
  UNKNOWN_SOURCE_PACKAGE,
  envelopeSchema,
  getRecordType,
  isSupportedTimestamp,
  rawRecordFieldsSchema,
} from './schema';

// ---------------------------------------------------------------------------
// Result shapes (mirrored by the route's JSON response)
// ---------------------------------------------------------------------------

export interface IngestCounts {
  received: number;
  inserted: number;
  updated: number;
  duplicates: number;
  rejected: number;
}

export interface NormalizationSummary {
  vitals_upserted: number;
  nutrition_days_upserted: number;
  skipped_unapproved: number;
  errors: string[];
}

export interface IngestResult {
  ingestId: string;
  status: 'accepted' | 'duplicate' | 'test_ping';
  counts: IngestCounts;
  normalization: NormalizationSummary;
}

/** Thrown for a structurally invalid envelope — the route maps it to 400. */
export class EnvelopeError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** A record pulled out of the envelope, ready for the raw table. */
export interface ExtractedRecord extends RawRecordInput {
  /** Phoenix date this record contributes to, when it has a start instant. */
  phoenixDate: string | null;
}

export interface ExtractionResult {
  records: ExtractedRecord[];
  /** Entries dropped for being unusable (no timestamp, oversized, malformed). */
  rejected: number;
  /** `daily_totals` entries, kept as delivered for the activity normalizer. */
  dailyTotals: unknown[];
}

/**
 * Walk every array the pinned upstream schema can emit and turn its entries
 * into raw-record rows. Unknown top-level keys are ignored here on purpose:
 * they survive in the retained envelope but must never become health data.
 */
export function extractRecords(envelope: Record<string, unknown>): ExtractionResult {
  const records: ExtractedRecord[] = [];
  const dailyTotals: unknown[] = [];
  let rejected = 0;
  let arrays = 0;

  for (const [key, value] of Object.entries(envelope)) {
    if (!Array.isArray(value)) continue;
    const def = getRecordType(key);
    if (!def) continue; // unknown array — retained in the envelope only
    if (++arrays > MAX_ARRAYS_PER_PAYLOAD) {
      throw new EnvelopeError(
        `Payload has more than ${MAX_ARRAYS_PER_PAYLOAD} record arrays.`,
      );
    }
    if (value.length > MAX_RECORDS_PER_ARRAY) {
      throw new EnvelopeError(
        `Array '${key}' has ${value.length} records — the limit is ${MAX_RECORDS_PER_ARRAY}.`,
      );
    }

    for (const entry of value) {
      if (records.length + 1 > MAX_RECORDS_PER_PAYLOAD) {
        throw new EnvelopeError(
          `Payload has more than ${MAX_RECORDS_PER_PAYLOAD} records in total.`,
        );
      }
      const extracted = extractOne(key, entry);
      if (extracted) records.push(extracted);
      else rejected += 1;
    }

    if (key === 'daily_totals') dailyTotals.push(...value);
  }

  return { records, rejected, dailyTotals };
}

function extractOne(recordType: string, entry: unknown): ExtractedRecord | null {
  const def = getRecordType(recordType);
  if (!def) return null;
  const parsed = rawRecordFieldsSchema.safeParse(entry);
  if (!parsed.success) return null;
  const payload = parsed.data as Record<string, unknown>;

  if (JSON.stringify(payload).length > MAX_RECORD_JSON_CHARS) return null;

  const startRaw = payload[def.startField];
  const endRaw = def.endField ? payload[def.endField] : undefined;

  // `daily_totals` and `screen_time` key on a plain date; everything else on
  // an instant. Either way the value must be present and in range.
  let recordedStartAt: string | null;
  if (def.startField === 'date') {
    if (typeof startRaw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) return null;
    recordedStartAt = `${startRaw}T00:00:00.000Z`;
    if (!isSupportedTimestamp(recordedStartAt)) return null;
  } else {
    if (!isSupportedTimestamp(startRaw)) return null;
    recordedStartAt = new Date(startRaw as string).toISOString();
  }

  const recordedEndAt = isSupportedTimestamp(endRaw)
    ? new Date(endRaw as string).toISOString()
    : null;

  // Source package and identity, both preserved verbatim when present.
  const rawSource = typeof payload.source === 'string' ? payload.source.trim() : '';
  const sourcePackage =
    recordType === 'daily_totals'
      ? AGGREGATE_SOURCE_PACKAGE
      : rawSource.slice(0, MAX_SOURCE_PACKAGE_CHARS) || UNKNOWN_SOURCE_PACKAGE;

  const rawUuid = typeof payload.uuid === 'string' ? payload.uuid.trim() : '';
  const hasUuid = rawUuid.length > 0;
  const sourceUuid = hasUuid
    ? rawUuid.slice(0, MAX_UUID_CHARS)
    : derivedIdentity(recordType, sourcePackage, recordedStartAt, payload);

  return {
    recordType,
    sourcePackage,
    sourceUuid,
    identityKind: hasUuid ? 'uuid' : 'derived',
    recordedStartAt,
    recordedEndAt,
    sourceLastModifiedAt: null,
    payload,
    phoenixDate: phoenixDate(recordedStartAt),
  };
}

/**
 * Identity for a record the relay delivered without a Health Connect uuid.
 * Content-derived and explicitly labelled 'derived': it deduplicates repeat
 * deliveries of an UNCHANGED record, but it cannot recognise an edited one,
 * so it must never be presented as strong deduplication (PRD §6.4).
 *
 * `daily_totals` is the deliberate exception that is actually stable: those
 * entries have no uuid but their date IS a natural key for the aggregate.
 */
function derivedIdentity(
  recordType: string,
  sourcePackage: string,
  startAt: string,
  payload: Record<string, unknown>,
): string {
  if (recordType === 'daily_totals') return `date:${String(payload.date)}`;
  const material = JSON.stringify([recordType, sourcePackage, startAt, payload]);
  return `derived:${crypto.createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// The transaction
// ---------------------------------------------------------------------------

export interface IngestInput {
  userId: string;
  integration: HealthConnectIntegrationRow;
  /** Parsed body — the raw bytes were already hashed and signature-checked. */
  body: Record<string, unknown>;
  bodySha256: string;
}

/**
 * Persist a validated envelope and normalize what the integration approves.
 * Throws EnvelopeError (400) for a structurally invalid envelope; any other
 * throw rolls the whole transaction back and the route answers 500.
 */
export function ingestEnvelope(input: IngestInput): IngestResult {
  const { userId, integration, body, bodySha256 } = input;

  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new EnvelopeError(`Invalid Health Connect envelope — ${detail}`);
  }
  const envelope = parsed.data as Record<string, unknown>;

  const extraction = extractRecords(envelope);
  const ingestId = crypto.randomUUID();
  const appVersion = typeof envelope.app_version === 'string' ? envelope.app_version : null;

  return db.transaction((tx) => {
    // Payload-level retry: the same exact bytes already committed once. Return
    // that run's stored outcome rather than re-reporting fresh counts, so a
    // retried delivery yields ONE ingest result (PRD §10 idempotency).
    const priorRun = findRunByBodyDigest(tx, integration.id, bodySha256);
    if (priorRun) {
      touchIntegration(tx, integration.id, { lastReceivedAt: new Date().toISOString() });
      return {
        ingestId: priorRun.id,
        status: 'duplicate' as const,
        counts: {
          received: priorRun.receivedCount,
          inserted: 0,
          updated: 0,
          duplicates: priorRun.receivedCount,
          rejected: 0,
        },
        normalization: {
          vitals_upserted: 0,
          nutrition_days_upserted: 0,
          skipped_unapproved: 0,
          errors: [],
        },
      };
    }

    // ---- Raw persistence ---------------------------------------------------
    const counts: IngestCounts = {
      received: extraction.records.length,
      inserted: 0,
      updated: 0,
      duplicates: 0,
      rejected: extraction.rejected,
    };

    /** Phoenix dates whose nutrition totals must be recomputed. */
    const nutritionDates = new Set<string>();

    for (const record of extraction.records) {
      const result = upsertRawRecord(tx, userId, integration.id, ingestId, record);
      if (result.outcome === 'inserted') counts.inserted += 1;
      else if (result.outcome === 'updated') counts.updated += 1;
      else counts.duplicates += 1;

      if (record.recordType === 'nutrition') {
        if (record.phoenixDate) nutritionDates.add(record.phoenixDate);
        // A record that MOVED across midnight invalidates the day it left.
        if (result.previousStartAt) {
          const previous = phoenixDate(result.previousStartAt);
          if (previous) nutritionDates.add(previous);
        }
      }
    }

    // ---- Normalization -----------------------------------------------------
    const normalization: NormalizationSummary = {
      vitals_upserted: 0,
      nutrition_days_upserted: 0,
      skipped_unapproved: 0,
      errors: [],
    };

    // Inventory / paused integrations store raw records and stop here — the
    // inventory stage is never skipped (PRD §12).
    const normalizing = integration.status === 'active';
    const enabled = new Set(integration.enabledTypes);

    if (normalizing && enabled.has('daily_totals') && extraction.dailyTotals.length > 0) {
      const activity = normalizeDailyTotals(tx, userId, extraction.dailyTotals, {
        integrationId: integration.id,
        ingestId,
        appVersion,
      });
      normalization.vitals_upserted += activity.vitalsUpserted;
      normalization.errors.push(...activity.errors);
    }

    if (normalizing && enabled.has('nutrition') && nutritionDates.size > 0) {
      const approved = integration.allowedSources.nutrition ?? [];
      if (approved.length > 0) {
        const nutrition = normalizeNutritionDays(tx, userId, nutritionDates, {
          integrationId: integration.id,
          ingestId,
          appVersion,
          allowedPackages: approved,
          strategy: integration.nutritionStrategy,
        });
        normalization.nutrition_days_upserted += nutrition.daysUpserted;
        normalization.errors.push(...nutrition.errors);
      }
    }

    // Everything retained but not written canonically: unsupported types,
    // unapproved packages, and every record while in inventory mode.
    normalization.skipped_unapproved = countSkipped(
      extraction.records,
      normalizing ? enabled : new Set<string>(),
      integration.allowedSources.nutrition ?? [],
    );

    // ---- Run row + integration state --------------------------------------
    insertIngestRun(tx, userId, {
      id: ingestId,
      integrationId: integration.id,
      payloadTimestamp: typeof envelope.timestamp === 'string' ? envelope.timestamp : null,
      appVersion,
      bodySha256,
      isBackfill: envelope.backfill === true,
      windowStart: typeof envelope.window_start === 'string' ? envelope.window_start : null,
      windowEnd: typeof envelope.window_end === 'string' ? envelope.window_end : null,
      status: 'accepted',
      receivedCount: counts.received,
      insertedCount: counts.inserted,
      updatedCount: counts.updated,
      duplicateCount: counts.duplicates,
      rejectedCount: counts.rejected,
      normalizationSummary: normalization as unknown as Record<string, unknown>,
      rawEnvelope: envelopeShell(envelope),
    });

    const now = new Date().toISOString();
    const normalized =
      normalization.vitals_upserted > 0 || normalization.nutrition_days_upserted > 0;
    touchIntegration(tx, integration.id, {
      lastReceivedAt: now,
      lastAppVersion: appVersion,
      ...(normalized ? { lastNormalizedAt: now } : {}),
      lastError: normalization.errors.length > 0 ? normalization.errors[0].slice(0, 500) : null,
    });

    return { ingestId, status: 'accepted' as const, counts, normalization };
  });
}

/** Record a test ping: no health data, but the delivery must be visible. */
export function recordTestPing(
  userId: string,
  integration: HealthConnectIntegrationRow,
  body: Record<string, unknown>,
  bodySha256: string,
): IngestResult {
  const ingestId = crypto.randomUUID();
  return db.transaction((tx) => {
    const prior = findRunByBodyDigest(tx, integration.id, bodySha256);
    if (!prior) {
      insertIngestRun(tx, userId, {
        id: ingestId,
        integrationId: integration.id,
        payloadTimestamp: typeof body.timestamp === 'string' ? body.timestamp : null,
        appVersion: null,
        bodySha256,
        isBackfill: false,
        windowStart: null,
        windowEnd: null,
        status: 'test_ping',
        receivedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        duplicateCount: 0,
        rejectedCount: 0,
        normalizationSummary: {},
        rawEnvelope: envelopeShell(body),
      });
    }
    touchIntegration(tx, integration.id, { lastReceivedAt: new Date().toISOString() });
    return {
      ingestId: prior?.id ?? ingestId,
      status: 'test_ping' as const,
      counts: { received: 0, inserted: 0, updated: 0, duplicates: 0, rejected: 0 },
      normalization: {
        vitals_upserted: 0,
        nutrition_days_upserted: 0,
        skipped_unapproved: 0,
        errors: [],
      },
    };
  });
}

/**
 * The envelope minus its record arrays. The records themselves are already
 * retained row by row; keeping a second full copy per delivery would multiply
 * raw storage for no gain. Unknown top-level fields ARE kept (PRD §6.3) —
 * they are exactly what this shell exists to preserve.
 */
function envelopeShell(envelope: Record<string, unknown>): Record<string, unknown> {
  const shell: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envelope)) {
    if (Array.isArray(value)) {
      shell[key] = { omitted_array_length: value.length };
      continue;
    }
    shell[key] = value;
  }
  const json = JSON.stringify(shell);
  if (json.length > RAW_ENVELOPE_MAX_CHARS) {
    return { truncated: true, byte_length: json.length };
  }
  return shell;
}

/** Records retained raw but not written canonically. */
function countSkipped(
  records: ExtractedRecord[],
  enabledTypes: Set<string>,
  approvedNutritionPackages: string[],
): number {
  let skipped = 0;
  for (const record of records) {
    if (!enabledTypes.has(record.recordType)) {
      skipped += 1;
      continue;
    }
    if (
      record.recordType === 'nutrition' &&
      !approvedNutritionPackages.includes(record.sourcePackage)
    ) {
      skipped += 1;
    }
  }
  return skipped;
}

/** Bookkeeping columns the ingestion path is allowed to patch. */
interface IntegrationTouch {
  lastReceivedAt?: string;
  lastNormalizedAt?: string;
  lastAppVersion?: string | null;
  lastError?: string | null;
}

function touchIntegration(
  tx: HcWriteDb,
  integrationId: string,
  values: IntegrationTouch,
): void {
  tx.update(healthConnectIntegrations)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(healthConnectIntegrations.id, integrationId))
    .run();
}
