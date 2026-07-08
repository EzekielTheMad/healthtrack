// @vitest-environment node
/**
 * labs repo (lab_visits + lab_results) — proves requireAuthz wiring.
 * AUTHZ RULING (see src/lib/authz header): labs mutations are OWNER-ONLY —
 * 012 gave delegates INSERT but no UPDATE/DELETE, so 'write' is
 * conservatively denied for delegates. Shares grant read with section 'labs'.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertShare,
  insertDelegate,
  OWNER,
  VIEWER,
  STRANGER,
  PAST,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./labs');

let ctx: RepoTestDb;
let repo: Repo;

const ownScope = { ownerId: OWNER, dependentId: null };

const sampleVisit = {
  visitDate: '2026-06-01',
  sourcePdfPath: 'labs/owner/report.pdf',
  notes: 'Imported from Quest',
  results: [
    {
      panelName: 'CBC',
      testName: 'Hemoglobin',
      value: 14.2,
      unit: 'g/dL',
      referenceRangeLow: 13.5,
      referenceRangeHigh: 17.5,
      flag: 'normal',
    },
    {
      panelName: 'CBC',
      testName: 'WBC',
      value: 11.4,
      unit: 'K/uL',
      referenceRangeLow: 4.5,
      referenceRangeHigh: 11,
      flag: 'high',
    },
  ],
};

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-labs-');
  repo = await import('./labs');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('labs repo', () => {
  it('owner creates a visit with results and lists them nested, newest visit first', async () => {
    const older = await repo.createLabVisitWithResults(OWNER, ownScope, {
      visitDate: '2026-01-15',
      results: [],
    });
    const visit = await repo.createLabVisitWithResults(OWNER, ownScope, sampleVisit);
    expect(visit.labResults).toHaveLength(2);
    expect(visit.labResults[0].userId).toBe(OWNER);
    expect(visit.labResults[0].labVisitId).toBe(visit.id);

    const visits = await repo.listLabVisitsWithResults(OWNER, ownScope);
    expect(visits.map((v) => v.id)).toEqual([visit.id, older.id]);
    expect(visits[0].sourcePdfPath).toBe('labs/owner/report.pdf');
    expect(visits[0].labResults.map((r) => r.testName).sort()).toEqual([
      'Hemoglobin',
      'WBC',
    ]);
    expect(visits[1].labResults).toEqual([]);
  });

  it('dependent scoping: exact filter on list, rows carry the dependent id', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    await repo.createLabVisitWithResults(OWNER, ownScope, {
      visitDate: '2026-02-01',
      results: [],
    });
    const depVisit = await repo.createLabVisitWithResults(
      OWNER,
      { ownerId: OWNER, dependentId: depId },
      sampleVisit,
    );
    expect(depVisit.dependentId).toBe(depId);
    expect(depVisit.labResults[0].dependentId).toBe(depId);

    const own = await repo.listLabVisitsWithResults(OWNER, ownScope);
    expect(own).toHaveLength(1);
    expect(own[0].dependentId).toBeNull();

    const dep = await repo.listLabVisitsWithResults(OWNER, {
      ownerId: OWNER,
      dependentId: depId,
    });
    expect(dep).toHaveLength(1);
    expect(dep[0].labResults).toHaveLength(2);

    const all = await repo.listLabVisitsWithResults(OWNER, {
      ownerId: OWNER,
      dependentId: 'all',
    });
    expect(all).toHaveLength(2);
  });

  it('share with labs section grants read (exact dependent scope), never write', async () => {
    await repo.createLabVisitWithResults(OWNER, ownScope, sampleVisit);
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['labs'],
      dependentId: null,
    });

    const seen = await repo.listLabVisitsWithResults(VIEWER, ownScope);
    expect(seen).toHaveLength(1);

    // shares are dependent-exact → never an unfiltered listing
    await expect(
      repo.listLabVisitsWithResults(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      repo.createLabVisitWithResults(VIEWER, ownScope, sampleVisit),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('wrong-section share is denied', async () => {
    await repo.createLabVisitWithResults(OWNER, ownScope, sampleVisit);
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['medications'],
      dependentId: null,
    });
    await expect(repo.listLabVisitsWithResults(VIEWER, ownScope)).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it('delegates read labs but NEVER write them (authz ruling), any level', async () => {
    await repo.createLabVisitWithResults(OWNER, ownScope, sampleVisit);
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'admin',
    });

    const seen = await repo.listLabVisitsWithResults(VIEWER, {
      ownerId: OWNER,
      dependentId: 'all',
    });
    expect(seen).toHaveLength(1);

    await expect(
      repo.createLabVisitWithResults(VIEWER, ownScope, sampleVisit),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('stranger is denied on everything', async () => {
    await repo.createLabVisitWithResults(OWNER, ownScope, sampleVisit);
    await expect(repo.listLabVisitsWithResults(STRANGER, ownScope)).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(repo.listLabResults(STRANGER, ownScope)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('listLabResults returns flat rows with visit_date, filterable by test names', async () => {
    const visit = await repo.createLabVisitWithResults(OWNER, ownScope, sampleVisit);
    // deterministic created_at ordering across rows
    ctx.sqlite
      .prepare(`update lab_results set created_at=? where test_name='Hemoglobin'`)
      .run(PAST);

    const all = await repo.listLabResults(OWNER, { ownerId: OWNER, dependentId: 'all' });
    expect(all).toHaveLength(2);
    // created_at desc → WBC (newer) first
    expect(all[0].testName).toBe('WBC');
    expect(all[0].visitDate).toBe('2026-06-01');
    expect(all[0].labVisitId).toBe(visit.id);

    const filtered = await repo.listLabResults(
      OWNER,
      { ownerId: OWNER, dependentId: 'all' },
      { testNames: ['Hemoglobin'] },
    );
    expect(filtered.map((r) => r.testName)).toEqual(['Hemoglobin']);
  });

  it('listLabResultsV1 matches the PAT shape: substring test match, days window, id desc', async () => {
    await repo.createLabVisitWithResults(OWNER, ownScope, sampleVisit);
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    // dependent-scoped rows are excluded from the PAT surface (dependent_id null)
    await repo.createLabVisitWithResults(
      OWNER,
      { ownerId: OWNER, dependentId: depId },
      sampleVisit,
    );
    // old visit outside the days window
    await repo.createLabVisitWithResults(OWNER, ownScope, {
      visitDate: '2020-01-01',
      results: [{ testName: 'Hemoglobin', value: 12.1 }],
    });

    const rows = await repo.listLabResultsV1(OWNER, {});
    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([...ids].sort().reverse()); // id desc

    const byTest = await repo.listLabResultsV1(OWNER, { test: 'hemo' });
    expect(byTest.every((r) => r.testName === 'Hemoglobin')).toBe(true);
    expect(byTest).toHaveLength(2);

    const recent = await repo.listLabResultsV1(OWNER, { test: 'hemo', days: 365 });
    expect(recent).toHaveLength(1);
    expect(recent[0].visitDate).toBe('2026-06-01');
  });

  it('validates input and strips scope-tampering keys', async () => {
    await expect(
      repo.createLabVisitWithResults(OWNER, ownScope, { results: [] }),
    ).rejects.toThrow(); // visitDate required

    await expect(
      repo.createLabVisitWithResults(OWNER, ownScope, {
        visitDate: '2026-06-01',
        results: [{ testName: 'X', value: 'not-a-number' }],
      }),
    ).rejects.toThrow();

    const visit = await repo.createLabVisitWithResults(OWNER, ownScope, {
      visitDate: '2026-06-01',
      userId: STRANGER, // must be ignored
      dependentId: crypto.randomUUID(), // must be ignored
      results: [{ testName: 'X', value: 1, userId: STRANGER, dependentId: 'nope' }],
    } as never);
    expect(visit.userId).toBe(OWNER);
    expect(visit.dependentId).toBeNull();
    expect(visit.labResults[0].userId).toBe(OWNER);
    expect(visit.labResults[0].dependentId).toBeNull();
  });
});
