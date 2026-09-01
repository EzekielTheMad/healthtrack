/**
 * health_connect_* repository — integration management, raw-record
 * persistence, ingest-run history and the source inventory.
 *
 * Authorization: strictly OWNER-ONLY, keyed on user_id (the posture used by
 * vital_source_preferences and api_keys). A Health Connect integration is
 * device plumbing rather than shareable medical content, so it has no authz
 * Section, no health-share grant and no delegate grant.
 *
 * The HMAC secret is stored encrypted (src/lib/crypto) and is NEVER part of
 * any view returned to a caller — it is revealed exactly once at creation and
 * once per explicit rotation, straight from the generator.
 *
 * Write paths used inside the webhook transaction are SYNCHRONOUS so an
 * ingestion commits (or rolls back) as one better-sqlite3 transaction — the
 * same constraint upsertOwnVital carries in src/lib/repos/vitals.ts.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type DB } from '@/db';
import {
  healthConnectIngestRuns,
  healthConnectIntegrations,
  healthConnectRawRecords,
  nutritionDaily,
  HEALTH_CONNECT_STATUSES,
  NUTRITION_STRATEGIES,
  type AllowedSources,
  type HealthConnectStatus,
  type IngestRunStatus,
  type NutritionStrategy,
  type RawIdentityKind,
} from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import { encrypt } from '@/lib/crypto/encrypt';
import { decrypt } from '@/lib/crypto/decrypt';
import { generateHmacSecret } from '@/lib/integrations/health-connect/signature';
import {
  NORMALIZABLE_TYPES,
  getRecordType,
} from '@/lib/integrations/health-connect/schema';
import { dayKeyInTz } from '@/lib/fitness/weeks';
import { OWNER_TZ } from '@/lib/fitness/rollup';

export type HealthConnectIntegrationRow = typeof healthConnectIntegrations.$inferSelect;
export type HealthConnectRawRecordRow = typeof healthConnectRawRecords.$inferSelect;
export type HealthConnectIngestRunRow = typeof healthConnectIngestRuns.$inferSelect;

/** Same synchronous drizzle handle contract as VitalsWriteDb. */
export type HcWriteDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

/** 409 for creating a second integration for one user. */
export class IntegrationExistsError extends Error {
  readonly status = 409;
  constructor(message = 'A Health Connect integration already exists for this account') {
    super(message);
    this.name = 'IntegrationExistsError';
  }
}

// ---------------------------------------------------------------------------
// Views — secret-free by construction
// ---------------------------------------------------------------------------

export interface HealthConnectIntegrationView {
  id: string;
  name: string;
  status: HealthConnectStatus;
  allowedSources: AllowedSources;
  enabledTypes: string[];
  nutritionStrategy: NutritionStrategy;
  lastReceivedAt: string | null;
  lastNormalizedAt: string | null;
  lastAppVersion: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toIntegrationView(
  row: HealthConnectIntegrationRow,
): HealthConnectIntegrationView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    allowedSources: row.allowedSources,
    enabledTypes: row.enabledTypes,
    nutritionStrategy: row.nutritionStrategy,
    lastReceivedAt: row.lastReceivedAt,
    lastNormalizedAt: row.lastNormalizedAt,
    lastAppVersion: row.lastAppVersion,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Integration management (session routes)
// ---------------------------------------------------------------------------

const nameSchema = z.string().trim().min(1).max(120);

const patchSchema = z.object({
  name: nameSchema.optional(),
  // 'error' is set by the ingestion path, never by the user.
  status: z.enum(['inventory', 'active', 'paused']).optional(),
  // A PARTIAL map: the user approves packages for some record types, not
  // all. (z.record with an enum key is exhaustive in zod v4, which would
  // force every normalizable type into every patch — hence string keys plus
  // an explicit membership check.)
  allowedSources: z
    .record(z.string(), z.array(z.string().trim().min(1).max(255)).max(32))
    .refine(
      (map) => Object.keys(map).every((k) => (NORMALIZABLE_TYPES as string[]).includes(k)),
      {
        message: `allowed_sources keys must be one of: ${NORMALIZABLE_TYPES.join(', ')}`,
      },
    )
    .optional(),
  enabledTypes: z
    .array(z.enum(NORMALIZABLE_TYPES as [string, ...string[]]))
    .max(NORMALIZABLE_TYPES.length)
    .optional(),
  nutritionStrategy: z.enum(NUTRITION_STRATEGIES).optional(),
});

export type HealthConnectPatch = z.input<typeof patchSchema>;

/** The actor's integration, or null. Never includes the secret. */
export async function getIntegration(
  actorId: string,
): Promise<HealthConnectIntegrationView | null> {
  if (!actorId) throw new NotFoundError();
  const rows = await db
    .select()
    .from(healthConnectIntegrations)
    .where(eq(healthConnectIntegrations.userId, actorId))
    .limit(1);
  return rows[0] ? toIntegrationView(rows[0]) : null;
}

/** One owned integration by id (404 for anyone else's). Never the secret. */
export async function getOwnedIntegration(
  actorId: string,
  id: string,
): Promise<HealthConnectIntegrationView> {
  return toIntegrationView(await requireOwnedIntegration(actorId, id));
}

/** Internal lookup used by the webhook — carries the encrypted secret. */
export function findIntegrationRow(
  dbh: HcWriteDb,
  userId: string,
): HealthConnectIntegrationRow | undefined {
  return dbh
    .select()
    .from(healthConnectIntegrations)
    .where(eq(healthConnectIntegrations.userId, userId))
    .get();
}

/** Decrypt an integration's HMAC secret for verification. */
export function integrationSecret(row: HealthConnectIntegrationRow): string {
  return decrypt(row.hmacSecretEncrypted);
}

/**
 * Create the actor's integration. Starts in `inventory` with no approved
 * sources and no enabled types — canonical writes stay off until the user
 * approves exact packages (PRD §6.5). Returns the plaintext secret ONCE.
 */
export async function createIntegration(
  actorId: string,
  input: { name?: string } = {},
): Promise<{ integration: HealthConnectIntegrationView; secret: string }> {
  if (!actorId) throw new NotFoundError();
  const existing = await db
    .select({ id: healthConnectIntegrations.id })
    .from(healthConnectIntegrations)
    .where(eq(healthConnectIntegrations.userId, actorId))
    .limit(1);
  if (existing.length > 0) throw new IntegrationExistsError();

  const secret = generateHmacSecret();
  const [row] = await db
    .insert(healthConnectIntegrations)
    .values({
      userId: actorId,
      name: nameSchema.parse(input.name ?? 'Health Connect (phone)'),
      status: 'inventory',
      hmacSecretEncrypted: encrypt(secret),
    })
    .returning();
  return { integration: toIntegrationView(row), secret };
}

/** Owner-only partial update. Status 'error' is reserved for the ingest path. */
export async function updateIntegration(
  actorId: string,
  id: string,
  patch: HealthConnectPatch,
): Promise<HealthConnectIntegrationView> {
  const row = await requireOwnedIntegration(actorId, id);
  const values = patchSchema.parse(patch);

  // Approving a type for normalization without naming an exact package would
  // be a wildcard approval — refused (PRD §6.5). daily_totals is exempt: its
  // entries come from Health Connect's aggregate API, which has no package.
  const nextEnabled = values.enabledTypes ?? row.enabledTypes;
  const nextAllowed = (values.allowedSources ?? row.allowedSources) as AllowedSources;
  for (const type of nextEnabled) {
    if (type === 'daily_totals') continue;
    if (!(nextAllowed[type]?.length > 0)) {
      throw new HealthConnectConfigError(
        `Enabling '${type}' requires at least one approved source package — wildcard approval is not supported.`,
      );
    }
  }

  const [updated] = await db
    .update(healthConnectIntegrations)
    .set({
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.status !== undefined ? { status: values.status } : {}),
      ...(values.allowedSources !== undefined ? { allowedSources: nextAllowed } : {}),
      ...(values.enabledTypes !== undefined ? { enabledTypes: values.enabledTypes } : {}),
      ...(values.nutritionStrategy !== undefined
        ? { nutritionStrategy: values.nutritionStrategy }
        : {}),
      // Any user-driven status change clears a stale error banner ('error' is
      // not a value the patch schema accepts).
      ...(values.status ? { lastError: null } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(healthConnectIntegrations.id, id))
    .returning();
  return toIntegrationView(updated);
}

/** 400-shaped configuration failure (route maps to 400). */
export class HealthConnectConfigError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'HealthConnectConfigError';
  }
}

/**
 * Rotate the HMAC secret. The previous secret is invalidated IMMEDIATELY —
 * there is no overlap window, so a phone that has not been reconfigured
 * starts failing signature verification at once (PRD §9).
 */
export async function rotateSecret(actorId: string, id: string): Promise<string> {
  await requireOwnedIntegration(actorId, id);
  const secret = generateHmacSecret();
  await db
    .update(healthConnectIntegrations)
    .set({ hmacSecretEncrypted: encrypt(secret), updatedAt: new Date().toISOString() })
    .where(eq(healthConnectIntegrations.id, id));
  return secret;
}

/**
 * Delete the integration. Canonical data (vitals, nutrition_daily) is NEVER
 * touched (PRD §6.10). `deleteRaw` decides the raw layer's fate:
 *   true  — raw records and ingest runs are deleted with the integration;
 *   false — they are retained, orphaned (integration_id → NULL by FK), so the
 *           user keeps the history they paid storage for.
 */
export async function deleteIntegration(
  actorId: string,
  id: string,
  deleteRaw: boolean,
): Promise<{ rawRecordsDeleted: number; ingestRunsDeleted: number }> {
  await requireOwnedIntegration(actorId, id);
  let rawRecordsDeleted = 0;
  let ingestRunsDeleted = 0;
  if (deleteRaw) {
    rawRecordsDeleted = (
      await db
        .delete(healthConnectRawRecords)
        .where(eq(healthConnectRawRecords.integrationId, id))
        .returning({ id: healthConnectRawRecords.id })
    ).length;
    ingestRunsDeleted = (
      await db
        .delete(healthConnectIngestRuns)
        .where(eq(healthConnectIngestRuns.integrationId, id))
        .returning({ id: healthConnectIngestRuns.id })
    ).length;
  }
  await db.delete(healthConnectIntegrations).where(eq(healthConnectIntegrations.id, id));
  return { rawRecordsDeleted, ingestRunsDeleted };
}

async function requireOwnedIntegration(
  actorId: string,
  id: string,
): Promise<HealthConnectIntegrationRow> {
  if (!actorId || !id) throw new NotFoundError();
  const rows = await db
    .select()
    .from(healthConnectIntegrations)
    .where(eq(healthConnectIntegrations.id, id))
    .limit(1);
  const row = rows[0];
  // 404 (not 403) for another user's id — RLS parity, same as every repo here.
  if (!row || row.userId !== actorId) throw new NotFoundError();
  return row;
}

// ---------------------------------------------------------------------------
// Raw records (synchronous — webhook transaction)
// ---------------------------------------------------------------------------

export interface RawRecordInput {
  recordType: string;
  sourcePackage: string;
  sourceUuid: string;
  identityKind: RawIdentityKind;
  recordedStartAt: string | null;
  recordedEndAt: string | null;
  sourceLastModifiedAt: string | null;
  payload: Record<string, unknown>;
}

export type RawUpsertOutcome = 'inserted' | 'updated' | 'duplicate';

export interface RawUpsertResult {
  outcome: RawUpsertOutcome;
  /** The row's previous recordedStartAt, when an existing record MOVED in
      time — the nutrition normalizer must recompute the old day too. */
  previousStartAt: string | null;
}

/**
 * Idempotent raw write keyed on (user_id, record_type, source_package,
 * source_uuid). A repeat uuid replaces the stored payload when it changed and
 * always refreshes last_seen_at / last_ingest_id (PRD §6.4).
 */
export function upsertRawRecord(
  dbh: HcWriteDb,
  userId: string,
  integrationId: string,
  ingestId: string,
  input: RawRecordInput,
): RawUpsertResult {
  const now = new Date().toISOString();
  const existing = dbh
    .select()
    .from(healthConnectRawRecords)
    .where(
      and(
        eq(healthConnectRawRecords.userId, userId),
        eq(healthConnectRawRecords.recordType, input.recordType),
        eq(healthConnectRawRecords.sourcePackage, input.sourcePackage),
        eq(healthConnectRawRecords.sourceUuid, input.sourceUuid),
      ),
    )
    .get();

  if (!existing) {
    dbh
      .insert(healthConnectRawRecords)
      .values({
        integrationId,
        userId,
        recordType: input.recordType,
        sourcePackage: input.sourcePackage,
        sourceUuid: input.sourceUuid,
        identityKind: input.identityKind,
        recordedStartAt: input.recordedStartAt,
        recordedEndAt: input.recordedEndAt,
        sourceLastModifiedAt: input.sourceLastModifiedAt,
        payload: input.payload,
        firstSeenAt: now,
        lastSeenAt: now,
        lastIngestId: ingestId,
      })
      .run();
    return { outcome: 'inserted', previousStartAt: null };
  }

  const changed =
    JSON.stringify(existing.payload) !== JSON.stringify(input.payload) ||
    existing.recordedStartAt !== input.recordedStartAt ||
    existing.recordedEndAt !== input.recordedEndAt;

  dbh
    .update(healthConnectRawRecords)
    .set({
      // A re-created integration re-adopts records it previously owned.
      integrationId,
      ...(changed
        ? {
            payload: input.payload,
            recordedStartAt: input.recordedStartAt,
            recordedEndAt: input.recordedEndAt,
            sourceLastModifiedAt: input.sourceLastModifiedAt ?? now,
          }
        : {}),
      lastSeenAt: now,
      lastIngestId: ingestId,
    })
    .where(eq(healthConnectRawRecords.id, existing.id))
    .run();

  return {
    outcome: changed ? 'updated' : 'duplicate',
    previousStartAt: changed ? existing.recordedStartAt : null,
  };
}

/**
 * All live raw records of one type whose start instant falls inside
 * [startAt, endAt) — the input to a daily recomputation. Synchronous for the
 * webhook transaction; `deleted_at` rows are excluded (reserved for a future
 * delete feed).
 */
export function listRawRecordsInWindow(
  dbh: HcWriteDb,
  userId: string,
  recordType: string,
  startAt: string,
  endAt: string,
  sourcePackages?: string[],
): HealthConnectRawRecordRow[] {
  return dbh
    .select()
    .from(healthConnectRawRecords)
    .where(
      and(
        eq(healthConnectRawRecords.userId, userId),
        eq(healthConnectRawRecords.recordType, recordType),
        isNull(healthConnectRawRecords.deletedAt),
        gte(healthConnectRawRecords.recordedStartAt, startAt),
        lte(healthConnectRawRecords.recordedStartAt, endAt),
        sourcePackages && sourcePackages.length > 0
          ? inArray(healthConnectRawRecords.sourcePackage, sourcePackages)
          : undefined,
      ),
    )
    .all();
}

/**
 * Every live raw record of one type written by one of `sourcePackages` —
 * the input to a FULL rebuild, which has no date bound by definition.
 * Package matching is exact equality (SQL `in`), never a pattern.
 */
export function listRawRecordsForPackages(
  dbh: HcWriteDb,
  userId: string,
  recordType: string,
  sourcePackages: string[],
): HealthConnectRawRecordRow[] {
  if (sourcePackages.length === 0) return [];
  return dbh
    .select()
    .from(healthConnectRawRecords)
    .where(
      and(
        eq(healthConnectRawRecords.userId, userId),
        eq(healthConnectRawRecords.recordType, recordType),
        isNull(healthConnectRawRecords.deletedAt),
        inArray(healthConnectRawRecords.sourcePackage, sourcePackages),
      ),
    )
    .all();
}

/**
 * Phoenix dates that already carry a canonical nutrition row for one of
 * `sourcePackages`. A full rebuild adds these to its target set so a day
 * whose raw records have gone away loses its stale row instead of keeping a
 * total nothing supports any more.
 */
export function listNutritionDatesForPackages(
  dbh: HcWriteDb,
  userId: string,
  sourcePackages: string[],
): string[] {
  if (sourcePackages.length === 0) return [];
  const rows = dbh
    .select({ date: nutritionDaily.date })
    .from(nutritionDaily)
    .where(
      and(
        eq(nutritionDaily.userId, userId),
        inArray(nutritionDaily.sourcePackage, sourcePackages),
      ),
    )
    .all();
  return rows.map((r) => r.date);
}

// ---------------------------------------------------------------------------
// Ingest runs
// ---------------------------------------------------------------------------

export interface IngestRunInput {
  id: string;
  integrationId: string;
  payloadTimestamp: string | null;
  appVersion: string | null;
  bodySha256: string;
  isBackfill: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  status: IngestRunStatus;
  receivedCount: number;
  insertedCount: number;
  updatedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  normalizationSummary: Record<string, unknown>;
  rawEnvelope: Record<string, unknown> | null;
}

export function insertIngestRun(
  dbh: HcWriteDb,
  userId: string,
  input: IngestRunInput,
): void {
  const now = new Date().toISOString();
  dbh
    .insert(healthConnectIngestRuns)
    .values({ ...input, userId, receivedAt: now, completedAt: now })
    .run();
}

/** A completed run for the same exact body — a delivery retry (PRD §6.4). */
export function findRunByBodyDigest(
  dbh: HcWriteDb,
  integrationId: string,
  bodySha256: string,
): HealthConnectIngestRunRow | undefined {
  return dbh
    .select()
    .from(healthConnectIngestRuns)
    .where(
      and(
        eq(healthConnectIngestRuns.integrationId, integrationId),
        eq(healthConnectIngestRuns.bodySha256, bodySha256),
      ),
    )
    .get();
}

/** Recent runs, newest first — the Settings activity log. */
export async function listIngestRuns(
  actorId: string,
  id: string,
  limit = 20,
): Promise<HealthConnectIngestRunRow[]> {
  await requireOwnedIntegration(actorId, id);
  return db
    .select()
    .from(healthConnectIngestRuns)
    .where(eq(healthConnectIngestRuns.userId, actorId))
    .orderBy(desc(healthConnectIngestRuns.receivedAt))
    .limit(Math.min(Math.max(1, limit), 200));
}

// ---------------------------------------------------------------------------
// Inventory (PRD §6.5)
// ---------------------------------------------------------------------------

export interface InventoryEntry {
  recordType: string;
  sourcePackage: string;
  identityKind: RawIdentityKind;
  count: number;
  oldest: string | null;
  newest: string | null;
  lastSeenAt: string;
  /** Fields observed on at least one record of this group — the operator's
      cue for what the source actually populates before approving it. */
  populatedFields: string[];
}

/**
 * Observed record types × source packages with counts and time ranges. The
 * populated-field census samples the most recent rows per group rather than
 * every row: it exists to answer "does this source even send macros?", and
 * scanning an entire multi-year raw table for that would be wasteful.
 */
export async function getInventory(
  actorId: string,
  id: string,
  sampleSize = 25,
): Promise<InventoryEntry[]> {
  await requireOwnedIntegration(actorId, id);

  const groups = await db
    .select({
      recordType: healthConnectRawRecords.recordType,
      sourcePackage: healthConnectRawRecords.sourcePackage,
      identityKind: healthConnectRawRecords.identityKind,
      count: sql<number>`count(*)`,
      oldest: sql<string | null>`min(${healthConnectRawRecords.recordedStartAt})`,
      newest: sql<string | null>`max(${healthConnectRawRecords.recordedStartAt})`,
      lastSeenAt: sql<string>`max(${healthConnectRawRecords.lastSeenAt})`,
    })
    .from(healthConnectRawRecords)
    .where(
      and(
        eq(healthConnectRawRecords.userId, actorId),
        isNull(healthConnectRawRecords.deletedAt),
      ),
    )
    .groupBy(
      healthConnectRawRecords.recordType,
      healthConnectRawRecords.sourcePackage,
      healthConnectRawRecords.identityKind,
    )
    .orderBy(healthConnectRawRecords.recordType, healthConnectRawRecords.sourcePackage);

  const out: InventoryEntry[] = [];
  for (const g of groups) {
    const samples = await db
      .select({ payload: healthConnectRawRecords.payload })
      .from(healthConnectRawRecords)
      .where(
        and(
          eq(healthConnectRawRecords.userId, actorId),
          eq(healthConnectRawRecords.recordType, g.recordType),
          eq(healthConnectRawRecords.sourcePackage, g.sourcePackage),
        ),
      )
      .orderBy(desc(healthConnectRawRecords.lastSeenAt))
      .limit(sampleSize);

    const fields = new Set<string>();
    for (const s of samples) {
      for (const [k, v] of Object.entries(s.payload ?? {})) {
        if (v !== null && v !== undefined) fields.add(k);
      }
    }
    out.push({ ...g, populatedFields: [...fields].sort() });
  }
  return out;
}

/** Status snapshot for the integration screen. */
export async function getIntegrationStatus(actorId: string) {
  const integration = await getIntegration(actorId);
  if (!integration) return null;
  const [inventory, runs] = await Promise.all([
    getInventory(actorId, integration.id),
    listIngestRuns(actorId, integration.id, 10),
  ]);
  const lastBackfill = runs.find((r) => r.isBackfill) ?? null;
  return {
    integration,
    inventory,
    runs,
    lastBackfillWindow: lastBackfill
      ? { start: lastBackfill.windowStart, end: lastBackfill.windowEnd }
      : null,
    statuses: HEALTH_CONNECT_STATUSES,
  };
}

// ---------------------------------------------------------------------------
// PAT read surface (read:health_connect) — inventory + bounded raw records
//
// Raw ingestion without a read contract is only half an integration: without
// these, the only way to see what HealthTrack retained was to open the SQLite
// file. Both paths are strictly owner-scoped, and neither can reach a secret:
// the HMAC secret, PAT hashes and body digests live in other tables and are
// never selected here.
// ---------------------------------------------------------------------------

/** Maximum raw records returned in one page — a conservative bound. */
export const RAW_RECORDS_MAX_PAGE = 200;
export const RAW_RECORDS_DEFAULT_PAGE = 50;
/** Widest time span one raw-records query may cover. */
export const RAW_RECORDS_MAX_WINDOW_DAYS = 400;

/** A bounded query is refused with 400, not silently widened. */
export class UnboundedQueryError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UnboundedQueryError';
  }
}

export interface ApiInventoryEntry extends InventoryEntry {
  integrationId: string | null;
  integrationStatus: HealthConnectStatus | null;
  /** 'normalized' when this release writes canonical rows for the type AND the
      owner approved this exact package; 'raw_only' otherwise. */
  canonicalPolicy: 'normalized' | 'raw_only';
  /** Why, in one line — source ownership, privacy, or awaiting approval. */
  canonicalPolicyReason: string;
  lastReceivedAt: string | null;
  lastNormalizedAt: string | null;
}

export interface InventoryFilters {
  integrationId?: string;
  recordType?: string;
  sourcePackage?: string;
}

/**
 * Source inventory for the PAT surface: what was retained, from which exact
 * package, over what span, and whether it becomes canonical data.
 *
 * Owner-scoped by user_id. The integration id filter is an additional
 * narrowing, never a way to read another account's integration — an id that is
 * not the caller's simply matches nothing.
 */
export async function getApiInventory(
  actorId: string,
  filters: InventoryFilters = {},
): Promise<ApiInventoryEntry[]> {
  if (!actorId) throw new NotFoundError();

  const integration = (
    await db
      .select()
      .from(healthConnectIntegrations)
      .where(eq(healthConnectIntegrations.userId, actorId))
      .limit(1)
  )[0];

  // A filter naming an integration the caller does not own matches nothing.
  if (filters.integrationId && filters.integrationId !== integration?.id) return [];

  const groups = await db
    .select({
      integrationId: healthConnectRawRecords.integrationId,
      recordType: healthConnectRawRecords.recordType,
      sourcePackage: healthConnectRawRecords.sourcePackage,
      identityKind: healthConnectRawRecords.identityKind,
      count: sql<number>`count(*)`,
      oldest: sql<string | null>`min(${healthConnectRawRecords.recordedStartAt})`,
      newest: sql<string | null>`max(${healthConnectRawRecords.recordedStartAt})`,
      lastSeenAt: sql<string>`max(${healthConnectRawRecords.lastSeenAt})`,
    })
    .from(healthConnectRawRecords)
    .where(
      and(
        eq(healthConnectRawRecords.userId, actorId),
        isNull(healthConnectRawRecords.deletedAt),
        filters.recordType
          ? eq(healthConnectRawRecords.recordType, filters.recordType)
          : undefined,
        // Exact equality — the inventory never prefix-matches a package.
        filters.sourcePackage
          ? eq(healthConnectRawRecords.sourcePackage, filters.sourcePackage)
          : undefined,
      ),
    )
    .groupBy(
      healthConnectRawRecords.recordType,
      healthConnectRawRecords.sourcePackage,
      healthConnectRawRecords.identityKind,
    )
    .orderBy(healthConnectRawRecords.recordType, healthConnectRawRecords.sourcePackage);

  const approvedNutrition = new Set(integration?.allowedSources?.nutrition ?? []);
  const enabled = new Set(integration?.enabledTypes ?? []);

  const out: ApiInventoryEntry[] = [];
  for (const g of groups) {
    out.push({
      ...g,
      integrationId: g.integrationId ?? integration?.id ?? null,
      integrationStatus: integration?.status ?? null,
      populatedFields: await observedFields(actorId, g.recordType, g.sourcePackage),
      ...canonicalPolicyFor(g.recordType, g.sourcePackage, enabled, approvedNutrition, integration?.status),
      lastReceivedAt: integration?.lastReceivedAt ?? null,
      lastNormalizedAt: integration?.lastNormalizedAt ?? null,
    });
  }
  return out;
}

/** Fields at least one recent record of this group actually populated. */
async function observedFields(
  actorId: string,
  recordType: string,
  sourcePackage: string,
  sampleSize = 25,
): Promise<string[]> {
  const samples = await db
    .select({ payload: healthConnectRawRecords.payload })
    .from(healthConnectRawRecords)
    .where(
      and(
        eq(healthConnectRawRecords.userId, actorId),
        eq(healthConnectRawRecords.recordType, recordType),
        eq(healthConnectRawRecords.sourcePackage, sourcePackage),
      ),
    )
    .orderBy(desc(healthConnectRawRecords.lastSeenAt))
    .limit(sampleSize);

  const fields = new Set<string>();
  for (const s of samples) {
    for (const [k, v] of Object.entries(s.payload ?? {})) {
      if (v !== null && v !== undefined) fields.add(k);
    }
  }
  return [...fields].sort();
}

/**
 * Whether this exact (type, package) becomes canonical data, and why not.
 * Mirrors the ingestion decision rather than restating it: the reasons come
 * from RECORD_TYPES, which is the one place the policy is declared.
 */
function canonicalPolicyFor(
  recordType: string,
  sourcePackage: string,
  enabledTypes: Set<string>,
  approvedNutrition: Set<string>,
  status: HealthConnectStatus | undefined,
): { canonicalPolicy: 'normalized' | 'raw_only'; canonicalPolicyReason: string } {
  const def = getRecordType(recordType);
  if (!def?.normalized) {
    return {
      canonicalPolicy: 'raw_only',
      canonicalPolicyReason:
        def?.note ?? 'Not normalized in this release — retained for diagnostics only.',
    };
  }
  if (!enabledTypes.has(recordType)) {
    return {
      canonicalPolicy: 'raw_only',
      canonicalPolicyReason: `Canonical writes for '${recordType}' are not enabled in Settings.`,
    };
  }
  if (recordType === 'nutrition' && !approvedNutrition.has(sourcePackage)) {
    return {
      canonicalPolicy: 'raw_only',
      canonicalPolicyReason: `Package '${sourcePackage}' is not on the exact approved list for nutrition.`,
    };
  }
  if (status !== 'active') {
    return {
      canonicalPolicy: 'raw_only',
      canonicalPolicyReason: `Integration is '${status ?? 'missing'}' — approved records are retained but not normalized until it is active.`,
    };
  }
  return {
    canonicalPolicy: 'normalized',
    canonicalPolicyReason: def.note ?? 'Written to canonical tables.',
  };
}

export interface RawRecordQuery {
  integrationId?: string;
  recordType?: string;
  sourcePackage?: string;
  /** Inclusive ISO lower bound on recorded_start_at. */
  startAt?: string;
  /** Inclusive ISO upper bound on recorded_start_at. */
  endAt?: string;
  limit?: number;
  cursor?: string;
}

export interface RawRecordView {
  id: string;
  integration_id: string | null;
  record_type: string;
  source_package: string;
  source_uuid: string;
  identity_kind: RawIdentityKind;
  recorded_start_at: string | null;
  recorded_end_at: string | null;
  /** Owner-local calendar date, when the record has a start instant. */
  phoenix_date: string | null;
  source_last_modified_at: string | null;
  observed_fields: string[];
  /** The record object exactly as delivered — unknown fields included. */
  record: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
}

export interface RawRecordPage {
  records: RawRecordView[];
  next_cursor: string | null;
}

/**
 * Bounded, filtered access to retained raw records.
 *
 * Two guards make an accidental full dump impossible:
 *   1. the caller MUST narrow by integration id or record type;
 *   2. the caller MUST supply an explicit time range, no wider than
 *      RAW_RECORDS_MAX_WINDOW_DAYS.
 * Neither has a permissive default — a missing bound is a 400, never "all of
 * it". Pages are capped at RAW_RECORDS_MAX_PAGE.
 */
export async function listRawRecordsPage(
  actorId: string,
  query: RawRecordQuery,
): Promise<RawRecordPage> {
  if (!actorId) throw new NotFoundError();

  if (!query.integrationId && !query.recordType) {
    throw new UnboundedQueryError(
      'Specify integration_id or record_type — an unfiltered dump of retained records is not supported.',
    );
  }
  if (!query.startAt || !query.endAt) {
    throw new UnboundedQueryError(
      'Specify both start_at and end_at — an unbounded time range is not supported.',
    );
  }
  const startMs = new Date(query.startAt).getTime();
  const endMs = new Date(query.endAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new UnboundedQueryError('start_at and end_at must be ISO 8601 timestamps.');
  }
  if (endMs < startMs) {
    throw new UnboundedQueryError('end_at must not be earlier than start_at.');
  }
  const spanDays = (endMs - startMs) / 86_400_000;
  if (spanDays > RAW_RECORDS_MAX_WINDOW_DAYS) {
    throw new UnboundedQueryError(
      `Time range spans ${Math.ceil(spanDays)} days — the maximum is ${RAW_RECORDS_MAX_WINDOW_DAYS}.`,
    );
  }

  const limit = Math.min(Math.max(1, query.limit ?? RAW_RECORDS_DEFAULT_PAGE), RAW_RECORDS_MAX_PAGE);
  const after = decodeCursor(query.cursor);

  // Keyset pagination on (recorded_start_at, id): both are stable and the pair
  // is unique, so a page boundary cannot skip or repeat a record the way
  // OFFSET does when rows arrive mid-listing.
  const rows = await db
    .select()
    .from(healthConnectRawRecords)
    .where(
      and(
        eq(healthConnectRawRecords.userId, actorId),
        isNull(healthConnectRawRecords.deletedAt),
        query.integrationId
          ? eq(healthConnectRawRecords.integrationId, query.integrationId)
          : undefined,
        query.recordType
          ? eq(healthConnectRawRecords.recordType, query.recordType)
          : undefined,
        // Exact equality, never a pattern.
        query.sourcePackage
          ? eq(healthConnectRawRecords.sourcePackage, query.sourcePackage)
          : undefined,
        gte(healthConnectRawRecords.recordedStartAt, new Date(startMs).toISOString()),
        lte(healthConnectRawRecords.recordedStartAt, new Date(endMs).toISOString()),
        after
          ? or(
              gt(healthConnectRawRecords.recordedStartAt, after.startAt),
              and(
                eq(healthConnectRawRecords.recordedStartAt, after.startAt),
                gt(healthConnectRawRecords.id, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(healthConnectRawRecords.recordedStartAt), asc(healthConnectRawRecords.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    records: page.map(toRawRecordView),
    next_cursor:
      rows.length > limit && last ? encodeCursor(last.recordedStartAt ?? '', last.id) : null,
  };
}

/**
 * The record as the API returns it. Everything sensitive lives in other
 * tables — the HMAC secret, PAT hashes and the run body digest are not
 * selected here and cannot appear in this shape.
 *
 * `null` and ABSENT are both preserved: the retained object is returned
 * verbatim, so a nutrient the source explicitly nulled stays null and one it
 * never sent stays missing.
 */
function toRawRecordView(row: HealthConnectRawRecordRow): RawRecordView {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    integration_id: row.integrationId,
    record_type: row.recordType,
    source_package: row.sourcePackage,
    source_uuid: row.sourceUuid,
    identity_kind: row.identityKind,
    recorded_start_at: row.recordedStartAt,
    recorded_end_at: row.recordedEndAt,
    phoenix_date: row.recordedStartAt ? dayKeyInTz(new Date(row.recordedStartAt), OWNER_TZ) : null,
    source_last_modified_at: row.sourceLastModifiedAt,
    observed_fields: Object.keys(payload).sort(),
    record: payload,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
  };
}

/** Opaque keyset cursor. Base64url of "<recorded_start_at>|<id>". */
function encodeCursor(startAt: string, id: string): string {
  return Buffer.from(`${startAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): { startAt: string; id: string } | null {
  if (!cursor) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new UnboundedQueryError('cursor is not a valid pagination cursor.');
  }
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) throw new UnboundedQueryError('cursor is not a valid pagination cursor.');
  return { startAt: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
}
