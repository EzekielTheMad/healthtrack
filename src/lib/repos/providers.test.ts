// @vitest-environment node
/**
 * providers repo — proves requireAuthz wiring per the 003/012 SQL:
 * owner-only CRUD in 003 (providers has NO has_health_share policy → shares
 * never grant providers); 012 grants delegates SELECT (read_only+),
 * INSERT/UPDATE (read_write+), DELETE (admin).
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

type Repo = typeof import('./providers');

let ctx: RepoTestDb;
let repo: Repo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-providers-');
  repo = await import('./providers');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('providers repo', () => {
  it('owner CRUD round-trip, favorites first then name', async () => {
    await repo.createProvider(OWNER, { ownerId: OWNER, dependentId: null }, {
      name: 'Zeta Clinic',
      providerType: 'lab',
    });
    const fav = await repo.createProvider(OWNER, { ownerId: OWNER, dependentId: null }, {
      name: 'Alpha Care',
      providerType: 'pcp',
      isFavorite: true,
    });
    expect(fav.userId).toBe(OWNER);

    const listed = await repo.listProviders(OWNER, { ownerId: OWNER, dependentId: null });
    expect(listed.map((p) => p.name)).toEqual(['Alpha Care', 'Zeta Clinic']);

    const updated = await repo.updateProvider(OWNER, fav.id, { phone: '555-0100' });
    expect(updated.phone).toBe('555-0100');
    expect(updated.updatedAt >= fav.updatedAt).toBe(true);

    await repo.deleteProvider(OWNER, fav.id);
    expect(await repo.listProviders(OWNER, { ownerId: OWNER, dependentId: null })).toHaveLength(1);
  });

  it('scopes lists per dependent; delegate-mode "all" returns every scope', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    await repo.createProvider(OWNER, { ownerId: OWNER, dependentId: null }, { name: 'Self Doc' });
    await repo.createProvider(OWNER, { ownerId: OWNER, dependentId: depId }, { name: 'Dep Doc' });

    expect(
      (await repo.listProviders(OWNER, { ownerId: OWNER, dependentId: null })).map((p) => p.name),
    ).toEqual(['Self Doc']);
    expect(
      (await repo.listProviders(OWNER, { ownerId: OWNER, dependentId: depId })).map((p) => p.name),
    ).toEqual(['Dep Doc']);
    expect(
      (await repo.listProviders(OWNER, { ownerId: OWNER, dependentId: 'all' })).map((p) => p.name),
    ).toEqual(['Dep Doc', 'Self Doc']);
  });

  it('a health share never grants providers (no share policy in 003)', async () => {
    await repo.createProvider(OWNER, { ownerId: OWNER, dependentId: null }, { name: 'Doc' });
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['providers', 'medications'], // even listing it grants nothing
    });
    await expect(
      repo.listProviders(VIEWER, { ownerId: OWNER, dependentId: null }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.listProviders(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('delegate levels: read_only reads, read_write writes, only admin deletes', async () => {
    const row = await repo.createProvider(OWNER, { ownerId: OWNER, dependentId: null }, {
      name: 'Doc',
    });
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'read_only',
    });

    expect(
      await repo.listProviders(VIEWER, { ownerId: OWNER, dependentId: 'all' }),
    ).toHaveLength(1);
    await expect(
      repo.updateProvider(VIEWER, row.id, { name: 'Nope' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.createProvider(VIEWER, { ownerId: OWNER, dependentId: null }, { name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });

    // escalate to read_write: writes allowed, delete still denied
    ctx.sqlite
      .prepare(`update delegates set permission_level='read_write' where owner_id=?`)
      .run(OWNER);
    const created = await repo.createProvider(
      VIEWER,
      { ownerId: OWNER, dependentId: null },
      { name: 'By Delegate' },
    );
    expect(created.userId).toBe(OWNER);
    await expect(repo.deleteProvider(VIEWER, created.id)).rejects.toMatchObject({
      status: 404,
    });

    ctx.sqlite
      .prepare(`update delegates set permission_level='admin' where owner_id=?`)
      .run(OWNER);
    await repo.deleteProvider(VIEWER, created.id);
  });

  it('stranger gets 404 on every operation', async () => {
    const row = await repo.createProvider(OWNER, { ownerId: OWNER, dependentId: null }, {
      name: 'Doc',
    });
    await expect(
      repo.listProviders(STRANGER, { ownerId: OWNER, dependentId: null }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      repo.updateProvider(STRANGER, row.id, { name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(repo.deleteProvider(STRANGER, row.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('validates provider_type at the repo boundary', async () => {
    await expect(
      repo.createProvider(OWNER, { ownerId: OWNER, dependentId: null }, {
        name: 'X',
        providerType: 'astrologer' as never,
      }),
    ).rejects.toThrow();
  });
});
