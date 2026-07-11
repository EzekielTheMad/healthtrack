// @vitest-environment node
/**
 * v1 goals endpoints — GET/POST /api/v1/goals, PATCH /api/v1/goals/{id}.
 *
 * Covers the PAT auth matrix, both goal kinds, the closed metric registry
 * (400), the at-most-one-active rule (409 with existing_id, on create and on
 * re-activate), kind immutability (400), and list filters.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  mintApiToken,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

type CollectionRoute = typeof import('./route');
type ItemRoute = typeof import('./[id]/route');

let ctx: RepoTestDb;
let collection: CollectionRoute;
let item: ItemRoute;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-goals-');
  [collection, item] = await Promise.all([import('./route'), import('./[id]/route')]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

function req(url: string, token: string | null, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined
      ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
      : {}),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const METRIC_GOAL = {
  kind: 'metric',
  metric_key: 'weight',
  direction: 'decrease',
  target_value: 199,
  target_date: '2026-12-31',
};
const FREQ_GOAL = { kind: 'frequency', session_type: 'strength', per_week: 3 };

describe('auth matrix', () => {
  it('401 / 403 across list, create and patch', async () => {
    expect((await collection.GET(req('/api/v1/goals', null))).status).toBe(401);
    const readVitals = mintApiToken(ctx.sqlite, OWNER, ['read:vitals']);
    expect((await collection.GET(req('/api/v1/goals', readVitals))).status).toBe(403);
    const readFitness = mintApiToken(ctx.sqlite, OWNER, ['read:fitness']);
    expect(
      (await collection.POST(req('/api/v1/goals', readFitness, 'POST', METRIC_GOAL))).status,
    ).toBe(403);
    expect(
      (await item.PATCH(req('/api/v1/goals/x', readFitness, 'PATCH', {}), params('x'))).status,
    ).toBe(403);
  });
});

describe('POST /api/v1/goals', () => {
  it('201 for both kinds with snake_case round-trip', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const metric = await collection.POST(req('/api/v1/goals', token, 'POST', METRIC_GOAL));
    expect(metric.status).toBe(201);
    expect(await metric.json()).toMatchObject({
      kind: 'metric',
      metric_key: 'weight',
      direction: 'decrease',
      target_value: 199,
      target_date: '2026-12-31',
      active: true,
      session_type: null,
    });

    const freq = await collection.POST(req('/api/v1/goals', token, 'POST', FREQ_GOAL));
    expect(freq.status).toBe(201);
    expect(await freq.json()).toMatchObject({
      kind: 'frequency',
      session_type: 'strength',
      per_week: 3,
      metric_key: null,
    });
  });

  it('400 for a registry-unknown metric_key and malformed bodies', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const res = await collection.POST(
      req('/api/v1/goals', token, 'POST', { ...METRIC_GOAL, metric_key: 'quantum_flux' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('quantum_flux');
    expect((await collection.POST(req('/api/v1/goals', token, 'POST', '{nope'))).status).toBe(400);
    expect(
      (await collection.POST(req('/api/v1/goals', token, 'POST', { kind: 'vibes' }))).status,
    ).toBe(400);
  });

  it('409 with existing_id for a second ACTIVE goal on the same key', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const first = await (await collection.POST(req('/api/v1/goals', token, 'POST', METRIC_GOAL))).json();
    const dupe = await collection.POST(
      req('/api/v1/goals', token, 'POST', { ...METRIC_GOAL, direction: 'maintain' }),
    );
    expect(dupe.status).toBe(409);
    const body = await dupe.json();
    expect(body.existing_id).toBe(first.id);

    // Inactive duplicates are allowed.
    const inactive = await collection.POST(
      req('/api/v1/goals', token, 'POST', { ...METRIC_GOAL, active: false }),
    );
    expect(inactive.status).toBe(201);
  });
});

describe('PATCH /api/v1/goals/{id}', () => {
  it('updates fields, enforces kind immutability, re-checks one-active on re-activate', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const goal = await (await collection.POST(req('/api/v1/goals', token, 'POST', FREQ_GOAL))).json();

    const bumped = await (
      await item.PATCH(req(`/api/v1/goals/${goal.id}`, token, 'PATCH', { per_week: 4 }), params(goal.id))
    ).json();
    expect(bumped.per_week).toBe(4);

    // Wrong-kind fields → 400 (kind is immutable).
    const wrongKind = await item.PATCH(
      req(`/api/v1/goals/${goal.id}`, token, 'PATCH', { metric_key: 'weight' }),
      params(goal.id),
    );
    expect(wrongKind.status).toBe(400);
    expect((await wrongKind.json()).error).toContain('kind is immutable');

    // Deactivate, create a replacement, then re-activating the old one → 409.
    await item.PATCH(req(`/api/v1/goals/${goal.id}`, token, 'PATCH', { active: false }), params(goal.id));
    const replacement = await (
      await collection.POST(req('/api/v1/goals', token, 'POST', FREQ_GOAL))
    ).json();
    const reactivate = await item.PATCH(
      req(`/api/v1/goals/${goal.id}`, token, 'PATCH', { active: true }),
      params(goal.id),
    );
    expect(reactivate.status).toBe(409);
    expect((await reactivate.json()).existing_id).toBe(replacement.id);
  });

  it("404 for another user's goal", async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:fitness']);
    const goal = await (await collection.POST(req('/api/v1/goals', token, 'POST', FREQ_GOAL))).json();
    const viewerToken = mintApiToken(ctx.sqlite, VIEWER, ['write:fitness']);
    expect(
      (
        await item.PATCH(
          req(`/api/v1/goals/${goal.id}`, viewerToken, 'PATCH', { per_week: 1 }),
          params(goal.id),
        )
      ).status,
    ).toBe(404);
  });
});

describe('GET /api/v1/goals', () => {
  it('filters by active and kind; 400s bad filter values', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['read:fitness', 'write:fitness']);
    await collection.POST(req('/api/v1/goals', token, 'POST', METRIC_GOAL));
    const freq = await (await collection.POST(req('/api/v1/goals', token, 'POST', FREQ_GOAL))).json();
    await item.PATCH(req(`/api/v1/goals/${freq.id}`, token, 'PATCH', { active: false }), params(freq.id));

    expect(await (await collection.GET(req('/api/v1/goals', token))).json()).toHaveLength(2);
    const active = await (await collection.GET(req('/api/v1/goals?active=true', token))).json();
    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe('metric');
    const frequency = await (await collection.GET(req('/api/v1/goals?kind=frequency', token))).json();
    expect(frequency).toHaveLength(1);

    expect((await collection.GET(req('/api/v1/goals?active=maybe', token))).status).toBe(400);
    expect((await collection.GET(req('/api/v1/goals?kind=vibes', token))).status).toBe(400);
  });
});
