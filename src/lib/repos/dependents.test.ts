// @vitest-environment node
/**
 * dependents repo — owner-only management (004) + transition flow semantics:
 * transition marks the row and creates a dependent-scoped, read-only,
 * unaccepted health_share; data rows are never re-keyed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertDelegate,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./dependents');

let ctx: RepoTestDb;
let repo: Repo;

const input = {
  name: 'Kid',
  dateOfBirth: '2010-05-01',
  relationship: 'child',
  transitionAge: 18,
};

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-dependents-');
  repo = await import('./dependents');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('dependents repo', () => {
  it('owner CRUD round-trip, newest first', async () => {
    const a = await repo.createDependent(OWNER, input);
    expect(a.parentUserId).toBe(OWNER);
    expect(a.transitioned).toBe(false);
    expect(a.transitionedTo).toBeNull();

    const listed = await repo.listDependents(OWNER);
    expect(listed).toHaveLength(1);

    const updated = await repo.updateDependent(OWNER, a.id, { name: 'Kiddo' });
    expect(updated.name).toBe('Kiddo');

    await repo.deleteDependent(OWNER, a.id);
    expect(await repo.listDependents(OWNER)).toHaveLength(0);
  });

  it('strips scope/transition tampering keys', async () => {
    const row = await repo.createDependent(OWNER, {
      ...input,
      parentUserId: STRANGER,
      transitioned: true,
      transitionedTo: STRANGER,
    } as never);
    expect(row.parentUserId).toBe(OWNER);
    expect(row.transitioned).toBe(false);
    expect(row.transitionedTo).toBeNull();
  });

  it('rejects invalid input (future DOB, bad transition age)', async () => {
    await expect(
      repo.createDependent(OWNER, { ...input, dateOfBirth: '2999-01-01' }),
    ).rejects.toThrow();
    await expect(
      repo.createDependent(OWNER, { ...input, transitionAge: 5 }),
    ).rejects.toThrow();
  });

  it('non-owners (stranger AND admin delegate) are denied with 404', async () => {
    const row = await repo.createDependent(OWNER, input);
    // even an accepted admin delegate has no grant on dependents rows (004)
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'admin',
    });

    for (const actor of [STRANGER, VIEWER]) {
      expect(await repo.listDependents(actor)).toHaveLength(0);
      await expect(
        repo.updateDependent(actor, row.id, { name: 'X' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(repo.deleteDependent(actor, row.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        repo.transitionDependent(actor, row.id, 'a@b.com'),
      ).rejects.toMatchObject({ status: 404 });
    }
  });

  it('transition marks the row and creates the dependent-scoped share', async () => {
    const row = await repo.createDependent(OWNER, input);
    const { shareToken } = await repo.transitionDependent(
      OWNER,
      row.id,
      'New.Adult@Example.com',
    );

    const after = (await repo.listDependents(OWNER))[0];
    expect(after.transitioned).toBe(true);
    // data is NOT re-keyed and transitioned_to stays null — the new account
    // reads historical data by accepting the share
    expect(after.transitionedTo).toBeNull();

    const share = ctx.sqlite
      .prepare(`select * from health_shares where share_token = ?`)
      .get(shareToken) as Record<string, unknown>;
    expect(share.owner_id).toBe(OWNER);
    expect(share.dependent_id).toBe(row.id);
    expect(share.shared_with_email).toBe('new.adult@example.com');
    expect(share.shared_with_id).toBeNull();
    expect(share.access_level).toBe('read');
    expect(share.accepted).toBe(0);
    expect(JSON.parse(share.shared_sections as string)).toEqual([
      ...repo.TRANSITION_SHARE_SECTIONS,
    ]);
  });

  it('second transition attempt is a 409', async () => {
    const row = await repo.createDependent(OWNER, input);
    await repo.transitionDependent(OWNER, row.id, 'a@b.com');
    await expect(
      repo.transitionDependent(OWNER, row.id, 'a@b.com'),
    ).rejects.toMatchObject({ status: 409 });
    // no duplicate share row was created
    const count = ctx.sqlite
      .prepare(`select count(*) n from health_shares where dependent_id = ?`)
      .get(row.id) as { n: number };
    expect(count.n).toBe(1);
  });
});
