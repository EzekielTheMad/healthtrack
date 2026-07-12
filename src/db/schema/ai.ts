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

/**
 * daily_summaries — precomputed cache for the dashboard AI Health Overview.
 *
 * The overview used to call the reasoning model on every dashboard load
 * (visible spinner each time). Instead we cache one serialized HealthSummary
 * per owner per LOCAL day (America/Phoenix — the owner-timezone convention,
 * see src/lib/claude/summary-cache.ts) and serve it instantly. A daily cron
 * (POST /api/v1/health-summary/refresh) warms tomorrow's row; the read path
 * lazily fills or refreshes in the background.
 *
 * summary_json is the serialized HealthSummary (RAW model output with lab
 * provenance attached) — dismiss-until-new-labs filtering is applied at read
 * time, never baked into the cache, so dismissals stay live without a
 * regeneration.
 *
 * Owner-scoped like the other AI tables (no dependent/delegate surface).
 */
export const dailySummaries = sqliteTable(
  'daily_summaries',
  {
    id: uuidPk(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Owner-local calendar day the summary describes (YYYY-MM-DD). */
    summaryDate: text('summary_date').notNull(),
    /** Serialized HealthSummary ({ summary, highlights }). */
    summaryJson: text('summary_json').notNull(),
    /** ISO-8601 timestamp the summary was generated at. */
    generatedAt: text('generated_at').notNull(),
    /** Reasoning model id used to generate it. */
    model: text('model').notNull(),
  },
  (t) => [unique('daily_summaries_user_date_unique').on(t.userId, t.summaryDate)],
);

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
