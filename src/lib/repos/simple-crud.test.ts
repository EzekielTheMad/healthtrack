// @vitest-environment node
/**
 * conditions / allergies / procedures / vaccines repos — the four share one
 * CRUD + authz shape, so the suite is parameterized. It proves requireAuthz
 * is WIRED per domain (owner CRUD, cross-user denial, share-read-not-write,
 * delegate levels); the exhaustive grant matrix lives in authz.test.ts.
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
  type RepoTestDb,
} from './repo-test-harness';

interface CrudRow {
  id: string;
  userId: string;
  dependentId: string | null;
  notes: string | null;
  updatedAt: string;
}

interface CrudRepo {
  list(actorId: string, scope: { ownerId: string; dependentId: string | null | 'all' }): Promise<CrudRow[]>;
  create(
    actorId: string,
    scope: { ownerId: string; dependentId: string | null },
    input: unknown,
  ): Promise<CrudRow>;
  update(actorId: string, id: string, updates: unknown): Promise<CrudRow>;
  remove(actorId: string, id: string): Promise<void>;
}

interface DomainCase {
  name: string;
  section: string;
  load(): Promise<CrudRepo>;
  sample: Record<string, unknown>;
  invalid: Record<string, unknown>;
}

const domains: DomainCase[] = [
  {
    name: 'conditions',
    section: 'conditions',
    load: async () => {
      const m = await import('./conditions');
      return {
        list: m.listConditions,
        create: m.createCondition,
        update: m.updateCondition,
        remove: m.deleteCondition,
      };
    },
    sample: { name: 'Asthma' },
    invalid: { name: 'X', status: 'zombie' },
  },
  {
    name: 'allergies',
    section: 'allergies',
    load: async () => {
      const m = await import('./allergies');
      return {
        list: m.listAllergies,
        create: m.createAllergy,
        update: m.updateAllergy,
        remove: m.deleteAllergy,
      };
    },
    sample: { name: 'Peanuts', severity: 'severe' },
    invalid: { name: 'X', severity: 'apocalyptic' },
  },
  {
    name: 'procedures',
    section: 'procedures',
    load: async () => {
      const m = await import('./procedures');
      return {
        list: m.listProcedures,
        create: m.createProcedure,
        update: m.updateProcedure,
        remove: m.deleteProcedure,
      };
    },
    sample: { name: 'Appendectomy', procedureDate: '2026-01-15' },
    invalid: { name: 'X' }, // procedureDate required
  },
  {
    name: 'vaccines',
    section: 'vaccines',
    load: async () => {
      const m = await import('./vaccines');
      return {
        list: m.listVaccines,
        create: m.createVaccine,
        update: m.updateVaccine,
        remove: m.deleteVaccine,
      };
    },
    sample: { name: 'Tdap', vaccineDate: '2026-01-15' },
    invalid: { vaccineDate: '2026-01-15' }, // name required
  },
];

const ownScope = { ownerId: OWNER, dependentId: null };

for (const domain of domains) {
  describe(`${domain.name} repo`, () => {
    let ctx: RepoTestDb;
    let repo: CrudRepo;

    beforeEach(async () => {
      ctx = await setupRepoDb(`healthtrack-repo-${domain.name}-`);
      repo = await domain.load();
      insertUser(ctx.sqlite, OWNER);
      insertUser(ctx.sqlite, VIEWER);
      insertUser(ctx.sqlite, STRANGER);
    });

    afterEach(() => ctx.restore());

    it('owner CRUD round-trip (updatedAt maintained on update)', async () => {
      const created = await repo.create(OWNER, ownScope, domain.sample);
      expect(created.userId).toBe(OWNER);
      expect(created.dependentId).toBeNull();

      expect(await repo.list(OWNER, ownScope)).toHaveLength(1);

      const updated = await repo.update(OWNER, created.id, { notes: 'updated' });
      expect(updated.notes).toBe('updated');
      expect(updated.updatedAt >= created.updatedAt).toBe(true);

      await repo.remove(OWNER, created.id);
      expect(await repo.list(OWNER, ownScope)).toHaveLength(0);
    });

    it('dependent scoping: exact filter for owner, ownership enforced', async () => {
      const depId = crypto.randomUUID();
      insertDependent(ctx.sqlite, depId, OWNER);
      await repo.create(OWNER, { ownerId: OWNER, dependentId: depId }, domain.sample);

      expect(await repo.list(OWNER, ownScope)).toHaveLength(0);
      expect(await repo.list(OWNER, { ownerId: OWNER, dependentId: depId })).toHaveLength(1);
      // stranger cannot use someone else's dependent scope
      await expect(
        repo.create(STRANGER, { ownerId: STRANGER, dependentId: depId }, domain.sample),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('cross-user access is denied (404 semantics)', async () => {
      const row = await repo.create(OWNER, ownScope, domain.sample);
      await expect(repo.list(STRANGER, ownScope)).rejects.toMatchObject({ status: 404 });
      await expect(
        repo.update(STRANGER, row.id, { notes: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(repo.remove(STRANGER, row.id)).rejects.toMatchObject({ status: 404 });
    });

    it('share grants read on the exact scope, never write/delete', async () => {
      const row = await repo.create(OWNER, ownScope, domain.sample);
      insertShare(ctx.sqlite, {
        ownerId: OWNER,
        sharedWithId: VIEWER,
        sections: [domain.section],
        dependentId: null,
      });

      expect(await repo.list(VIEWER, ownScope)).toHaveLength(1);
      await expect(
        repo.list(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        repo.create(VIEWER, ownScope, domain.sample),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        repo.update(VIEWER, row.id, { notes: 'x' }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(repo.remove(VIEWER, row.id)).rejects.toMatchObject({ status: 404 });
    });

    it('delegate levels: read_only reads, read_write writes, admin deletes', async () => {
      const row = await repo.create(OWNER, ownScope, domain.sample);
      insertDelegate(ctx.sqlite, {
        ownerId: OWNER,
        delegateUserId: VIEWER,
        permissionLevel: 'read_only',
      });

      expect(
        await repo.list(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
      ).toHaveLength(1);
      await expect(
        repo.update(VIEWER, row.id, { notes: 'x' }),
      ).rejects.toMatchObject({ status: 404 });

      ctx.sqlite
        .prepare(`update delegates set permission_level='read_write' where owner_id=?`)
        .run(OWNER);
      const updated = await repo.update(VIEWER, row.id, { notes: 'by delegate' });
      expect(updated.notes).toBe('by delegate');
      await expect(repo.remove(VIEWER, row.id)).rejects.toMatchObject({ status: 404 });

      ctx.sqlite
        .prepare(`update delegates set permission_level='admin' where owner_id=?`)
        .run(OWNER);
      await repo.remove(VIEWER, row.id);
      expect(await repo.list(OWNER, ownScope)).toHaveLength(0);
    });

    it('rejects invalid input at the repo boundary (zod)', async () => {
      await expect(repo.create(OWNER, ownScope, domain.invalid)).rejects.toThrow();
    });
  });
}

describe('vaccines dose coercion', () => {
  let ctx: RepoTestDb;

  beforeEach(async () => {
    ctx = await setupRepoDb('healthtrack-repo-vaccines-extra-');
    insertUser(ctx.sqlite, OWNER);
  });

  afterEach(() => ctx.restore());

  it('accepts numeric dose_number/series_doses and stores them as text', async () => {
    const { createVaccine } = await import('./vaccines');
    const row = await createVaccine(OWNER, ownScope, {
      name: 'Tdap',
      vaccineDate: '2026-01-15',
      doseNumber: 1,
      seriesDoses: 3,
    });
    expect(row.doseNumber).toBe('1');
    expect(row.seriesDoses).toBe('3');
  });
});
