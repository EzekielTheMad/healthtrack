/**
 * Sharing-domain tables: health_shares, delegates.
 * Sources: 001_initial_schema.sql, 012_delegate_access.sql,
 * 014_health_shares_dependent_scope.sql.
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { dependents } from './users';
import { uuidPk, timestampNow } from './_shared';

// 001 + 014 (dependent_id)
export const healthShares = sqliteTable(
  'health_shares',
  {
    id: uuidPk(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sharedWithEmail: text('shared_with_email').notNull(),
    sharedWithId: text('shared_with_id').references(() => user.id, { onDelete: 'cascade' }),
    accessLevel: text('access_level', { enum: ['read', 'read_write'] })
      .notNull()
      .default('read'),
    // text[] not null default '{medications,labs,vitals,conditions}'
    sharedSections: text('shared_sections', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(['medications', 'labs', 'vitals', 'conditions']),
    shareToken: text('share_token').unique(),
    accepted: integer('accepted', { mode: 'boolean' }).notNull().default(false),
    expiresAt: text('expires_at'),
    // 014: NULL = share of the owner's own data; set = share of that dependent's
    // data only. has_health_share semantics require exact match.
    dependentId: text('dependent_id').references(() => dependents.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_health_shares_dependent').on(t.dependentId)],
);

// 012
export const delegates = sqliteTable(
  'delegates',
  {
    id: uuidPk(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    delegateUserId: text('delegate_user_id').references(() => user.id, { onDelete: 'set null' }),
    delegateEmail: text('delegate_email').notNull(),
    permissionLevel: text('permission_level', {
      enum: ['read_only', 'read_write', 'admin'],
    })
      .notNull()
      .default('read_only'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    invitedAt: timestampNow('invited_at'),
    acceptedAt: text('accepted_at'),
    expiresAt: text('expires_at'),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [
    index('idx_delegates_owner').on(t.ownerId),
    index('idx_delegates_delegate_user').on(t.delegateUserId),
    index('idx_delegates_email').on(t.delegateEmail),
    // Kept partial (SQLite supports it): a rejected invite must not block
    // re-inviting the same email.
    uniqueIndex('idx_delegates_unique_pair')
      .on(t.ownerId, t.delegateEmail)
      .where(sql`status != 'rejected'`),
  ],
);
