// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

const state = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {
    readonly status = 401;
  }
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!state.userId) throw new UnauthorizedError();
      return { id: state.userId };
    },
  };
});
let ctx: RepoTestDb;
let route: typeof import('./route');
const request = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/vital-source-preferences', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-source-preferences-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  route = await import('./route');
  state.userId = OWNER;
});
afterEach(() => {
  state.userId = null;
  ctx.restore();
});

describe('source preference session API', () => {
  it('persists and resets a source choice while isolating accounts', async () => {
    expect(
      (await route.PATCH(request('PATCH', { metric_key: 'weight', preferred_source: 'scale-a' })))
        .status
    ).toBe(200);
    expect(await (await route.GET()).json()).toEqual({ weight: 'scale-a' });
    state.userId = VIEWER;
    expect(await (await route.GET()).json()).toEqual({});
    await route.DELETE(request('DELETE', { metric_key: 'weight' }));
    state.userId = OWNER;
    expect(await (await route.GET()).json()).toEqual({ weight: 'scale-a' });
    await route.DELETE(request('DELETE', { metric_key: 'weight' }));
    expect(await (await route.GET()).json()).toEqual({});
  });
  it('requires a session and rejects owner injection or unknown metrics', async () => {
    expect(
      (
        await route.PATCH(
          request('PATCH', { metric_key: 'weight', preferred_source: 'scale', user_id: VIEWER })
        )
      ).status
    ).toBe(400);
    expect(
      (await route.PATCH(request('PATCH', { metric_key: 'imaginary', preferred_source: 'scale' })))
        .status
    ).toBe(400);
    state.userId = null;
    expect((await route.GET()).status).toBe(401);
    expect(
      (await route.PATCH(request('PATCH', { metric_key: 'weight', preferred_source: 'scale' })))
        .status
    ).toBe(401);
  });
});
