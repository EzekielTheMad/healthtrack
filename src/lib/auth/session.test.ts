// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Better Auth signup runs scrypt password hashing; under full-suite parallel
// workers this can exceed vitest's 5s default on slower machines.
vi.setConfig({ testTimeout: 30_000 });
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * getUser()/requireUser() App Router helpers (Task 2.2).
 *
 * `next/headers` is request-scoped; we mock it to feed the cookie captured
 * from a real better-auth sign-up, so the session lookup path is exercised
 * end-to-end against SQLite.
 */

let tmpDir: string;
let savedDataDir: string | undefined;
let currentCookie = '';

vi.mock('next/headers', () => ({
  headers: async () => new Headers(currentCookie ? { cookie: currentCookie } : {}),
}));

async function load() {
  vi.resetModules();
  const { runMigrations } = await import('@/db/migrate');
  runMigrations();
  const { auth } = await import('./index');
  const sessionModule = await import('./session');
  return { auth, ...sessionModule };
}

beforeEach(() => {
  savedDataDir = process.env.DATA_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-session-'));
  process.env.DATA_DIR = tmpDir;
  currentCookie = '';
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

describe('session helpers', () => {
  it('getUser returns the signed-in user', async () => {
    const { auth, getUser } = await load();
    const { headers } = await auth.api.signUpEmail({
      body: { name: 'Alice', email: 'alice@example.com', password: 'password123' },
      returnHeaders: true,
    });
    currentCookie = headers.get('set-cookie')!.split(';')[0];

    const user = await getUser();
    expect(user).not.toBeNull();
    expect(user!.email).toBe('alice@example.com');
    expect(user!.id).toBeTruthy();
  });

  it('getUser returns null without a session', async () => {
    const { getUser } = await load();
    expect(await getUser()).toBeNull();
  });

  it('getUser returns null for a garbage cookie', async () => {
    const { getUser } = await load();
    currentCookie = 'better-auth.session_token=not-a-real-token';
    expect(await getUser()).toBeNull();
  });

  it('requireUser returns the user when signed in', async () => {
    const { auth, requireUser } = await load();
    const { headers } = await auth.api.signUpEmail({
      body: { name: 'Bob', email: 'bob@example.com', password: 'password123' },
      returnHeaders: true,
    });
    currentCookie = headers.get('set-cookie')!.split(';')[0];
    const user = await requireUser();
    expect(user.email).toBe('bob@example.com');
  });

  it('requireUser throws UnauthorizedError (status 401) without a session', async () => {
    const { requireUser, UnauthorizedError } = await load();
    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });
});
