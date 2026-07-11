/**
 * AI-layer tables: ai_lab_warning_dismissals.
 *
 * Dismiss-until-new-labs for lab-derived AI warning cards (fitness-domain
 * spec §AI integration #3): a dismissal is keyed by the normalized lab test
 * name(s) a warning was derived from and stamps the user's LATEST lab visit
 * date at dismissal time. A warning stays hidden only while that stamp is
 * still >= the current latest visit date — importing newer lab data
 * auto-clears the dismissal (read-time comparison, no cleanup job needed).
 *
 * Strictly owner-scoped: dismissals are UI preferences on the owner's own AI
 * summary card (no dependent/delegate surface).
 */
import { sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { uuidPk, timestampNow } from './_shared';

export const aiLabWarningDismissals = sqliteTable(
  'ai_lab_warning_dismissals',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Normalized lab test name (lowercased, trimmed) the warning cites. */
    warningKey: text('warning_key').notNull(),
    /** Latest lab_visits.visit_date at dismissal time (YYYY-MM-DD). */
    labVisitDate: text('lab_visit_date').notNull(),
    createdAt: timestampNow('created_at'),
    updatedAt: timestampNow('updated_at'),
  },
  (t) => [unique('ai_lab_warning_dismissals_user_key_unique').on(t.userId, t.warningKey)],
);
