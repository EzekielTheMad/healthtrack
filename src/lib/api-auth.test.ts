// @vitest-environment node
/**
 * PAT (api_keys) auth — drizzle port of src/lib/api-auth.ts.
 * Contract preserved from the legacy implementation:
 *  - token format ohts_pat_<base64url>, sha256-hex token_hash lookup
 *  - revoked_at set → invalid; expires_at in the past → invalid
 *  - validateApiKey updates last_used_at as a side effect
 *  - hasScope: exact match, read:all / write:all wildcards
 *  - unauthorized() → 401, forbidden() → 403
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';

type ApiAuthModule = typeof import('./api-auth');

let tmpDir: string;
let savedDataDir: string | undefined;
let sqlite: Database.Database;
let apiAuth: ApiAuthModule;

const NOW = Date.now();
const PAST = new Date(NOW - 60_000).toISOString();
const FUTURE = new Date(NOW + 60 * 60 * 1000).toISOString();
const T = new Date(NOW).toISOString();

const USER_ID = 'pat-user-00000000000000000000000';

function insertUser(id: string, email: string) {
  sqlite
    .prepare(
      `insert into user (id, name, email, emailVerified, role, createdAt, updatedAt)
       values (?, ?, ?, 0, 'user', ?, ?)`,
    )
    .run(id, id, email, NOW, NOW);
}

function insertKey(opts: {
  userId?: string;
  tokenHash: string;
  scopes?: string[];
  expiresAt?: string | null;
  revokedAt?: string | null;
}): string {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `insert into api_keys
         (id, user_id, name, token_hash, prefix, scopes, last_used_at, expires_at, revoked_at, created_at)
       values (?, ?, 'test key', ?, 'ohts_pat_xxxxxxx', ?, null, ?, ?, ?)`,
    )
    .run(
      id,
      opts.userId ?? USER_ID,
      opts.tokenHash,
      JSON.stringify(opts.scopes ?? ['read:all']),
      opts.expiresAt ?? null,
      opts.revokedAt ?? null,
      T,
    );
  return id;
}

beforeEach(async () => {
  savedDataDir = process.env.DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-pat-'));
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  const [{ runMigrations }, dbMod, mod] = await Promise.all([
    import('@/db/migrate'),
    import('@/db'),
    import('./api-auth'),
  ]);
  runMigrations();
  sqlite = dbMod.getSqlite();
  apiAuth = mod;
  insertUser(USER_ID, 'pat@example.com');
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // WAL handles on Windows may lag; temp dir is cleaned by the OS
  }
});

describe('generateApiKey / hashToken', () => {
  it('generates ohts_pat_ tokens with a 16-char prefix and sha256-hex hash', () => {
    const { token, prefix, hash } = apiAuth.generateApiKey();
    expect(token.startsWith('ohts_pat_')).toBe(true);
    expect(prefix).toBe(token.slice(0, 16));
    expect(hash).toBe(apiAuth.hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('validateApiKey', () => {
  it('resolves userId, scopes, and keyId for a valid token', async () => {
    const { token, hash } = apiAuth.generateApiKey();
    const keyId = insertKey({ tokenHash: hash, scopes: ['read:medications'] });
    const ctx = await apiAuth.validateApiKey(`Bearer ${token}`);
    expect(ctx).toEqual({
      userId: USER_ID,
      scopes: ['read:medications'],
      keyId,
    });
  });

  it('updates last_used_at as a side effect', async () => {
    const { token, hash } = apiAuth.generateApiKey();
    const keyId = insertKey({ tokenHash: hash });
    await apiAuth.validateApiKey(`Bearer ${token}`);
    const row = sqlite
      .prepare('select last_used_at from api_keys where id = ?')
      .get(keyId) as { last_used_at: string | null };
    expect(row.last_used_at).not.toBeNull();
  });

  it('rejects a missing or malformed Authorization header', async () => {
    expect(await apiAuth.validateApiKey(null)).toBeNull();
    expect(await apiAuth.validateApiKey('Basic abc')).toBeNull();
    expect(await apiAuth.validateApiKey('Bearer not_a_pat_token')).toBeNull();
  });

  it('rejects an unknown token', async () => {
    const { token } = apiAuth.generateApiKey(); // never stored
    expect(await apiAuth.validateApiKey(`Bearer ${token}`)).toBeNull();
  });

  it('rejects a revoked key', async () => {
    const { token, hash } = apiAuth.generateApiKey();
    insertKey({ tokenHash: hash, revokedAt: T });
    expect(await apiAuth.validateApiKey(`Bearer ${token}`)).toBeNull();
  });

  it('rejects an expired key', async () => {
    const { token, hash } = apiAuth.generateApiKey();
    insertKey({ tokenHash: hash, expiresAt: PAST });
    expect(await apiAuth.validateApiKey(`Bearer ${token}`)).toBeNull();
  });

  it('accepts a key with a future expiry', async () => {
    const { token, hash } = apiAuth.generateApiKey();
    insertKey({ tokenHash: hash, expiresAt: FUTURE });
    expect(await apiAuth.validateApiKey(`Bearer ${token}`)).not.toBeNull();
  });
});

describe('hasScope', () => {
  const ctx = (scopes: string[]) => ({ userId: USER_ID, scopes, keyId: 'k' });

  it('matches an exact scope', () => {
    expect(apiAuth.hasScope(ctx(['read:medications']), 'read:medications')).toBe(true);
  });

  it('read:all grants any read scope but no write scope', () => {
    expect(apiAuth.hasScope(ctx(['read:all']), 'read:labs')).toBe(true);
    expect(apiAuth.hasScope(ctx(['read:all']), 'write:labs')).toBe(false);
  });

  it('write:all grants any write scope but no read scope', () => {
    expect(apiAuth.hasScope(ctx(['write:all']), 'write:vitals')).toBe(true);
    expect(apiAuth.hasScope(ctx(['write:all']), 'read:vitals')).toBe(false);
  });

  it('denies a missing scope', () => {
    expect(apiAuth.hasScope(ctx(['read:medications']), 'read:labs')).toBe(false);
  });
});

describe('responses', () => {
  it('unauthorized() is a 401 JSON response', async () => {
    const res = apiAuth.unauthorized();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid or missing API key' });
  });

  it('forbidden() is a 403 JSON response naming the scope', async () => {
    const res = apiAuth.forbidden('read:labs');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('read:labs');
  });
});
