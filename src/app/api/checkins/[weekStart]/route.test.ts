// @vitest-environment node
/**
 * /api/checkins/{weekStart} (session-authenticated) — the Weekly tab's
 * check-in seam: PUT full-replacement upsert with neck/waist vitals
 * write-through, Monday validation, 401/404 guards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
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

const MONDAY = '2026-07-06';

let ctx: RepoTestDb;
let route: RouteModule;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-checkins-');
  route = await import('./route');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
});

afterEach(() => {
  authState.userId = null;
  ctx.restore();
});

function get(weekStart: string, query = '') {
  const request = new NextRequest(`http://localhost/api/checkins/${weekStart}${query}`);
  return route.GET(request, { params: Promise.resolve({ weekStart }) });
}

function put(weekStart: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/checkins/${weekStart}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return route.PUT(request, { params: Promise.resolve({ weekStart }) });
}

describe('PUT /api/checkins/{weekStart}', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await put(MONDAY, {});
    expect(res.status).toBe(401);
  });

  it('400s a non-Monday week key', async () => {
    const res = await put('2026-07-07', { working: 'x' });
    expect(res.status).toBe(400);
  });

  it('upserts with full-replacement semantics and writes neck/waist to vitals', async () => {
    const first = await put(MONDAY, {
      working: 'progressive overload',
      days_logged: 6,
      avg_calories: 2200,
      neck_in: 16.5,
      waist_in: 40.25,
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      week_start: MONDAY,
      working: 'progressive overload',
      days_logged: 6,
      avg_calories: 2200,
    });

    // neck/waist land in vitals, never on the check-in row.
    const metrics = ctx.sqlite
      .prepare('select metric_key, value, source from vitals order by metric_key')
      .all() as Array<{ metric_key: string; value: number; source: string }>;
    expect(metrics).toEqual([
      { metric_key: 'neck', value: 16.5, source: 'manual' },
      { metric_key: 'waist', value: 40.25, source: 'manual' },
    ]);

    // PUT again with fields omitted — they clear to null (full replacement).
    const second = await put(MONDAY, { working: 'still lifting' });
    expect(await second.json()).toMatchObject({
      working: 'still lifting',
      days_logged: null,
      avg_calories: null,
    });
  });
});

describe('GET /api/checkins/{weekStart}', () => {
  it('401 without a session', async () => {
    authState.userId = null;
    const res = await get(MONDAY);
    expect(res.status).toBe(401);
  });

  it('404 when no check-in exists yet', async () => {
    const res = await get(MONDAY);
    expect(res.status).toBe(404);
  });

  it('serves the row snake_cased once written', async () => {
    await put(MONDAY, { not_working: 'sleep' });
    const res = await get(MONDAY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ week_start: MONDAY, not_working: 'sleep' });
  });

  it('404s a stranger probing another owner via ?owner_id=', async () => {
    await put(MONDAY, { working: 'x' });
    insertUser(ctx.sqlite, STRANGER);
    authState.userId = STRANGER;
    const res = await get(MONDAY, `?owner_id=${OWNER}`);
    expect(res.status).toBe(404);
  });
});
