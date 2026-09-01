/**
 * Health Connect ingestion tables: health_connect_integrations,
 * health_connect_ingest_runs, health_connect_raw_records.
 *
 * New domain (no legacy SQL migration). The Life Dashboard companion app
 * (owen282000/life-dashboard-companion-app v1.8.x) POSTs Health Connect
 * records to /api/v1/integrations/health-connect/webhook; these tables are
 * the LOSSLESS RAW BOUNDARY that sits in front of normalization into vitals
 * and nutrition_daily.
 *
 * Authorization: strictly owner-only, like vital_source_preferences — an
 * integration is device plumbing, not shareable medical content, so there is
 * no authz Section, no share grant and no delegate grant. Every query keys on
 * user_id directly (src/lib/repos/health-connect.ts).
 *
 * Retention (PRD §6.10): deleting an integration never touches canonical
 * data. Raw rows carry their own user_id and integration_id is nullable with
 * ON DELETE SET NULL, so the user can delete the integration while choosing
 * to retain the raw history.
 */
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { uuidPk, timestampNow } from './_shared';

/** Lifecycle of an integration. New integrations start in 'inventory':
    records are stored raw but nothing is normalized until the user approves
    exact source packages (PRD §6.5 — never skip the inventory stage). */
export const HEALTH_CONNECT_STATUSES = ['inventory', 'active', 'paused', 'error'] as const;
export type HealthConnectStatus = (typeof HEALTH_CONNECT_STATUSES)[number];

/** Outcome of one webhook delivery. 'duplicate' is a payload-level retry
    (same body_sha256 for the integration); 'test_ping' is the companion
    app's "Send Test Ping" envelope, which carries no health records. */
export const INGEST_RUN_STATUSES = [
  'accepted',
  'duplicate',
  'test_ping',
  'rejected',
] as const;
export type IngestRunStatus = (typeof INGEST_RUN_STATUSES)[number];

/**
 * How a raw record's identity was established:
 *  - 'uuid'    — the record carried Health Connect's stable record id, so
 *                deduplication is strong across batches and edits.
 *  - 'derived' — no uuid was present. Identity is derived from the record's
 *                own content (or, for daily_totals, its date). Labelled so it
 *                never silently claims strong deduplication (PRD §6.4).
 */
export const RAW_IDENTITY_KINDS = ['uuid', 'derived'] as const;
export type RawIdentityKind = (typeof RAW_IDENTITY_KINDS)[number];

/** Per-record-type allowlist of exact Android package names approved for
    normalization, e.g. { "nutrition": ["com.sbs.diet"] }. Matching is
    exact — never substring (PRD §10). */
export type AllowedSources = Record<string, string[]>;

/** How the nutrition domain collapses a Phoenix day into one canonical row.
    Chosen after inventory reveals MacroFactor's real record shape (PRD §6.7):
      - 'aggregate'      — sum every deduplicated record for that day (food /
                           meal records; also correct for a single summary).
      - 'daily_snapshot' — take only the newest record for that day (used when
                           the source emits ONE mutable daily-summary record
                           alongside item records, where summing double counts).
    Never additive against previously stored totals in either mode. */
export const NUTRITION_STRATEGIES = ['aggregate', 'daily_snapshot'] as const;
export type NutritionStrategy = (typeof NUTRITION_STRATEGIES)[number];

export const healthConnectIntegrations = sqliteTable(
  'health_connect_integrations',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status', { enum: HEALTH_CONNECT_STATUSES })
      .notNull()
      .default('inventory'),
    /** AES-256-GCM via src/lib/crypto — never returned by any read path. */
    hmacSecretEncrypted: text('hmac_secret_encrypted').notNull(),
    /** { recordType: [exact package, ...] } */
    allowedSources: text('allowed_sources_json', { mode: 'json' })
      .$type<AllowedSources>()
      .notNull()
      .default({}),
    /** Record types approved for canonical writes ('daily_totals', 'nutrition'). */
    enabledTypes: text('enabled_types_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    nutritionStrategy: text('nutrition_strategy', { enum: NUTRITION_STRATEGIES })
      .notNull()
      .default('aggregate'),
    lastReceivedAt: text('last_received_at'),
    lastNormalizedAt: text('last_normalized_at'),
    lastAppVersion: text('last_app_version'),
    lastError: text('last_error'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    // One Health Connect integration per user: the webhook resolves the PAT
    // to a user and must find exactly one integration without a client-
    // supplied integration id (PRD §9 — no client-controlled ids).
    uniqueIndex('idx_health_connect_integrations_user').on(t.userId),
  ],
);

export const healthConnectIngestRuns = sqliteTable(
  'health_connect_ingest_runs',
  {
    id: uuidPk(),
    integrationId: text('integration_id').references(
      () => healthConnectIntegrations.id,
      { onDelete: 'set null' },
    ),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    payloadTimestamp: text('payload_timestamp'),
    appVersion: text('app_version'),
    /** sha256 hex of the EXACT raw request bytes — payload-level retry key. */
    bodySha256: text('body_sha256').notNull(),
    isBackfill: integer('is_backfill', { mode: 'boolean' }).notNull().default(false),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    status: text('status', { enum: INGEST_RUN_STATUSES }).notNull(),
    receivedCount: integer('received_count').notNull().default(0),
    insertedCount: integer('inserted_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    normalizationSummary: text('normalization_summary_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** The envelope as received, minus the record arrays that are already
        stored per record (see RAW_ENVELOPE_MAX_CHARS in the ingest module). */
    rawEnvelope: text('raw_envelope_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    receivedAt: timestampNow('received_at'),
    completedAt: text('completed_at'),
  },
  (t) => [
    index('idx_health_connect_runs_user').on(t.userId, t.receivedAt),
    // Payload-level retry detection (PRD §6.4) — NOT record-level identity.
    uniqueIndex('idx_health_connect_runs_body').on(t.integrationId, t.bodySha256),
  ],
);

export const healthConnectRawRecords = sqliteTable(
  'health_connect_raw_records',
  {
    id: uuidPk(),
    integrationId: text('integration_id').references(
      () => healthConnectIntegrations.id,
      { onDelete: 'set null' },
    ),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Envelope array key: 'nutrition', 'daily_totals', 'sleep', … */
    recordType: text('record_type').notNull(),
    /** Android package that wrote the record to Health Connect, verbatim. */
    sourcePackage: text('source_package').notNull(),
    /** Health Connect record id, verbatim — or a derived id (see identityKind). */
    sourceUuid: text('source_uuid').notNull(),
    identityKind: text('identity_kind', { enum: RAW_IDENTITY_KINDS })
      .notNull()
      .default('uuid'),
    recordedStartAt: text('recorded_start_at'),
    recordedEndAt: text('recorded_end_at'),
    sourceLastModifiedAt: text('source_last_modified_at'),
    /** The record object exactly as delivered — unknown fields included. */
    payload: text('payload_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    firstSeenAt: timestampNow('first_seen_at'),
    lastSeenAt: timestampNow('last_seen_at'),
    lastIngestId: text('last_ingest_id'),
    /** Reserved: the relay exposes no reliable delete events yet (PRD §4). */
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('idx_health_connect_raw_lookup').on(t.userId, t.recordType, t.recordedStartAt),
    index('idx_health_connect_raw_integration').on(t.integrationId),
    // Record-level identity (PRD §6.4). User-scoped, not integration-scoped:
    // the same phone record must not fork if the integration is recreated.
    uniqueIndex('idx_health_connect_raw_identity').on(
      t.userId,
      t.recordType,
      t.sourcePackage,
      t.sourceUuid,
    ),
  ],
);
