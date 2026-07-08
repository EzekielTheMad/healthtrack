// @vitest-environment node
/**
 * connected-sources repo — owner-only rows, emulated (user_id, source_name)
 * upsert, status transitions — plus the crypto round-trip on a key sourced
 * from getOrCreateSecret (no ENCRYPTION_KEY env set: the key file is
 * generated under the temp DATA_DIR).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from './repo-test-harness';

type Repo = typeof import('./connected-sources');

let ctx: RepoTestDb;
let repo: Repo;
let savedEncryptionKey: string | undefined;

beforeEach(async () => {
  savedEncryptionKey = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  ctx = await setupRepoDb('healthtrack-repo-sources-');
  repo = await import('./connected-sources');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => {
  if (savedEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedEncryptionKey;
  ctx.restore();
});

describe('connected-sources repo', () => {
  it('upsert creates then replaces the single (user, source) row', async () => {
    const first = await repo.upsertConnectedSource(OWNER, 'oura', {
      accessTokenEncrypted: 'enc-a',
      refreshTokenEncrypted: 'enc-r',
      tokenExpiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect(first.status).toBe('active');
    expect(first.lastSyncAt).toBeNull();

    await repo.touchLastSync(OWNER, 'oura');

    // reconnect: same row id, tokens replaced, last_sync_at reset
    const second = await repo.upsertConnectedSource(OWNER, 'oura', {
      accessTokenEncrypted: 'enc-a2',
      refreshTokenEncrypted: 'enc-r2',
      tokenExpiresAt: '2031-01-01T00:00:00.000Z',
    });
    expect(second.id).toBe(first.id);
    expect(second.accessTokenEncrypted).toBe('enc-a2');
    expect(second.lastSyncAt).toBeNull();

    const count = ctx.sqlite
      .prepare(
        `select count(*) n from connected_sources where user_id = ? and source_name = 'oura'`,
      )
      .get(OWNER) as { n: number };
    expect(count.n).toBe(1);
  });

  it('rows are owner-scoped; status transitions and token updates stick', async () => {
    const row = await repo.upsertConnectedSource(OWNER, 'oura', {
      accessTokenEncrypted: 'enc',
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });

    // another user sees nothing
    expect(await repo.getConnectedSource(VIEWER, 'oura')).toBeNull();
    // and their "updates" touch nothing
    await repo.setConnectedSourceStatus(VIEWER, 'oura', 'disconnected');
    await repo.updateConnectedSourceTokens(VIEWER, row.id, {
      accessTokenEncrypted: 'stolen',
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
    });
    const unchanged = await repo.getConnectedSource(OWNER, 'oura');
    expect(unchanged?.status).toBe('active');
    expect(unchanged?.accessTokenEncrypted).toBe('enc');

    await repo.setConnectedSourceStatus(OWNER, 'oura', 'expired');
    expect((await repo.getConnectedSource(OWNER, 'oura'))?.status).toBe('expired');

    await repo.updateConnectedSourceTokens(OWNER, row.id, {
      accessTokenEncrypted: 'enc2',
      refreshTokenEncrypted: 'r2',
      tokenExpiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect((await repo.getConnectedSource(OWNER, 'oura'))?.accessTokenEncrypted).toBe(
      'enc2',
    );
  });

  it('crypto round-trips with a generated (file-based) encryption key', async () => {
    const { encrypt } = await import('@/lib/crypto/encrypt');
    const { decrypt } = await import('@/lib/crypto/decrypt');
    const ciphertext = encrypt('oura-access-token');
    expect(ciphertext).not.toContain('oura-access-token');
    expect(decrypt(ciphertext)).toBe('oura-access-token');
    // key was persisted under the temp DATA_DIR keys dir
    const fs = await import('fs');
    const path = await import('path');
    const keyFile = path.join(ctx.tmpDir, 'keys', 'encryption_key');
    expect(fs.existsSync(keyFile)).toBe(true);
    expect(fs.readFileSync(keyFile, 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
  });
});
