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
  insertDependent,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from './repo-test-harness';
import { filterDismissedLabHighlights, type LabTaggedHighlight } from '@/lib/claude/lab-warnings';

import { OWNER_AI_CONTEXT_VERSION } from '@/lib/claude/owner-context';

type Repo = typeof import('./lab-warning-dismissals');

let ctx: RepoTestDb;
let repo: Repo;

function insertLabVisit(
  userId: string,
  visitDate: string,
  dependentId: string | null = null
): string {
  const id = crypto.randomUUID();
  ctx.sqlite
    .prepare(
      `insert into lab_visits (id, user_id, visit_date, dependent_id, created_at)
       values (?, ?, ?, ?, ?)`
    )
    .run(id, userId, visitDate, dependentId, new Date().toISOString());
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
      repo.NoLabDataError
    );
  });

  it('uses only owner lab dates despite newer visits for two dependents and another account', async () => {
    insertDependent(ctx.sqlite, 'dep-one', OWNER);
    insertDependent(ctx.sqlite, 'dep-two', OWNER);
    insertLabVisit(OWNER, '2026-05-26');
    insertLabVisit(OWNER, '2026-06-01', 'dep-one');
    insertLabVisit(OWNER, '2026-07-01', 'dep-two');
    insertLabVisit(VIEWER, '2026-08-01');
    expect(await repo.latestLabVisitDate(OWNER)).toBe('2026-05-26');
    expect(await repo.dismissLabWarnings(OWNER, ['LDL'])).toEqual({
      keys: ['ldl'],
      labVisitDate: '2026-05-26',
    });
    const [dismissal] = await repo.listLabWarningDismissals(OWNER);
    expect(dismissal.contextVersion).toBe(OWNER_AI_CONTEXT_VERSION);
    const warning: LabTaggedHighlight = {
      type: 'attention',
      text: 'Owner warning',
      labTests: ['LDL'],
    };

    // A child's new import must not undo an owner's dismissal.
    insertLabVisit(OWNER, '2026-09-01', 'dep-one');
    expect(
      filterDismissedLabHighlights([warning], [dismissal], await repo.latestLabVisitDate(OWNER))
    ).toEqual([]);
    // A genuinely new OWNER draw does make the warning eligible again.
    insertLabVisit(OWNER, '2026-05-27');
    expect(
      filterDismissedLabHighlights([warning], [dismissal], await repo.latestLabVisitDate(OWNER))
    ).toEqual([warning]);
  });

  it('cannot create owner dismissals when only dependents or another account have lab visits', async () => {
    insertDependent(ctx.sqlite, 'dep-one', OWNER);
    insertDependent(ctx.sqlite, 'dep-two', OWNER);
    insertLabVisit(OWNER, '2026-06-01', 'dep-one');
    insertLabVisit(OWNER, '2026-07-01', 'dep-two');
    insertLabVisit(VIEWER, '2026-08-01');
    expect(await repo.latestLabVisitDate(OWNER)).toBeNull();
    await expect(repo.dismissLabWarnings(OWNER, ['LDL'])).rejects.toBeInstanceOf(
      repo.NoLabDataError
    );
    expect(ctx.sqlite.prepare('select count(*) as n from ai_lab_warning_dismissals').get()).toEqual(
      { n: 0 }
    );
  });

  it('ignores legacy and unknown-policy dismissals without overwriting them on re-dismissal', async () => {
    insertLabVisit(OWNER, '2026-05-26');
    ctx.sqlite
      .prepare(
        `insert into ai_lab_warning_dismissals
      (id, user_id, warning_key, lab_visit_date, created_at, updated_at)
      values ('legacy', ?, 'ldl', '2099-01-01', '2026-05-01', '2026-05-01')`
      )
      .run(OWNER);
    ctx.sqlite
      .prepare(
        `insert into ai_lab_warning_dismissals
      (id, user_id, warning_key, lab_visit_date, context_version, created_at, updated_at)
      values ('unknown', ?, 'vitamin d', '2099-01-01', 99, '2026-05-01', '2026-05-01')`
      )
      .run(OWNER);
    const legacy = ctx.sqlite
      .prepare('select * from ai_lab_warning_dismissals where id = ?')
      .get('legacy');
    const warning: LabTaggedHighlight = {
      type: 'attention',
      text: 'Owner warning',
      labTests: ['LDL'],
    };
    expect(await repo.listLabWarningDismissals(OWNER)).toEqual([]);
    expect(
      filterDismissedLabHighlights(
        [warning],
        await repo.listLabWarningDismissals(OWNER),
        '2026-05-26'
      )
    ).toEqual([warning]);

    await repo.dismissLabWarnings(OWNER, ['LDL']);
    insertLabVisit(OWNER, '2026-05-27');
    await repo.dismissLabWarnings(OWNER, ['LDL']);
    const current = await repo.listLabWarningDismissals(OWNER);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      labVisitDate: '2026-05-27',
      contextVersion: OWNER_AI_CONTEXT_VERSION,
    });
    expect(
      ctx.sqlite.prepare('select * from ai_lab_warning_dismissals where id = ?').get('legacy')
    ).toEqual(legacy);
    expect(ctx.sqlite.prepare('select count(*) as n from ai_lab_warning_dismissals').get()).toEqual(
      { n: 3 }
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

  it("dismissals are per-user: one user cannot hide another user's warnings", async () => {
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
    expect(filterDismissedLabHighlights([warning], ownerDismissals, '2026-05-26')).toEqual([
      warning,
    ]);
  });

  it('a multi-test dismissal writes one row per normalized key', async () => {
    insertLabVisit(OWNER, '2026-05-26');
    const result = await repo.dismissLabWarnings(OWNER, [
      'LDL Cholesterol',
      'Vitamin D',
      'vitamin d',
    ]);
    expect(result.keys.sort()).toEqual(['ldl cholesterol', 'vitamin d']);
    expect(await repo.listLabWarningDismissals(OWNER)).toHaveLength(2);
  });
});
