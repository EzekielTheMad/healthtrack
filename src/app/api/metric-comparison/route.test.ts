// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

const { authState } = vi.hoisted(() => ({ authState: { userId: null as string | null } }));
vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {
    readonly status = 401;
  }
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!authState.userId) throw new UnauthorizedError();
      return { id: authState.userId };
    },
  };
});
let ctx: RepoTestDb;
let route: typeof import('./route');
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-api-comparison-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  authState.userId = OWNER;
  route = await import('./route');
});
afterEach(() => {
  authState.userId = null;
  ctx.restore();
});
function get(query = '') {
  return route.GET(new NextRequest(`http://localhost/api/metric-comparison${query}`));
}

describe('GET /api/metric-comparison', () => {
  it('requires authentication and prevents cross-owner probes', async () => {
    authState.userId = null;
    expect((await get()).status).toBe(401);
    authState.userId = STRANGER;
    expect((await get(`?owner_id=${OWNER}`)).status).toBe(404);
    expect((await get('?dependent_id=not-owned')).status).toBe(404);
  });
  it.each([
    '?days=365',
    '?days=30x',
    '?days=0',
    '?days=',
    '?days=30&days=90',
    '?dependent_id=all',
    '?dependent_id=',
    '?owner_id=',
    '?owner_id=x&dependent_id=y',
    '?owner_id=x&owner_id=y',
  ])('rejects invalid or mixed-person requests: %s', async (query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('returns the bounded snake_case contract and disallows caching', async () => {
    const response = await get('?days=90');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      days: 90,
      metrics: [],
      unavailable_domains: [],
      warnings: [],
    });
  });
});
