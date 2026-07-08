// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Better Auth signup runs scrypt password hashing; under full-suite parallel
// workers this can exceed vitest's 5s default on slower machines.
vi.setConfig({ testTimeout: 30_000 });
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Better Auth server config tests (Task 2.1).
 *
 * Each test gets a fresh temp DATA_DIR + module graph (vi.resetModules) so the
 * lazy db proxy and the auth singleton bind to a clean SQLite file.
 */

let tmpDir: string;
let savedEnv: Record<string, string | undefined>;

const ENV_KEYS = ['DATA_DIR', 'SIGNUPS_ENABLED', 'APP_URL', 'AUTH_SECRET'] as const;

async function loadAuth() {
  vi.resetModules();
  const { runMigrations } = await import('@/db/migrate');
  runMigrations();
  const { auth } = await import('./index');
  return auth;
}

function cookieFrom(headers: Headers): string {
  const setCookie = headers.get('set-cookie');
  expect(setCookie, 'expected a set-cookie header').toBeTruthy();
  // first cookie pair only (name=value)
  return setCookie!.split(';')[0];
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-auth-'));
  process.env.DATA_DIR = tmpDir;
  delete process.env.SIGNUPS_ENABLED;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // WAL handles on Windows may lag; temp dir is cleaned by the OS
  }
});

describe('better auth server config', () => {
  it('signs up a user with email/password and establishes a session', async () => {
    const auth = await loadAuth();
    const { headers } = await auth.api.signUpEmail({
      body: { name: 'Alice', email: 'alice@example.com', password: 'password123' },
      returnHeaders: true,
    });
    const cookie = cookieFrom(headers);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session).not.toBeNull();
    expect(session!.user.email).toBe('alice@example.com');
  });

  it('makes the first registered user admin, subsequent users get role user', async () => {
    const auth = await loadAuth();
    await auth.api.signUpEmail({
      body: { name: 'First', email: 'first@example.com', password: 'password123' },
    });
    await auth.api.signUpEmail({
      body: { name: 'Second', email: 'second@example.com', password: 'password123' },
    });
    const { getSqlite } = await import('@/db');
    const rows = getSqlite()
      .prepare('select email, role from user order by createdAt, email')
      .all() as { email: string; role: string }[];
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.role]));
    expect(byEmail['first@example.com']).toBe('admin');
    expect(byEmail['second@example.com']).toBe('user');
  });

  it('a signup request cannot set its own role', async () => {
    const auth = await loadAuth();
    await auth.api.signUpEmail({
      body: { name: 'Root', email: 'root@example.com', password: 'password123' },
    });
    await auth.api.signUpEmail({
      // role is not an input field; a malicious extra field must not stick
      body: {
        name: 'Evil',
        email: 'evil@example.com',
        password: 'password123',
        role: 'admin',
      } as never,
    });
    const { getSqlite } = await import('@/db');
    const row = getSqlite()
      .prepare("select role from user where email='evil@example.com'")
      .get() as { role: string };
    expect(row.role).toBe('user');
  });

  it('blocks signup when SIGNUPS_ENABLED=false, but login still works', async () => {
    // First create a user while signups are open
    let auth = await loadAuth();
    await auth.api.signUpEmail({
      body: { name: 'Owner', email: 'owner@example.com', password: 'password123' },
    });

    process.env.SIGNUPS_ENABLED = 'false';
    auth = await loadAuth();

    await expect(
      auth.api.signUpEmail({
        body: { name: 'Late', email: 'late@example.com', password: 'password123' },
      }),
    ).rejects.toMatchObject({ status: expect.stringMatching(/FORBIDDEN|BAD_REQUEST/) });

    const { headers } = await auth.api.signInEmail({
      body: { email: 'owner@example.com', password: 'password123' },
      returnHeaders: true,
    });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieFrom(headers) }),
    });
    expect(session?.user.email).toBe('owner@example.com');
  });

  it('does not register the google provider when env vars are absent', async () => {
    const auth = await loadAuth();
    expect(auth.options.socialProviders?.google).toBeUndefined();
  });
});
