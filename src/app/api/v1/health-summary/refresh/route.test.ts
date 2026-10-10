// @vitest-environment node
/**
 * POST /api/v1/health-summary/refresh — PAT-authenticated cache warm.
 *
 * Covers the auth matrix (401 no token, 403 without a broad scope, 200 with
 * write:all or read:all), the happy path (regenerates + caches today's row),
 * the no-data case (generated:false, nothing cached), the 501 AI-not-configured
 * gate, and CORS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  mintApiToken,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import { seedOwnerAiSentinels } from '@/lib/claude/owner-context-test-fixtures';
import { makeOwnerAiContext } from '@/lib/claude/owner-context';
import type { HealthSummary, HealthSummaryInput } from '@/lib/claude/health-summary';

const { captured } = vi.hoisted(() => ({
  captured: {
    result: { summary: 'Cron-warmed overview.', highlights: [] } as HealthSummary,
    calls: 0,
    input: null as HealthSummaryInput | null,
  },
}));

vi.mock('@/lib/claude/health-summary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/claude/health-summary')>();
  return {
    ...actual,
    generateHealthSummary: async (input: HealthSummaryInput) => {
      captured.input = input;
      captured.calls += 1;
      return captured.result;
    },
  };
});

type RouteModule = typeof import('./route');
type CacheModule = typeof import('@/lib/claude/summary-cache');
type DailyRepo = typeof import('@/lib/repos/daily-summaries');

let ctx: RepoTestDb;
let route: RouteModule;
let cacheMod: CacheModule;
let dailyRepo: DailyRepo;
let savedApiKey: string | undefined;

function post(token: string | null): NextRequest {
  return new NextRequest('http://localhost/api/v1/health-summary/refresh', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function seedCondition() {
  const now = new Date().toISOString();
  ctx.sqlite
    .prepare(
      `insert into conditions (id, user_id, name, status, created_at, updated_at)
       values (?, ?, 'Hypertension', 'active', ?, ?)`
    )
    .run(crypto.randomUUID(), OWNER, now, now);
}

beforeEach(async () => {
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  ctx = await setupRepoDb('healthtrack-v1-summary-refresh-');
  route = await import('./route');
  cacheMod = await import('@/lib/claude/summary-cache');
  dailyRepo = await import('@/lib/repos/daily-summaries');
  insertUser(ctx.sqlite, OWNER);
  captured.calls = 0;
  captured.input = null;
  captured.result = { summary: 'Cron-warmed overview.', highlights: [] };
});

afterEach(() => {
  if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedApiKey;
  ctx.restore();
});

describe('POST /api/v1/health-summary/refresh — auth', () => {
  it('401 without a token', async () => {
    const res = await route.POST(post(null));
    expect(res.status).toBe(401);
  });

  it('403 without a broad scope (write:vitals is not enough)', async () => {
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['write:vitals'])));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('write:all');
  });

  it('200 with write:all', async () => {
    seedCondition();
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['write:all'])));
    expect(res.status).toBe(200);
  });

  it('200 with read:all', async () => {
    seedCondition();
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['read:all'])));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/health-summary/refresh — behavior', () => {
  it("happy path: regenerates and caches today's owner-local row", async () => {
    seedCondition();
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['write:all'])));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generated).toBe(true);
    expect(body.date).toBe(cacheMod.ownerLocalDayKey());
    expect(captured.calls).toBe(1);

    const row = await dailyRepo.getCachedSummary(OWNER, cacheMod.ownerLocalDayKey());
    expect(dailyRepo.parseCachedSummary(row!).summary).toBe('Cron-warmed overview.');
  });

  it('no data: generated:false and nothing cached (welcome is never stored)', async () => {
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['write:all'])));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generated).toBe(false);
    expect(captured.calls).toBe(0);
    expect(await dailyRepo.getCachedSummary(OWNER, cacheMod.ownerLocalDayKey())).toBeNull();
  });

  it('501 when AI is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['write:all'])));
    expect(res.status).toBe(501);
  });
});

describe('CORS', () => {
  it('OPTIONS advertises POST, OPTIONS', () => {
    const res = route.OPTIONS();
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('POST responses carry CORS headers', async () => {
    seedCondition();
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['write:all'])));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('PAT owner isolation', () => {
  it('the PAT warm uses only the key owner across every summary domain', async () => {
    seedOwnerAiSentinels(ctx.sqlite);
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['write:all'])));
    expect(res.status).toBe(200);
    expect((await res.json()).context).toEqual(makeOwnerAiContext(OWNER));
    const input = JSON.stringify(captured.input);
    for (const domain of ['MED', 'CONDITION', 'LAB', 'ALERT', 'GOAL', 'WORKOUT'])
      expect(input).toContain(`SELF_SENTINEL_${domain}`);
    for (const tag of [
      'DEP_ONE_SENTINEL',
      'DEP_TWO_SENTINEL',
      'OTHER_ACCOUNT_SENTINEL',
      'MISMATCH',
    ])
      expect(input).not.toContain(tag);
    expect(captured.input!.vitals.map((v) => v.value)).toEqual([181]);
    expect((await dailyRepo.getLatestCachedSummary(OWNER))!.contextVersion).toBe(1);
  });

  it('dependent-only records do not generate/cache an owner summary', async () => {
    seedOwnerAiSentinels(ctx.sqlite, false);
    const res = await route.POST(post(mintApiToken(ctx.sqlite, OWNER, ['write:all'])));
    expect((await res.json()).generated).toBe(false);
    expect(captured.calls).toBe(0);
    expect(await dailyRepo.getLatestCachedSummary(OWNER)).toBeNull();
  });

  it.each(['dependent_id=all', 'owner_id=another-account', 'dependentId=dependent-one'])(
    'rejects URL selectors before generation: %s',
    async (selector) => {
      const token = mintApiToken(ctx.sqlite, OWNER, ['write:all']);
      const request = new NextRequest(
        `http://localhost/api/v1/health-summary/refresh?${selector}`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
      );
      const res = await route.POST(request);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('unsupported_context');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(captured.calls).toBe(0);
    }
  );

  it('rejects JSON selectors before generation', async () => {
    const token = mintApiToken(ctx.sqlite, OWNER, ['write:all']);
    const request = new NextRequest('http://localhost/api/v1/health-summary/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ dependent_id: 'dependent-one' }),
    });
    expect((await route.POST(request)).status).toBe(400);
    expect(captured.calls).toBe(0);
  });
});
