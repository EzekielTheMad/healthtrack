// @vitest-environment node
/**
 * delegates repo — invitation meta-authorization (012): owner full CRUD;
 * recipient (linked id OR email match) may list + accept/reject but never
 * delete or change permission; accept links delegate_user_id.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./delegates');

let ctx: RepoTestDb;
let repo: Repo;

const VIEWER_EMAIL = 'viewer@example.com';

const input = {
  delegateEmail: 'Viewer@Example.com',
  permissionLevel: 'read_write',
};

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-delegates-');
  repo = await import('./delegates');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER, VIEWER_EMAIL);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('delegates repo', () => {
  it('owner invites (pending, lowercased email); duplicate is 409', async () => {
    const row = await repo.createDelegateInvite(OWNER, input);
    expect(row.ownerId).toBe(OWNER);
    expect(row.delegateEmail).toBe(VIEWER_EMAIL);
    expect(row.delegateUserId).toBeNull();
    expect(row.status).toBe('pending');
    expect(row.acceptedAt).toBeNull();

    await expect(repo.createDelegateInvite(OWNER, input)).rejects.toMatchObject({
      status: 409,
    });

    expect(await repo.listSentDelegates(OWNER)).toHaveLength(1);
    expect(await repo.listSentDelegates(VIEWER)).toHaveLength(0);
  });

  it('recipient sees the invite by email and accepts (links user id)', async () => {
    const row = await repo.createDelegateInvite(OWNER, input);

    const received = await repo.listReceivedDelegates(VIEWER, VIEWER_EMAIL);
    expect(received.map((d) => d.id)).toEqual([row.id]);
    expect(
      await repo.listReceivedDelegates(STRANGER, 'other@example.com'),
    ).toHaveLength(0);

    await expect(
      repo.acceptDelegate(STRANGER, 'other@example.com', row.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(repo.acceptDelegate(OWNER, null, row.id)).rejects.toMatchObject({
      status: 404,
    });

    const accepted = await repo.acceptDelegate(VIEWER, VIEWER_EMAIL, row.id);
    expect(accepted.status).toBe('accepted');
    expect(accepted.delegateUserId).toBe(VIEWER);
    expect(accepted.acceptedAt).toBeTruthy();
  });

  it('recipient can reject; only the owner updates permission or deletes', async () => {
    const row = await repo.createDelegateInvite(OWNER, input);

    const rejected = await repo.rejectDelegate(VIEWER, VIEWER_EMAIL, row.id);
    expect(rejected.status).toBe('rejected');

    // recipient cannot change permission or delete
    await expect(
      repo.updateDelegatePermission(VIEWER, row.id, 'admin'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(repo.deleteDelegate(VIEWER, row.id)).rejects.toMatchObject({
      status: 404,
    });

    const updated = await repo.updateDelegatePermission(OWNER, row.id, 'admin');
    expect(updated.permissionLevel).toBe('admin');
    await expect(
      repo.updateDelegatePermission(OWNER, row.id, 'superuser'),
    ).rejects.toThrow();

    await repo.deleteDelegate(OWNER, row.id);
    expect(await repo.listSentDelegates(OWNER)).toHaveLength(0);
  });

  it('validates input and strips tampering keys', async () => {
    await expect(
      repo.createDelegateInvite(OWNER, { ...input, delegateEmail: 'nope' }),
    ).rejects.toThrow();
    await expect(
      repo.createDelegateInvite(OWNER, { ...input, permissionLevel: 'root' }),
    ).rejects.toThrow();

    const row = await repo.createDelegateInvite(OWNER, {
      ...input,
      ownerId: STRANGER,
      status: 'accepted',
      delegateUserId: STRANGER,
    } as never);
    expect(row.ownerId).toBe(OWNER);
    expect(row.status).toBe('pending');
    expect(row.delegateUserId).toBeNull();
  });
});
