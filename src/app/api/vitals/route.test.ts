// @vitest-environment node
/**
 * /api/vitals (session-authenticated) — pins that the session write path
 * enforces the same registry validation as the v1 ingest API (spec §2:
 * "session /api/vitals POST continues to work and gains the same registry
 * validation"): closed registry, ordinal label stamping, canonical units,
 * day-normalized recorded_at.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

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

type RouteModule = typeof import('./route');

let ctx: RepoTestDb;
let route: RouteModule;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-vitals-');
  route = await import('./route');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/vitals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/vitals — registry validation (session path)', () => {
  it('400 for a registry-unknown metric key', async () => {
    const res = await route.POST(
      post({
        metric_key: 'quantum_flux',
        value: 1,
        source: 'manual',
        recorded_at: '2026-07-08T10:00:00Z',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('quantum_flux');
    expect(body.message).toContain('/docs/api');
  });

  it('400 for a non-canonical unit', async () => {
    const res = await route.POST(
      post({
        metric_key: 'steps',
        value: 5000,
        unit: 'km',
        source: 'manual',
        recorded_at: '2026-07-08T10:00:00Z',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain('steps');
  });

  it('201 for a valid record; recorded_at is day-normalized', async () => {
    const res = await route.POST(
      post({
        metric_key: 'resting_hr',
        value: 58,
        unit: 'bpm',
        source: 'manual',
        recorded_at: '2026-07-08T10:23:00Z',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user_id).toBe(OWNER);
    expect(body.recorded_at).toBe('2026-07-08T00:00:00Z');
  });

  it('201 for an ordinal value; metadata.label is stamped', async () => {
    const res = await route.POST(
      post({
        metric_key: 'mood',
        value: 4,
        source: 'manual',
        recorded_at: '2026-07-08T10:23:00Z',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.value).toBe(4);
    expect(body.metadata.label).toBe('good');
  });

  it('401 without a session', async () => {
    authState.userId = null;
    const res = await route.POST(
      post({
        metric_key: 'steps',
        value: 100,
        source: 'manual',
        recorded_at: '2026-07-08',
      }),
    );
    expect(res.status).toBe(401);
  });
});
