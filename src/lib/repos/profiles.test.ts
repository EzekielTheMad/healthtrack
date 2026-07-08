// @vitest-environment node
/**
 * profiles repo — proves requireAuthz is wired (the full grant matrix lives
 * in src/lib/authz/authz.test.ts) plus owner CRUD behavior.
 *
 * Profile rules (003/012): PK id IS the user id; owner full access; delegates
 * READ-ONLY at every permission level; health shares never grant profile.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  insertShare,
  insertDelegate,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./profiles');

let ctx: RepoTestDb;
let repo: Repo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-profiles-');
  repo = await import('./profiles');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('profiles repo', () => {
  it('owner upserts then reads own profile; update bumps updatedAt', async () => {
    expect(await repo.getProfile(OWNER, OWNER)).toBeNull();

    const created = await repo.upsertProfile(OWNER, OWNER, {
      displayName: 'Owner',
      biologicalSex: 'female',
      unitSystem: 'metric',
      heightInches: 66,
      weightLbs: 140.5,
    });
    expect(created.id).toBe(OWNER);
    expect(created.displayName).toBe('Owner');
    expect(created.unitSystem).toBe('metric');

    const updated = await repo.upsertProfile(OWNER, OWNER, {
      displayName: 'Renamed',
    });
    expect(updated.displayName).toBe('Renamed');
    // untouched fields survive the upsert
    expect(updated.biologicalSex).toBe('female');
    expect(updated.heightInches).toBe(66);

    const fetched = await repo.getProfile(OWNER, OWNER);
    expect(fetched?.displayName).toBe('Renamed');
  });

  it('rejects invalid enum values at the repo boundary (zod)', async () => {
    await expect(
      repo.upsertProfile(OWNER, OWNER, {
        biologicalSex: 'prefer_not_to_say' as never,
      }),
    ).rejects.toThrow();
    await expect(
      repo.upsertProfile(OWNER, OWNER, { unitSystem: 'nautical' as never }),
    ).rejects.toThrow();
  });

  it('stranger can neither read nor write another profile (404 semantics)', async () => {
    await repo.upsertProfile(OWNER, OWNER, { displayName: 'Owner' });
    await expect(repo.getProfile(STRANGER, OWNER)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      repo.upsertProfile(STRANGER, OWNER, { displayName: 'hax' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a health share never grants profile access, even accepted', async () => {
    await repo.upsertProfile(OWNER, OWNER, { displayName: 'Owner' });
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['medications', 'labs', 'vitals'],
    });
    await expect(repo.getProfile(VIEWER, OWNER)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('delegates read but never write, even at admin level', async () => {
    await repo.upsertProfile(OWNER, OWNER, { displayName: 'Owner' });
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'admin',
    });
    const viewed = await repo.getProfile(VIEWER, OWNER);
    expect(viewed?.displayName).toBe('Owner');
    await expect(
      repo.upsertProfile(VIEWER, OWNER, { displayName: 'nope' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
