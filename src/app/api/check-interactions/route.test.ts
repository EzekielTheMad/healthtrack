// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { Medication } from '@/lib/types';

const state = vi.hoisted(() => ({
  userId: null as string | null,
  ai: true,
  allowed: true,
  check: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!state.userId) throw new UnauthorizedError();
      return { id: state.userId };
    },
  };
});
vi.mock('@/lib/capabilities', () => ({
  AI_NOT_CONFIGURED: 'AI unavailable',
  getCapabilities: () => ({ ai: state.ai }),
}));
vi.mock('@/lib/api/rate-limit', () => ({ HOUR_MS: 3600000, checkRateLimit: () => state.allowed }));
vi.mock('@/lib/claude/check-interactions', () => ({ checkMedicationInteractions: state.check }));
let ctx: RepoTestDb;
let route: typeof import('./route');
let reads: typeof import('../interaction-alerts/route');
let alerts: typeof import('@/lib/repos/interaction-alerts');
let child: string;
let sibling: string;
let foreign: string;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-interaction-route-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  child = crypto.randomUUID();
  sibling = crypto.randomUUID();
  foreign = crypto.randomUUID();
  insertDependent(ctx.sqlite, child, OWNER);
  insertDependent(ctx.sqlite, sibling, OWNER);
  insertDependent(ctx.sqlite, foreign, VIEWER);
  route = await import('./route');
  reads = await import('../interaction-alerts/route');
  alerts = await import('@/lib/repos/interaction-alerts');
  state.userId = OWNER;
  state.ai = true;
  state.allowed = true;
  state.check.mockReset().mockResolvedValue({ has_interactions: false, alerts: [] });
});
afterEach(() => ctx.restore());
function med(name: string, dependentId: string | null = null, active = true, userId = OWNER) {
  const id = crypto.randomUUID();
  ctx.sqlite
    .prepare(
      `insert into medications (id, user_id, name, active, dependent_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, name, active ? 1 : 0, dependentId, '2026-10-10', '2026-10-10');
  return id;
}
function post(body: unknown) {
  return route.POST(
    new NextRequest('http://localhost/api/check-interactions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );
}
function get(dependentId: string | null = null) {
  return reads.GET(
    new NextRequest(
      `http://localhost/api/interaction-alerts${dependentId === null ? '' : `?dependent_id=${dependentId}`}`
    )
  );
}
function detected(names: string[]) {
  state.check.mockResolvedValue({
    has_interactions: true,
    alerts: [{ medication_names: names, alert_text: 'Synthetic concern.', severity: 'warning' }],
  });
}

describe('exact-person interaction checks', () => {
  it('legacy missing scope means self only, never all family medication lists', async () => {
    med('Owner A');
    med('Owner B');
    med('Child A', child);
    med('Sibling A', sibling);
    med('Inactive', null, false);
    med('Other owner', null, true, VIEWER);
    expect((await post({})).status).toBe(200);
    expect(state.check.mock.calls[0][0].map((m: Medication) => m.name).sort()).toEqual([
      'Owner A',
      'Owner B',
    ]);
  });
  it('checks exactly the selected dependent and persists only that dependent status/alerts', async () => {
    med('Owner A');
    med('Sibling A', sibling);
    med('Child A', child);
    const trigger = med('Child B', child);
    detected(['Child A', 'Child B']);
    expect((await post({ dependent_id: child, trigger_id: trigger })).status).toBe(200);
    expect(state.check.mock.calls[0][0].map((m: Medication) => m.name).sort()).toEqual([
      'Child A',
      'Child B',
    ]);
    expect(state.check.mock.calls[0][1]).toEqual({ ownerId: OWNER, dependentId: child });
    const payload = await (await get(child)).json();
    expect(payload.alerts).toHaveLength(1);
    expect(payload.alerts[0]).toMatchObject({
      dependent_id: child,
      trigger_medication_id: trigger,
    });
    expect(payload.status.has_interactions).toBe(true);
    expect((await (await get()).json()).status).toBeNull();
    expect((await (await get(sibling)).json()).alerts).toEqual([]);
  });
  it('identical drug names and snoozes stay isolated across profiles', async () => {
    const ownA = med('A');
    med('B');
    const childA = med('A', child);
    med('B', child);
    detected(['A', 'B']);
    await post({ dependent_id: null, trigger_id: ownA });
    const own = await (await get()).json();
    await alerts.snoozeInteractionAlert(OWNER, own.alerts[0].id, 7);
    await post({ dependent_id: child, trigger_id: childA });
    expect((await (await get(child)).json()).alerts).toHaveLength(1);
    expect((await (await get()).json()).snoozed_count).toBe(1);
    state.check.mockResolvedValue({ has_interactions: false, alerts: [] });
    await post({ dependent_id: child });
    expect((await (await get(child)).json()).alerts).toEqual([]);
    expect((await (await get()).json()).snoozed_count).toBe(1);
  });
  it('rejects unknown and foreign dependent IDs without calling AI or writing a check', async () => {
    for (const dependent_id of [foreign, crypto.randomUUID()]) {
      expect((await post({ dependent_id })).status).toBe(404);
    }
    expect(state.check).not.toHaveBeenCalled();
    expect(ctx.sqlite.prepare('select * from interaction_checks').all()).toEqual([]);
  });
  it('rejects unsupported delegate/owner contexts instead of silently checking the actor', async () => {
    for (const body of [{ delegate_owner_id: VIEWER }, { owner_id: VIEWER }]) {
      expect((await post(body)).status).toBe(403);
    }
    expect(state.check).not.toHaveBeenCalled();
  });
  it.each([
    { dependent_id: 'all' },
    { dependent_id: '' },
    { dependent_id: 1 },
    { dependent_id: [] },
    null,
    [],
    { unknown_scope: 'child' },
  ])('fails closed for invalid context %j', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(state.check).not.toHaveBeenCalled();
  });
  it('rejects cross-profile trigger and medication hints, including inactive IDs', async () => {
    const other = med('Child A', child);
    const inactive = med('Inactive', null, false);
    for (const body of [
      { trigger_id: other },
      { medication_ids: [other] },
      { trigger_id: inactive },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(state.check).not.toHaveBeenCalled();
  });
  it('keeps stored results on model failure and does not expose raw error details', async () => {
    const a = med('A');
    med('B');
    detected(['A', 'B']);
    await post({ trigger_id: a });
    state.check.mockRejectedValue(new Error('private synthetic detail'));
    const response = await post({});
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private synthetic detail');
    expect((await (await get()).json()).alerts).toHaveLength(1);
  });
  it('rejects malformed JSON, requires auth before capabilities, and preserves rate/AI gates', async () => {
    expect(
      (
        await route.POST(
          new NextRequest('http://localhost/api/check-interactions', { method: 'POST', body: '{' })
        )
      ).status
    ).toBe(400);
    state.ai = false;
    state.userId = null;
    expect((await post({})).status).toBe(401);
    state.userId = OWNER;
    expect((await post({})).status).toBe(501);
    state.ai = true;
    state.allowed = false;
    expect((await post({})).status).toBe(429);
    expect(state.check).not.toHaveBeenCalled();
  });
  it('rejects all-family GET and unknown/foreign dependent status scopes', async () => {
    expect((await get('all')).status).toBe(400);
    expect((await get(foreign)).status).toBe(404);
    expect((await get(crypto.randomUUID())).status).toBe(404);
  });
});
