// @vitest-environment node
/**
 * Optional-feature gating (Task 6.1): AI and Oura routes return 501 with a
 * clear message when the instance lacks the relevant env vars — but only
 * AFTER authentication, so unauthenticated callers can't probe config.
 * GET /api/capabilities is unauthenticated and returns booleans only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {
    readonly status = 401;
  }
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!authState.userId) throw new UnauthorizedError();
      return { id: authState.userId, email: `${authState.userId}@example.com` };
    },
    getUser: async () => (authState.userId ? { id: authState.userId } : null),
  };
});

const ENV_KEYS = [
  'DATA_DIR',
  'ANTHROPIC_API_KEY',
  'OURA_CLIENT_ID',
  'OURA_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SIGNUPS_ENABLED',
] as const;

const AI_MSG = 'AI features not configured. Set ANTHROPIC_API_KEY.';
const OURA_MSG =
  'Oura integration not configured. Set OURA_CLIENT_ID and OURA_CLIENT_SECRET.';

let saved: Record<string, string | undefined>;
let tmpDir: string;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healthtrack-gating-'));
  process.env.DATA_DIR = tmpDir;
  authState.userId = 'gating-test-user-000000000000000';
  vi.resetModules();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function jsonPost(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formPost(url: string) {
  const form = new FormData();
  form.append('file', new File([Uint8Array.from([1])], 'x.pdf', { type: 'application/pdf' }));
  return new NextRequest(`http://localhost${url}`, { method: 'POST', body: form });
}

async function expect501(res: Response, message: string) {
  expect(res.status).toBe(501);
  const body = (await res.json()) as { error: string; message?: string };
  expect(body.error).toBe(message);
  expect(body.message).toBe(message);
}

describe('AI routes return 501 without ANTHROPIC_API_KEY', () => {
  it('GET /api/health-summary', async () => {
    const { GET } = await import('@/app/api/health-summary/route');
    await expect501(await GET(new NextRequest('http://localhost/api/health-summary')), AI_MSG);
  });

  it('POST /api/health-query', async () => {
    const { POST } = await import('@/app/api/health-query/route');
    await expect501(await POST(jsonPost('/api/health-query', { query: 'hi' })), AI_MSG);
  });

  it('POST /api/check-interactions', async () => {
    const { POST } = await import('@/app/api/check-interactions/route');
    await expect501(await POST(jsonPost('/api/check-interactions', {})), AI_MSG);
  });

  it('POST /api/parse-lab-pdf', async () => {
    const { POST } = await import('@/app/api/parse-lab-pdf/route');
    await expect501(await POST(formPost('/api/parse-lab-pdf')), AI_MSG);
  });

  it('POST /api/parse-vaccine-pdf', async () => {
    const { POST } = await import('@/app/api/parse-vaccine-pdf/route');
    await expect501(await POST(formPost('/api/parse-vaccine-pdf')), AI_MSG);
  });

  it('auth still comes first: unauthenticated callers get 401, not 501', async () => {
    authState.userId = null;
    const { GET } = await import('@/app/api/health-summary/route');
    expect((await GET(new NextRequest('http://localhost/api/health-summary'))).status).toBe(401);
  });
});

describe('Oura routes return 501 without OURA_CLIENT_ID/SECRET', () => {
  it('POST /api/sync-oura', async () => {
    const { POST } = await import('@/app/api/sync-oura/route');
    await expect501(await POST(), OURA_MSG);
  });

  it('GET /api/oura/status', async () => {
    const { GET } = await import('@/app/api/oura/status/route');
    await expect501(await GET(), OURA_MSG);
  });

  it('POST /api/oura/disconnect', async () => {
    const { POST } = await import('@/app/api/oura/disconnect/route');
    await expect501(await POST(), OURA_MSG);
  });

  it('GET /api/oura/start redirects to settings with config_error (navigation route)', async () => {
    const { GET } = await import('@/app/api/oura/start/route');
    const res = await GET(new NextRequest('http://localhost/api/oura/start'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/settings');
    expect(location).toContain('config_error');
  });
});

describe('GET /api/capabilities', () => {
  it('needs no session and returns exactly the four booleans', async () => {
    authState.userId = null;
    process.env.OURA_CLIENT_ID = 'id';
    process.env.OURA_CLIENT_SECRET = 'secret';
    const { GET } = await import('@/app/api/capabilities/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ai: false,
      googleAuth: false,
      oura: true,
      // Unset SIGNUPS_ENABLED → invite-only default, so "open signups" is
      // false (true only with an explicit SIGNUPS_ENABLED=true).
      signupsEnabled: false,
    });
  });
});
