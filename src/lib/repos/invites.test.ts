// @vitest-environment node
/**
 * invites repo — single-use registration invites: create/list/validate,
 * atomic consumption (no double-redeem), expiry, and revocation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  type RepoTestDb,
} from './repo-test-harness';

type InvitesRepo = typeof import('./invites');

let ctx: RepoTestDb;
let repo: InvitesRepo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-invites-');
  repo = await import('./invites');
  insertUser(ctx.sqlite, OWNER);
});

afterEach(() => ctx.restore());

describe('invites repo', () => {
  it('creates an invite with a unique token and default 7-day expiry', async () => {
    const row = await repo.createInvite(OWNER, { note: 'for mom' });
    expect(row.token.length).toBeGreaterThanOrEqual(24);
    expect(row.note).toBe('for mom');
    expect(row.usedAt).toBeNull();
    const days = (new Date(row.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(await repo.isInviteValid(row.token)).toBe(true);
  });

  it('clamps expiresInDays to the 1–30 range', async () => {
    const long = await repo.createInvite(OWNER, { expiresInDays: 999 });
    const days = (new Date(long.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeLessThan(30.1);
  });

  it('consumes exactly once (atomic), recording the email', async () => {
    const row = await repo.createInvite(OWNER);
    expect(await repo.consumeInvite(row.token, 'kid@example.com')).toBe(true);
    // Second redemption of the same token must lose.
    expect(await repo.consumeInvite(row.token, 'other@example.com')).toBe(false);
    expect(await repo.isInviteValid(row.token)).toBe(false);

    const [listed] = await repo.listInvites();
    expect(listed.usedEmail).toBe('kid@example.com');
    expect(listed.usedAt).not.toBeNull();
  });

  it('rejects expired and unknown tokens', async () => {
    const row = await repo.createInvite(OWNER);
    // Force-expire directly in the DB.
    ctx.sqlite
      .prepare('update invites set expires_at = ? where id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), row.id);
    expect(await repo.isInviteValid(row.token)).toBe(false);
    expect(await repo.consumeInvite(row.token)).toBe(false);
    expect(await repo.consumeInvite('no-such-token')).toBe(false);
    expect(await repo.isInviteValid('')).toBe(false);
  });

  it('revocation removes the invite', async () => {
    const row = await repo.createInvite(OWNER);
    await repo.deleteInvite(row.id);
    expect(await repo.isInviteValid(row.token)).toBe(false);
    expect(await repo.listInvites()).toHaveLength(0);
  });
});
