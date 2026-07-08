/**
 * Integration-domain tables: connected_sources, query_history,
 * interaction_alerts, api_keys.
 * Sources: 001_initial_schema.sql, 004_dependents.sql, 013_api_keys.sql.
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { dependents } from './users';
import { medications } from './clinical';
import { uuidPk, timestampNow } from './_shared';

// 001 — Oura etc.; tokens encrypted at rest via src/lib/crypto
export const connectedSources = sqliteTable('connected_sources', {
  id: uuidPk(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  sourceName: text('source_name').notNull(),
  accessTokenEncrypted: text('access_token_encrypted'),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  tokenExpiresAt: text('token_expires_at'),
  lastSyncAt: text('last_sync_at'),
  status: text('status').notNull().default('active'),
  createdAt: timestampNow('created_at'),
});

// 001 + 004
export const queryHistory = sqliteTable('query_history', {
  id: uuidPk(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  queryText: text('query_text').notNull(),
  responseText: text('response_text').notNull(),
  dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
  createdAt: timestampNow('created_at'),
});

// 001 + 004
export const interactionAlerts = sqliteTable(
  'interaction_alerts',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    triggerMedicationId: text('trigger_medication_id')
      .notNull()
      .references(() => medications.id, { onDelete: 'cascade' }),
    alertText: text('alert_text').notNull(),
    severity: text('severity', { enum: ['info', 'warning', 'critical'] })
      .notNull()
      .default('warning'),
    dismissed: integer('dismissed', { mode: 'boolean' }).notNull().default(false),
    checkedAt: timestampNow('checked_at'),
    // jsonb not null (no default)
    medicationSnapshot: text('medication_snapshot', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
  },
  (t) => [index('idx_interaction_alerts_user').on(t.userId, t.dismissed, sql`${t.checkedAt} desc`)],
);

// 013 — personal access tokens for the /api/v1 API
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    // text[] not null default array['read:all']
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull().default(['read:all']),
    lastUsedAt: text('last_used_at'),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_api_keys_user').on(t.userId),
    // source was partial (WHERE revoked_at IS NULL); flattened per plan —
    // token_hash is UNIQUE anyway, this is a lookup helper only
    index('idx_api_keys_hash').on(t.tokenHash),
  ],
);
