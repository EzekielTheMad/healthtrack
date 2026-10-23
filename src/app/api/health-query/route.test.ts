// @vitest-environment node
/**
 * POST /api/health-query — pins the clinical-correctness fix (review I1):
 * the VITALS fetch is owner-scoped (dependent_id NULL) so the per-metric
 * aggregates in the system prompt never blend a dependent's readings into
 * the owner's trends. Other domains keep the legacy unfiltered scope.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { HealthContext } from '@/lib/claude/query';

const { authState, captured } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
  captured: { context: null as HealthContext | null },
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

// Keep buildSystemPrompt real; capture the context the route hands the model.
vi.mock('@/lib/claude/query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/claude/query')>();
  return {
    ...actual,
    queryHealthData: async (_question: string, context: HealthContext) => {
      captured.context = context;
      return 'mock answer';
    },
  };
});

type RouteModule = typeof import('./route');
type QueryModule = typeof import('@/lib/claude/query');

let ctx: RepoTestDb;
let route: RouteModule;
let query: QueryModule;
let savedApiKey: string | undefined;

beforeEach(async () => {
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  ctx = await setupRepoDb('healthtrack-health-query-');
  route = await import('./route');
  query = await import('@/lib/claude/query');
  insertUser(ctx.sqlite, OWNER);
  authState.userId = OWNER;
  captured.context = null;
});

afterEach(() => {
  if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedApiKey;
  authState.userId = null;
  ctx.restore();
});

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/health-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function insertVital(opts: {
  userId: string;
  dependentId: string | null;
  metricKey: string;
  value: number;
  unit: string | null;
  recordedAt: string;
}) {
  ctx.sqlite
    .prepare(
      `insert into vitals (id, user_id, metric_key, value, unit, source, recorded_at, metadata, dependent_id, created_at)
       values (?, ?, ?, ?, ?, 'manual', ?, '{}', ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      opts.userId,
      opts.metricKey,
      opts.value,
      opts.unit,
      opts.recordedAt,
      opts.dependentId,
      new Date().toISOString()
    );
}

function dayISO(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return `${d.toISOString().slice(0, 10)}T00:00:00Z`;
}

describe('POST /api/health-query — vitals scope (I1)', () => {
  it("system prompt reflects only the owner's vitals, never a dependent's", async () => {
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);

    // Owner weighs 180 lbs; the dependent (a child) weighs 62 lbs the same day.
    insertVital({
      userId: OWNER,
      dependentId: null,
      metricKey: 'weight',
      value: 180,
      unit: 'lbs',
      recordedAt: dayISO(2),
    });
    insertVital({
      userId: OWNER,
      dependentId: depId,
      metricKey: 'weight',
      value: 62,
      unit: 'lbs',
      recordedAt: dayISO(2),
    });

    const res = await route.POST(post({ query: 'How is my weight trending?' }));
    expect(res.status).toBe(200);
    expect(captured.context).not.toBeNull();

    const prompt = query.buildSystemPrompt(captured.context!);
    // Owner's value present; blended (180 + 62) / 2 = 121 average and the
    // dependent's 62 absent.
    expect(prompt).toContain('180');
    expect(prompt).not.toContain('"mean":121');
    expect(prompt).not.toContain('weight=62 ');
  });

  it('401 without a session', async () => {
    authState.userId = null;
    const res = await route.POST(post({ query: 'hi' }));
    expect(res.status).toBe(401);
  });

  it('reuses only an answer whose patient, window, and current facts still match', async () => {
    const first = await route.POST(post({ query: 'When did I start my medication?', days: 90 }));
    expect(first.status).toBe(200);
    const saved = await first.json();
    expect(saved.context_metadata.context_version).toBe(2);
    captured.context = null;
    const repeat = await route.POST(post({ query: 'When did I start my medication?', days: 90 }));
    expect((await repeat.json()).reused).toBe(true);
    expect(captured.context).toBeNull();
    const { createMedication } = await import('@/lib/repos/medications');
    await createMedication(
      OWNER,
      { ownerId: OWNER, dependentId: null },
      { name: 'Synthetic medicine', startDate: '2026-01-02' }
    );
    const changed = await route.POST(post({ query: 'When did I start my medication?', days: 90 }));
    expect(changed.status).toBe(200);
    expect((captured.context as HealthContext | null)?.medications_data).toContain('2026-01-02');
    const { listQueryHistory } = await import('@/lib/repos/query-history');
    expect(
      (await listQueryHistory(OWNER)).every((entry) => !!entry.contextMetadata?.coverage)
    ).toBe(true);
  });
});
