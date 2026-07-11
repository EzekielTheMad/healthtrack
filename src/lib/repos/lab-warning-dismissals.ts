/**
 * ai_lab_warning_dismissals repository — dismiss-until-new-labs for
 * lab-derived AI warning cards (fitness-domain spec §AI integration #3).
 *
 * Strictly owner-only (dashboard-prefs pattern): dismissals are UI
 * preferences on the owner's own AI summary card; there is no dependent,
 * share, or delegate surface. Callers pass the session user's id.
 *
 * Semantics: a dismissal row stores the normalized test name plus the
 * user's LATEST lab visit date at dismissal time. Filtering (see
 * src/lib/claude/lab-warnings.ts) hides a warning only while its stamp is
 * still >= the current latest visit date — a newer lab import auto-clears it
 * at read time. Re-dismissing after new labs upserts the fresh stamp.
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { aiLabWarningDismissals, labVisits } from '@/db/schema';
import { NotFoundError } from '@/lib/authz';
import { normalizeLabTestKey } from '@/lib/claude/lab-warnings';

export type LabWarningDismissalRow = typeof aiLabWarningDismissals.$inferSelect;

/** Thrown when there is no lab data to key a dismissal against (400-shaped). */
export class NoLabDataError extends Error {
  readonly status = 400;
  constructor() {
    super('No lab visits exist — there is nothing to dismiss lab warnings against.');
    this.name = 'NoLabDataError';
  }
}

const testsSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(20);

/**
 * Newest lab visit date for the user (YYYY-MM-DD, any dependent scope —
 * matching the 'all' scope the AI summary reads labs with), or null.
 */
export async function latestLabVisitDate(userId: string): Promise<string | null> {
  if (!userId) throw new NotFoundError();
  const rows = await db
    .select({ visitDate: labVisits.visitDate })
    .from(labVisits)
    .where(eq(labVisits.userId, userId))
    .orderBy(desc(labVisits.visitDate))
    .limit(1);
  return rows[0]?.visitDate ?? null;
}

export async function listLabWarningDismissals(
  userId: string,
): Promise<LabWarningDismissalRow[]> {
  if (!userId) throw new NotFoundError();
  return db
    .select()
    .from(aiLabWarningDismissals)
    .where(eq(aiLabWarningDismissals.userId, userId));
}

export interface DismissLabWarningsResult {
  /** Normalized keys the dismissal covers. */
  keys: string[];
  /** The latest lab visit date the dismissal is stamped with. */
  labVisitDate: string;
}

/**
 * Dismiss the lab warnings citing `tests` (raw test names — normalized
 * here). Upserts one row per key, stamped with the current latest visit
 * date, so re-dismissing after a new lab import refreshes the stamp.
 */
export async function dismissLabWarnings(
  userId: string,
  tests: unknown,
): Promise<DismissLabWarningsResult> {
  if (!userId) throw new NotFoundError();
  const names = testsSchema.parse(tests);
  const keys = Array.from(new Set(names.map(normalizeLabTestKey)));

  const stamp = await latestLabVisitDate(userId);
  if (stamp === null) throw new NoLabDataError();

  const now = new Date().toISOString();
  for (const key of keys) {
    await db
      .insert(aiLabWarningDismissals)
      .values({ userId, warningKey: key, labVisitDate: stamp })
      .onConflictDoUpdate({
        target: [aiLabWarningDismissals.userId, aiLabWarningDismissals.warningKey],
        set: { labVisitDate: stamp, updatedAt: now },
      });
  }
  return { keys, labVisitDate: stamp };
}
