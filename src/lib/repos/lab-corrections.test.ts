// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { setupRepoDb, insertUser, OWNER, STRANGER, type RepoTestDb } from './repo-test-harness';
let ctx: RepoTestDb;
let repo: typeof import('./labs');
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-lab-correction-');
  repo = await import('./labs');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
});
afterEach(() => ctx.restore());
async function create() {
  return repo.createLabVisitWithResults(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    {
      visitDate: '2026-02-04',
      sourcePdfPath: `${OWNER}/synthetic.pdf`,
      results: [
        { testName: 'Synthetic A', value: 5, unit: 'mg', loincCode: '718-7' },
        { testName: 'Synthetic B', value: 7, unit: 'mg' },
      ],
    }
  );
}
describe('stable saved lab corrections', () => {
  it('changes requested values and date atomically while keeping stable IDs, sibling results and source', async () => {
    const before = await create();
    const corrected = await repo.updateLabVisit(OWNER, before.id, {
      visitDate: '2026-02-03',
      results: [
        { id: before.labResults[0].id, value: 8, referenceRangeLow: 2, referenceRangeHigh: 9 },
      ],
      reason: 'Checked source',
    });
    expect(corrected.id).toBe(before.id);
    expect(corrected.labResults.map((r) => r.id)).toEqual(before.labResults.map((r) => r.id));
    expect(corrected.labResults[1].value).toBe(7);
    expect(corrected.labResults[0].loincCode).toBe('718-7');
    expect(corrected.sourcePdfPath).toBe(before.sourcePdfPath);
    const audit = ctx.sqlite
      .prepare('SELECT before_json,after_json,reason FROM clinical_corrections')
      .get() as { before_json: string; after_json: string; reason: string };
    expect(JSON.parse(audit.before_json).labResults[0].value).toBe(5);
    expect(JSON.parse(audit.after_json).labResults[0].value).toBe(8);
    expect(audit.reason).toBe('Checked source');
  });
  it('rejects foreign result IDs and source replacements without partial changes', async () => {
    const before = await create();
    const other = await create();
    await expect(
      repo.updateLabVisit(OWNER, before.id, {
        visitDate: '2026-02-03',
        results: [
          { id: before.labResults[0].id, value: 8 },
          { id: other.labResults[0].id, value: 99 },
        ],
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await repo.listLabVisitsWithResults(OWNER, { ownerId: OWNER, dependentId: null })).find(
        (v) => v.id === before.id
      )?.labResults[0].value
    ).toBe(5);
    await expect(
      repo.updateLabVisit(OWNER, before.id, { sourcePdfPath: 'replacement' })
    ).rejects.toThrow();
    await expect(
      repo.updateLabVisit(STRANGER, before.id, { notes: 'foreign edit' })
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects invalid dates, nonfinite values and inverted ranges', async () => {
    const before = await create();
    await expect(
      repo.updateLabVisit(OWNER, before.id, { visitDate: '2026-02-30' })
    ).rejects.toThrow();
    await expect(
      repo.updateLabVisit(OWNER, before.id, {
        results: [{ id: before.labResults[0].id, value: Infinity }],
      })
    ).rejects.toThrow();
    await expect(
      repo.updateLabVisit(OWNER, before.id, {
        results: [{ id: before.labResults[0].id, referenceRangeLow: 10, referenceRangeHigh: 2 }],
      })
    ).rejects.toThrow();
  });
  it('rolls back the visit when result persistence fails', async () => {
    ctx.sqlite.exec(
      "CREATE TRIGGER synthetic_failure BEFORE INSERT ON lab_results BEGIN SELECT RAISE(ABORT,'synthetic failure'); END"
    );
    await expect(create()).rejects.toThrow();
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_visits').get()).toEqual({ n: 0 });
  });
});
