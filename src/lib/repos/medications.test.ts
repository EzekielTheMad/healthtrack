// @vitest-environment node
/**
 * medications repo — proves requireAuthz wiring (full matrix in authz tests):
 * owner full; shares read-only with section + exact dependent match (014);
 * delegates read (read_only+), write (read_write+), delete (admin).
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

type Repo = typeof import('./medications');

let ctx: RepoTestDb;
let repo: Repo;

const ownScope = { ownerId: OWNER, dependentId: null };

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-medications-');
  repo = await import('./medications');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('medications repo', () => {
  it('owner CRUD round-trip with active filter and orderings', async () => {
    const active = await repo.createMedication(OWNER, ownScope, {
      name: 'Zolpidem',
      dosage: '5mg',
      frequency: 'once_daily',
    });
    // deterministic created_at ordering (both inserts can share a millisecond)
    ctx.sqlite
      .prepare(`update medications set created_at=? where id=?`)
      .run(PAST, active.id);
    await repo.createMedication(OWNER, ownScope, { name: 'Aspirin', active: false });

    const all = await repo.listMedications(OWNER, ownScope);
    expect(all).toHaveLength(2);
    // default ordering: created_at desc (hook parity) — newest first
    expect(all[0].name).toBe('Aspirin');

    const activeOnly = await repo.listMedications(OWNER, ownScope, { active: true });
    expect(activeOnly.map((m) => m.name)).toEqual(['Zolpidem']);

    const byName = await repo.listMedications(OWNER, ownScope, { orderBy: 'name' });
    expect(byName.map((m) => m.name)).toEqual(['Aspirin', 'Zolpidem']);

    const updated = await repo.updateMedication(OWNER, active.id, {
      dosage: '10mg',
      active: false,
    });
    expect(updated.dosage).toBe('10mg');
    expect(updated.active).toBe(false);
    expect(updated.updatedAt >= active.updatedAt).toBe(true);

    await repo.deleteMedication(OWNER, active.id);
    expect(await repo.listMedications(OWNER, ownScope)).toHaveLength(1);
  });

  it('share grants read with exact dependent scope, never write', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    const row = await repo.createMedication(OWNER, ownScope, { name: 'OwnerMed' });
    await repo.createMedication(OWNER, { ownerId: OWNER, dependentId: depId }, {
      name: 'DepMed',
    });

    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['medications'],
      dependentId: null, // owner-scoped share
    });

    // read of the matching scope works
    const seen = await repo.listMedications(VIEWER, ownScope);
    expect(seen.map((m) => m.name)).toEqual(['OwnerMed']);

    // wrong dependent scope → denied (014 exact matching)
    await expect(
      repo.listMedications(VIEWER, { ownerId: OWNER, dependentId: depId }),
    ).rejects.toMatchObject({ status: 404 });

    // shares are dependent-exact → never an unfiltered 'all' listing
    await expect(
      repo.listMedications(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
    ).rejects.toMatchObject({ status: 404 });

    // shares never write/delete
    await expect(
      repo.createMedication(VIEWER, ownScope, { name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.updateMedication(VIEWER, row.id, { name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(repo.deleteMedication(VIEWER, row.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('read_only delegate reads (incl. unfiltered) but cannot write', async () => {
    const row = await repo.createMedication(OWNER, ownScope, { name: 'Med' });
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'read_only',
    });

    expect(
      await repo.listMedications(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
    ).toHaveLength(1);
    await expect(
      repo.updateMedication(VIEWER, row.id, { name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("expired delegate is denied the unfiltered 'all' listing", async () => {
    await repo.createMedication(OWNER, ownScope, { name: 'Med' });
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'read_only',
      expiresAt: PAST,
    });

    await expect(
      repo.listMedications(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('read_write delegate writes into the owner scope; delete needs admin', async () => {
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'read_write',
    });
    const created = await repo.createMedication(VIEWER, ownScope, { name: 'ByDelegate' });
    expect(created.userId).toBe(OWNER);
    const updated = await repo.updateMedication(VIEWER, created.id, { dosage: '1mg' });
    expect(updated.dosage).toBe('1mg');
    await expect(repo.deleteMedication(VIEWER, created.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('stranger is denied on everything', async () => {
    const row = await repo.createMedication(OWNER, ownScope, { name: 'Med' });
    await expect(repo.listMedications(STRANGER, ownScope)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      repo.updateMedication(STRANGER, row.id, { name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('requires a name and strips scope-tampering keys on update', async () => {
    await expect(
      repo.createMedication(OWNER, ownScope, { dosage: '5mg' }),
    ).rejects.toThrow();

    const row = await repo.createMedication(OWNER, ownScope, { name: 'Med' });
    const updated = await repo.updateMedication(OWNER, row.id, {
      name: 'Med2',
      userId: STRANGER, // must be ignored
      dependentId: crypto.randomUUID(), // must be ignored
    } as never);
    expect(updated.userId).toBe(OWNER);
    expect(updated.dependentId).toBeNull();
  });
});
