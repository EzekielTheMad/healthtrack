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

// 001 + 004 + 006
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
    // 006 — temporary snooze replaces permanent dismissal. An alert is shown
    // when snoozedUntil IS NULL or has already passed; snoozing sets it to a
    // future instant. `dismissed` is retained (unused) to avoid a destructive
    // column drop.
    snoozedUntil: text('snoozed_until'),
    // 006 — stable key for one interaction (sorted, lowercased med names), so a
    // re-check preserves an existing alert's snooze instead of wiping/recreating.
    signature: text('signature'),
    checkedAt: timestampNow('checked_at'),
    // jsonb not null (no default)
    medicationSnapshot: text('medication_snapshot', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
  },
  (t) => [index('idx_interaction_alerts_user').on(t.userId, t.dismissed, sql`${t.checkedAt} desc`)],
);

// 006 — one row per (user, dependent scope): the outcome of the most recent
// interaction check, so the UI can persist an "✓ no interactions found" state
// (absence of alert rows alone can't distinguish "clear" from "never checked").
export const interactionChecks = sqliteTable(
  'interaction_checks',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    hasInteractions: integer('has_interactions', { mode: 'boolean' }).notNull().default(false),
    checkedAt: timestampNow('checked_at'),
  },
  (t) => [index('idx_interaction_checks_user').on(t.userId, t.dependentId)],
);

// 007 — invite-only registration. After the first (admin) account exists,
// new accounts require a single-use invite link unless SIGNUPS_ENABLED=true.
// Tokens are stored plaintext: they are short-lived, single-use, and grant
// only the ability to register — not access to any data (unlike api_keys).
export const invites = sqliteTable('invites', {
  id: uuidPk(),
  token: text('token').notNull().unique(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  note: text('note'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  usedEmail: text('used_email'),
  createdAt: timestampNow('created_at'),
});

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
