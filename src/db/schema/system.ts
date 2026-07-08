/**
 * System/admin tables: breach_events, breach_notifications.
 * Source: 011_breach_notification.sql.
 *
 * These were service-role-only under RLS (enabled, no policies).
 * In the self-hosted app they are admin-only via the authz layer (Phase 3+).
 */
import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { uuidPk, timestampNow } from './_shared';

export const breachEvents = sqliteTable('breach_events', {
  id: uuidPk(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  discoveredAt: timestampNow('discovered_at'),
  // 'all' or comma-separated user_ids
  affectedScope: text('affected_scope').notNull().default('all'),
  createdAt: timestampNow('created_at'),
});

export const breachNotifications = sqliteTable(
  'breach_notifications',
  {
    id: uuidPk(),
    breachEventId: text('breach_event_id')
      .notNull()
      .references(() => breachEvents.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    // NULL until the notification email is sent
    notifiedAt: text('notified_at'),
    notificationMethod: text('notification_method').default('email'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    // source was partial (WHERE notified_at IS NULL); flattened per plan
    index('idx_breach_notif_pending').on(t.notifiedAt),
  ],
);
