// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Better Auth signup runs scrypt password hashing; under full-suite parallel
// workers this can exceed vitest's 5s default on slower machines.
vi.setConfig({ testTimeout: 30_000 });
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Account deletion (Task 2.4) — replaces the delete_own_account RPC.
 *
 * Contract:
 * - user row deleted; FK cascades wipe domain rows and sessions
 * - dependents.transitioned_to referencing the deleted user is nulled FIRST
 *   (the FK has no delete action and would otherwise block the delete),
 *   including rows owned by OTHER users
 * - the user's uploads directory is removed (ok if it never existed)
 * - other users' data is untouched
 */

let tmpDir: string;
let savedDataDir: string | undefined;

async function load() {
  vi.resetModules();
  const { runMigrations } = await import('@/db/migrate');
  runMigrations();
  const { auth } = await import('./index');
  const { deleteAccount } = await import('./delete-account');
  const { getSqlite } = await import('@/db');
  const { getUploadsDir } = await import('@/lib/runtime/paths');
  return { auth, deleteAccount, sqlite: getSqlite(), uploadsDir: getUploadsDir() };
}

type LoadedAuth = Awaited<ReturnType<typeof load>>['auth'];

async function signUp(auth: LoadedAuth, email: string) {
  const res = await auth.api.signUpEmail({
    body: { name: email.split('@')[0], email, password: 'password123' },
  });
  return res.user.id;
}

beforeEach(() => {
  savedDataDir = process.env.DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-del-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // WAL handles on Windows may lag
  }
});

describe('deleteAccount', () => {
  it('removes the user, their domain rows, sessions, and upload dir', async () => {
    const { auth, deleteAccount, sqlite, uploadsDir } = await load();
    const userId = await signUp(auth, 'doomed@example.com');

    sqlite
      .prepare(
        "insert into medications (id, user_id, name, created_at, updated_at) values ('m1', ?, 'Aspirin', '2026-01-01', '2026-01-01')",
      )
      .run(userId);
    const userUploads = path.join(uploadsDir, userId);
    fs.mkdirSync(userUploads, { recursive: true });
    fs.writeFileSync(path.join(userUploads, 'lab.pdf'), 'fake pdf');

    await deleteAccount(userId);

    expect(sqlite.prepare('select 1 from user where id=?').get(userId)).toBeUndefined();
    expect(
      sqlite.prepare('select 1 from medications where user_id=?').get(userId),
    ).toBeUndefined();
    expect(
      sqlite.prepare('select 1 from session where userId=?').get(userId),
    ).toBeUndefined();
    expect(
      sqlite.prepare('select 1 from account where userId=?').get(userId),
    ).toBeUndefined();
    expect(fs.existsSync(userUploads)).toBe(false);
  });

  it('nulls dependents.transitioned_to in any owner rows before deleting', async () => {
    const { auth, deleteAccount, sqlite } = await load();
    const ownerId = await signUp(auth, 'owner@example.com');
    const doomedId = await signUp(auth, 'transitioned@example.com');

    // owner's dependent record transitioned to the account being deleted
    sqlite
      .prepare(
        "insert into dependents (id, parent_user_id, name, date_of_birth, relationship, transitioned, transitioned_to, created_at, updated_at) values ('d1', ?, 'Kid', '2008-01-01', 'child', 1, ?, '2026-01-01', '2026-01-01')",
      )
      .run(ownerId, doomedId);

    await deleteAccount(doomedId);

    const dep = sqlite
      .prepare('select transitioned_to from dependents where id=?')
      .get('d1') as { transitioned_to: string | null };
    expect(dep.transitioned_to).toBeNull();
    expect(sqlite.prepare('select 1 from user where id=?').get(doomedId)).toBeUndefined();
  });

  it('leaves other users data untouched and tolerates a missing upload dir', async () => {
    const { auth, deleteAccount, sqlite } = await load();
    const keeperId = await signUp(auth, 'keeper@example.com');
    const doomedId = await signUp(auth, 'gone@example.com');

    sqlite
      .prepare(
        "insert into medications (id, user_id, name, created_at, updated_at) values ('mk', ?, 'Metformin', '2026-01-01', '2026-01-01')",
      )
      .run(keeperId);

    // no uploads dir created for doomed user — must not throw
    await deleteAccount(doomedId);

    expect(sqlite.prepare('select 1 from user where id=?').get(keeperId)).toBeDefined();
    expect(sqlite.prepare('select 1 from medications where id=?').get('mk')).toBeDefined();
  });

  it('throws for an unknown user id', async () => {
    const { deleteAccount } = await load();
    await expect(deleteAccount('no-such-user')).rejects.toThrow(/not found/i);
  });
});
