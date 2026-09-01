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
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type DB } from '@/db';
import {
  healthConnectIngestRuns,
  healthConnectIntegrations,
  healthConnectRawRecords,
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
import { NORMALIZABLE_TYPES } from '@/lib/integrations/health-connect/schema';

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
