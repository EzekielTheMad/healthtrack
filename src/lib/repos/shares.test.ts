// @vitest-environment node
/**
 * shares repo — meta-authorization for health_shares rows plus the public
 * token path. Key cases: owner-only create/update/delete; recipient (by id or
 * email match) may see + accept but never delete (recipient revoke is a
 * silent no-op, RLS parity); listSharedData applies the share's exact
 * dependent scope per section.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  VIEWER,
  STRANGER,
  PAST,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./shares');

let ctx: RepoTestDb;
let repo: Repo;

const VIEWER_EMAIL = 'viewer@example.com';

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-shares-');
  repo = await import('./shares');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER, VIEWER_EMAIL);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

const input = {
  sharedWithEmail: 'Viewer@Example.com',
  accessLevel: 'read',
  sharedSections: ['medications', 'labs'],
};

describe('shares repo — row management', () => {
  it('owner creates (email lowercased, token minted, unaccepted); duplicate is 409', async () => {
    const share = await repo.createShare(OWNER, input);
    expect(share.ownerId).toBe(OWNER);
    expect(share.sharedWithEmail).toBe(VIEWER_EMAIL);
    expect(share.sharedWithId).toBeNull();
    expect(share.accepted).toBe(false);
    expect(share.shareToken).toMatch(/^[0-9a-f-]{36}$/);

    await expect(repo.createShare(OWNER, input)).rejects.toMatchObject({
      status: 409,
    });
    // sent listing
    expect(await repo.listSentShares(OWNER)).toHaveLength(1);
    expect(await repo.listSentShares(VIEWER)).toHaveLength(0);
  });

  it('recipient sees the invite by email, accepts, and gets linked', async () => {
    const share = await repo.createShare(OWNER, input);

    const received = await repo.listReceivedShares(VIEWER, VIEWER_EMAIL);
    expect(received.map((s) => s.id)).toEqual([share.id]);
    expect(await repo.listReceivedShares(STRANGER, 'other@example.com')).toHaveLength(0);

    // stranger cannot accept
    await expect(
      repo.acceptShare(STRANGER, 'other@example.com', share.id),
    ).rejects.toMatchObject({ status: 404 });
    // the owner is not the recipient either
    await expect(repo.acceptShare(OWNER, null, share.id)).rejects.toMatchObject({
      status: 404,
    });

    const accepted = await repo.acceptShare(VIEWER, VIEWER_EMAIL, share.id);
    expect(accepted.accepted).toBe(true);
    expect(accepted.sharedWithId).toBe(VIEWER); // bootstrap link on accept
  });

  it('re-accept by a later owner of the same email never re-links the share', async () => {
    const share = await repo.createShare(OWNER, input);
    await repo.acceptShare(VIEWER, VIEWER_EMAIL, share.id);

    // VIEWER later changes their account email, freeing the address; an
    // attacker registers it and re-accepts. The share must stay linked to
    // the original recipient.
    ctx.sqlite
      .prepare('update user set email = ? where id = ?')
      .run('viewer-new@example.com', VIEWER);
    const attacker = crypto.randomUUID().replace(/-/g, '').slice(0, 32);
    insertUser(ctx.sqlite, attacker, VIEWER_EMAIL);

    const reaccepted = await repo.acceptShare(attacker, VIEWER_EMAIL, share.id);
    expect(reaccepted.sharedWithId).toBe(VIEWER); // NOT the attacker
  });

  it('update + delete are owner-only; recipient revoke is a silent no-op', async () => {
    const share = await repo.createShare(OWNER, input);
    await repo.acceptShare(VIEWER, VIEWER_EMAIL, share.id);

    // recipient cannot update settings
    await expect(
      repo.updateShare(VIEWER, share.id, { accessLevel: 'read_write' }),
    ).rejects.toMatchObject({ status: 404 });
    const updated = await repo.updateShare(OWNER, share.id, {
      sharedSections: ['vitals'],
    });
    expect(updated.sharedSections).toEqual(['vitals']);

    // recipient "revoke" succeeds but deletes nothing (RLS parity)
    await repo.revokeShare(VIEWER, VIEWER_EMAIL, share.id);
    expect(await repo.listSentShares(OWNER)).toHaveLength(1);
    // recipient hard-delete is denied
    await expect(repo.deleteShare(VIEWER, share.id)).rejects.toMatchObject({
      status: 404,
    });
    // stranger revoke is a 404
    await expect(
      repo.revokeShare(STRANGER, 'other@example.com', share.id),
    ).rejects.toMatchObject({ status: 404 });

    // owner revoke deletes
    await repo.revokeShare(OWNER, null, share.id);
    expect(await repo.listSentShares(OWNER)).toHaveLength(0);
  });

  it('validates input and strips tampering keys', async () => {
    await expect(
      repo.createShare(OWNER, { ...input, sharedSections: [] }),
    ).rejects.toThrow();
    await expect(
      repo.createShare(OWNER, { ...input, sharedWithEmail: 'not-an-email' }),
    ).rejects.toThrow();
    const share = await repo.createShare(OWNER, {
      ...input,
      ownerId: STRANGER,
      accepted: true,
      shareToken: 'attacker-chosen',
    } as never);
    expect(share.ownerId).toBe(OWNER);
    expect(share.accepted).toBe(false);
    expect(share.shareToken).not.toBe('attacker-chosen');
  });
});

describe('shares repo — public token path', () => {
  it('resolves shares by token', async () => {
    const share = await repo.createShare(OWNER, input);
    const found = await repo.getShareByToken(share.shareToken!);
    expect(found?.id).toBe(share.id);
    expect(await repo.getShareByToken(crypto.randomUUID())).toBeNull();
  });

  it('listSharedData applies the exact dependent scope per section', async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);

    const insertMed = ctx.sqlite.prepare(
      `insert into medications (id, user_id, dependent_id, name, active, created_at, updated_at)
       values (?, ?, ?, ?, 1, ?, ?)`,
    );
    insertMed.run(crypto.randomUUID(), OWNER, null, 'OwnerMed', PAST, PAST);
    insertMed.run(crypto.randomUUID(), OWNER, depId, 'DepMed', PAST, PAST);
    // inactive meds are excluded from the public view
    ctx.sqlite
      .prepare(
        `insert into medications (id, user_id, dependent_id, name, active, created_at, updated_at)
         values (?, ?, null, 'InactiveMed', 0, ?, ?)`,
      )
      .run(crypto.randomUUID(), OWNER, PAST, PAST);

    // owner-scoped share sees only the owner's own active medication
    const ownerShare = await repo.createShare(OWNER, input);
    const ownerData = await repo.listSharedData(ownerShare);
    expect(
      (ownerData.medications as { name: string }[]).map((m) => m.name),
    ).toEqual(['OwnerMed']);
    expect(ownerData.labs).toEqual([]);
    // only shared sections are present
    expect(Object.keys(ownerData).sort()).toEqual(['labs', 'medications']);

    // dependent-scoped share sees only the dependent's rows
    ctx.sqlite
      .prepare(`update health_shares set dependent_id = ? where id = ?`)
      .run(depId, ownerShare.id);
    const depShare = (await repo.getShareByToken(ownerShare.shareToken!))!;
    const depData = await repo.listSharedData(depShare);
    expect(
      (depData.medications as { name: string }[]).map((m) => m.name),
    ).toEqual(['DepMed']);
  });
});
