/**
 * Shared harness for repository tests (not itself a test file).
 *
 * Pattern (same as src/db/migrate.test.ts / src/lib/authz/authz.test.ts):
 * temp DATA_DIR per test, vi.resetModules(), dynamic import of the module
 * under test, raw better-sqlite3 seeding.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { vi } from 'vitest';
import type Database from 'better-sqlite3';

export const NOW = Date.now();
export const T = new Date(NOW).toISOString();
export const PAST = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
export const FUTURE = new Date(NOW + 24 * 60 * 60 * 1000).toISOString();

// Better-auth ids are 32-char strings, not UUIDs
export const OWNER = 'owner-user-000000000000000000000';
export const VIEWER = 'viewer-user-00000000000000000000';
export const STRANGER = 'stranger-user-000000000000000000';

export interface RepoTestDb {
  sqlite: Database.Database;
  tmpDir: string;
  restore(): void;
}

export async function setupRepoDb(prefix: string): Promise<RepoTestDb> {
  const savedDataDir = process.env.DATA_DIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  process.env.DATA_DIR = tmpDir;
  vi.resetModules();
  const [{ runMigrations }, dbMod] = await Promise.all([
    import('@/db/migrate'),
    import('@/db'),
  ]);
  runMigrations();
  const sqlite = dbMod.getSqlite();
  return {
    sqlite,
    tmpDir,
    restore() {
      if (savedDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = savedDataDir;
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // WAL handles on Windows may lag; temp dir is cleaned by the OS
      }
    },
  };
}

/**
 * Mint a personal access token for v1 API contract tests. Token format and
 * sha256-hex hashing mirror src/lib/api-auth.ts generateApiKey/hashToken
 * (that contract is pinned by the vitals write tests); generating here keeps
 * the harness free of module-load-order coupling with api-auth.
 */
export function mintApiToken(
  sqlite: Database.Database,
  userId: string,
  scopes: string[],
): string {
  const token = `ohts_pat_${crypto.randomBytes(36).toString('base64url')}`;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  sqlite
    .prepare(
      `insert into api_keys (id, user_id, name, token_hash, prefix, scopes, created_at)
       values (?, ?, 'test key', ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      userId,
      hash,
      token.slice(0, 16),
      JSON.stringify(scopes),
      new Date().toISOString(),
    );
  return token;
}

export function insertUser(sqlite: Database.Database, id: string, email?: string) {
  sqlite
    .prepare(
      `insert into user (id, name, email, emailVerified, role, createdAt, updatedAt)
       values (?, ?, ?, 0, 'user', ?, ?)`,
    )
    .run(id, id, email ?? `${id.slice(0, 8)}@example.com`, NOW, NOW);
}

export function insertDependent(
  sqlite: Database.Database,
  id: string,
  parentUserId: string,
) {
  sqlite
    .prepare(
      `insert into dependents
         (id, parent_user_id, name, date_of_birth, relationship, transition_age, transitioned, created_at, updated_at)
       values (?, ?, 'Dep', '2015-01-01', 'child', 18, 0, ?, ?)`,
    )
    .run(id, parentUserId, T, T);
}

export function insertShare(
  sqlite: Database.Database,
  opts: {
    ownerId: string;
    sharedWithId: string | null;
    sections: string[];
    accepted?: boolean;
    expiresAt?: string | null;
    dependentId?: string | null;
  },
) {
  sqlite
    .prepare(
      `insert into health_shares
         (id, owner_id, shared_with_email, shared_with_id, access_level,
          shared_sections, share_token, accepted, expires_at, dependent_id, created_at)
       values (?, ?, 'viewer@example.com', ?, 'read', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      opts.ownerId,
      opts.sharedWithId,
      JSON.stringify(opts.sections),
      crypto.randomUUID(),
      opts.accepted === false ? 0 : 1,
      opts.expiresAt ?? null,
      opts.dependentId ?? null,
      T,
    );
}

export function insertDelegate(
  sqlite: Database.Database,
  opts: {
    ownerId: string;
    delegateUserId: string | null;
    permissionLevel?: 'read_only' | 'read_write' | 'admin';
    status?: 'pending' | 'accepted' | 'rejected';
    expiresAt?: string | null;
  },
) {
  sqlite
    .prepare(
      `insert into delegates
         (id, owner_id, delegate_user_id, delegate_email, permission_level,
          status, invited_at, accepted_at, expires_at, created_at, updated_at)
       values (?, ?, ?, 'viewer@example.com', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      opts.ownerId,
      opts.delegateUserId,
      opts.permissionLevel ?? 'read_only',
      opts.status ?? 'accepted',
      T,
      opts.status === 'accepted' || opts.status === undefined ? T : null,
      opts.expiresAt ?? null,
      T,
      T,
    );
}
