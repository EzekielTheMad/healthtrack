// @vitest-environment node
/**
 * ai_lab_warning_dismissals repo — dismiss-until-new-labs (fitness-domain
 * spec §AI integration #3): dismissal is keyed to the latest lab visit date,
 * hides the warning, and AUTO-CLEARS when a newer lab visit is imported.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { z } from 'zod';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from './repo-test-harness';
import {
  filterDismissedLabHighlights,
  type LabTaggedHighlight,
} from '@/lib/claude/lab-warnings';

type Repo = typeof import('./lab-warning-dismissals');

let ctx: RepoTestDb;
let repo: Repo;

function insertLabVisit(userId: string, visitDate: string): string {
  const id = crypto.randomUUID();
  ctx.sqlite
    .prepare(
      `insert into lab_visits (id, user_id, visit_date, created_at)
       values (?, ?, ?, ?)`,
    )
    .run(id, userId, visitDate, new Date().toISOString());
  return id;
}

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-lab-dismiss-');
  repo = await import('./lab-warning-dismissals');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

describe('lab-warning-dismissals repo', () => {
  it('latestLabVisitDate returns the newest visit date per user, null when none', async () => {
    expect(await repo.latestLabVisitDate(OWNER)).toBeNull();
    insertLabVisit(OWNER, '2026-02-10');
    insertLabVisit(OWNER, '2026-05-26');
    insertLabVisit(VIEWER, '2026-07-01'); // other user's visit never leaks in
    expect(await repo.latestLabVisitDate(OWNER)).toBe('2026-05-26');
  });

  it('rejects a dismissal when the user has no lab data', async () => {
    await expect(repo.dismissLabWarnings(OWNER, ['LDL Cholesterol'])).rejects.toBeInstanceOf(
      repo.NoLabDataError,
    );
  });

  it('validates the tests payload', async () => {
    insertLabVisit(OWNER, '2026-05-26');
    await expect(repo.dismissLabWarnings(OWNER, [])).rejects.toBeInstanceOf(z.ZodError);
    await expect(repo.dismissLabWarnings(OWNER, 'LDL')).rejects.toBeInstanceOf(z.ZodError);
    await expect(repo.dismissLabWarnings(OWNER, [42])).rejects.toBeInstanceOf(z.ZodError);
  });

  it('dismiss → hidden; newer lab visit → warning eligible again (spec flow)', async () => {
    insertLabVisit(OWNER, '2026-05-26');

    const warning: LabTaggedHighlight = {
      type: 'attention',
      text: 'LDL cholesterol was high as of your May 26 draw.',
      labTests: ['LDL Cholesterol'],
      labAsOf: '2026-05-26',
    };
    const plain: LabTaggedHighlight = { type: 'action', text: 'Schedule a check-up.' };

    // Nothing dismissed yet → warning visible.
    let dismissals = await repo.listLabWarningDismissals(OWNER);
    let latest = await repo.latestLabVisitDate(OWNER);
    expect(filterDismissedLabHighlights([warning, plain], dismissals, latest)).toEqual([
      warning,
      plain,
    ]);

    // Dismiss — keyed to the CURRENT latest visit date (normalization applied).
    const result = await repo.dismissLabWarnings(OWNER, ['  LDL   Cholesterol ']);
    expect(result).toEqual({ keys: ['ldl cholesterol'], labVisitDate: '2026-05-26' });

    // Hidden now; the non-lab highlight is untouched.
    dismissals = await repo.listLabWarningDismissals(OWNER);
    latest = await repo.latestLabVisitDate(OWNER);
    expect(filterDismissedLabHighlights([warning, plain], dismissals, latest)).toEqual([plain]);

    // Newer lab data arrives → the stale stamp no longer hides the warning.
    insertLabVisit(OWNER, '2026-07-01');
    latest = await repo.latestLabVisitDate(OWNER);
    expect(filterDismissedLabHighlights([warning, plain], dismissals, latest)).toEqual([
      warning,
      plain,
    ]);

    // Re-dismissing UPSERTS the fresh stamp (no unique-constraint violation)…
    const again = await repo.dismissLabWarnings(OWNER, ['LDL Cholesterol']);
    expect(again.labVisitDate).toBe('2026-07-01');
    dismissals = await repo.listLabWarningDismissals(OWNER);
    expect(dismissals).toHaveLength(1);
    expect(dismissals[0].labVisitDate).toBe('2026-07-01');

    // …and the warning is hidden again until the next import.
    expect(filterDismissedLabHighlights([warning, plain], dismissals, latest)).toEqual([plain]);
  });

  it('dismissals are per-user: one user cannot hide another user\'s warnings', async () => {
    insertLabVisit(OWNER, '2026-05-26');
    insertLabVisit(VIEWER, '2026-05-26');
    await repo.dismissLabWarnings(VIEWER, ['LDL Cholesterol']);

    const ownerDismissals = await repo.listLabWarningDismissals(OWNER);
    expect(ownerDismissals).toHaveLength(0);

    const warning: LabTaggedHighlight = {
      type: 'attention',
      text: 'x',
      labTests: ['LDL Cholesterol'],
    };
    expect(
      filterDismissedLabHighlights([warning], ownerDismissals, '2026-05-26'),
    ).toEqual([warning]);
  });

  it('a multi-test dismissal writes one row per normalized key', async () => {
    insertLabVisit(OWNER, '2026-05-26');
    const result = await repo.dismissLabWarnings(OWNER, ['LDL Cholesterol', 'Vitamin D', 'vitamin d']);
    expect(result.keys.sort()).toEqual(['ldl cholesterol', 'vitamin d']);
    expect(await repo.listLabWarningDismissals(OWNER)).toHaveLength(2);
  });
});
