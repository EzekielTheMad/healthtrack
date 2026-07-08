// @vitest-environment node
/**
 * api-keys repo — owner-only PAT management (013): list/create/revoke keyed
 * on user_id, token_hash never exposed, double revoke is a 409.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./api-keys');

let ctx: RepoTestDb;
let repo: Repo;

const input = {
  name: 'CLI key',
  prefix: 'ohts_pat_abc1234',
  tokenHash: 'a'.repeat(64),
  scopes: ['read:all'],
};

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-apikeys-');
  repo = await import('./api-keys');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
});

afterEach(() => ctx.restore());

describe('api-keys repo', () => {
  it('owner create + list (no token_hash in the view)', async () => {
    const created = await repo.createApiKey(OWNER, input);
    expect(created.name).toBe('CLI key');
    expect(created.revokedAt).toBeNull();
    expect('tokenHash' in created).toBe(false);
    expect('userId' in created).toBe(false);

    const listed = await repo.listApiKeys(OWNER);
    expect(listed).toHaveLength(1);
    expect(listed[0].scopes).toEqual(['read:all']);
    expect(await repo.listApiKeys(STRANGER)).toHaveLength(0);
  });

  it('revoke is owner-only; double revoke is a 409', async () => {
    const created = await repo.createApiKey(OWNER, input);

    await expect(repo.revokeApiKey(STRANGER, created.id)).rejects.toMatchObject({
      status: 404,
    });

    await repo.revokeApiKey(OWNER, created.id);
    const listed = await repo.listApiKeys(OWNER);
    expect(listed[0].revokedAt).toBeTruthy();

    await expect(repo.revokeApiKey(OWNER, created.id)).rejects.toMatchObject({
      status: 409,
    });
  });
});
