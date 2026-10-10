// @vitest-environment node
/**
 * daily_summaries repository + owner-local day-key boundary.
 *
 * Pins: upsert-on-conflict per (user, date), latest-row selection, JSON
 * round-trip, cross-user isolation, and the America/Phoenix day-key boundary
 * (an instant just after UTC midnight is still "yesterday" in Phoenix).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupRepoDb, insertUser, OWNER, VIEWER, type RepoTestDb } from './repo-test-harness';
import type { HealthSummary } from '@/lib/claude/health-summary';
import { OWNER_AI_CONTEXT_VERSION } from '@/lib/claude/owner-context';

type Repo = typeof import('./daily-summaries');
type CacheMod = typeof import('@/lib/claude/summary-cache');

let ctx: RepoTestDb;
let repo: Repo;
let cacheMod: CacheMod;

const SUMMARY_A: HealthSummary = {
  summary: 'Overview A.',
  highlights: [{ type: 'positive', text: 'Looks good.' }],
};
const SUMMARY_B: HealthSummary = { summary: 'Overview B.', highlights: [] };

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-daily-summaries-');
  repo = await import('./daily-summaries');
  cacheMod = await import('@/lib/claude/summary-cache');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

describe('daily-summaries repo', () => {
  it('getCachedSummary returns null before any write, then the row after', async () => {
    expect(await repo.getCachedSummary(OWNER, '2026-07-10')).toBeNull();
    await repo.upsertCachedSummary(OWNER, '2026-07-10', SUMMARY_A, 'model-x');
    const row = await repo.getCachedSummary(OWNER, '2026-07-10');
    expect(row).not.toBeNull();
    expect(row!.model).toBe('model-x');
    expect(row!.contextVersion).toBe(OWNER_AI_CONTEXT_VERSION);
    expect(repo.parseCachedSummary(row!)).toEqual(SUMMARY_A);
  });

  it('upsert is idempotent per (user, date) — refresh, not duplicate', async () => {
    await repo.upsertCachedSummary(OWNER, '2026-07-10', SUMMARY_A, 'model-x');
    await repo.upsertCachedSummary(OWNER, '2026-07-10', SUMMARY_B, 'model-y');

    const count = ctx.sqlite
      .prepare('select count(*) as n from daily_summaries where user_id = ?')
      .get(OWNER) as { n: number };
    expect(count.n).toBe(1);

    const row = await repo.getCachedSummary(OWNER, '2026-07-10');
    expect(repo.parseCachedSummary(row!)).toEqual(SUMMARY_B);
    expect(row!.model).toBe('model-y');
  });

  it('getLatestCachedSummary returns the newest day', async () => {
    await repo.upsertCachedSummary(OWNER, '2026-07-08', SUMMARY_A, 'm');
    await repo.upsertCachedSummary(OWNER, '2026-07-10', SUMMARY_B, 'm');
    await repo.upsertCachedSummary(OWNER, '2026-07-09', SUMMARY_A, 'm');

    const latest = await repo.getLatestCachedSummary(OWNER);
    expect(latest!.summaryDate).toBe('2026-07-10');
    expect(repo.parseCachedSummary(latest!)).toEqual(SUMMARY_B);
  });

  it('excludes legacy today and fallback rows, including newer unrecognized versions', async () => {
    const legacy = JSON.stringify({ summary: 'Synthetic pooled legacy', highlights: [] });
    const insert = ctx.sqlite.prepare(`
      insert into daily_summaries
        (id, user_id, summary_date, summary_json, generated_at, model, context_version)
      values (?, ?, ?, ?, '2026-07-10T12:00:00Z', 'synthetic', ?)
    `);
    insert.run('legacy-today', OWNER, '2026-07-10', legacy, 0);
    insert.run('legacy-yesterday', OWNER, '2026-07-09', legacy, 0);
    expect(await repo.getCachedSummary(OWNER, '2026-07-10')).toBeNull();
    expect(await repo.getLatestCachedSummary(OWNER)).toBeNull();

    await repo.upsertCachedSummary(OWNER, '2026-07-08', SUMMARY_A, 'm');
    await repo.upsertCachedSummary(VIEWER, '2026-07-11', SUMMARY_B, 'm');
    insert.run('unknown-policy', OWNER, '2026-07-12', legacy, 99);
    const fallback = await repo.getLatestCachedSummary(OWNER);
    expect(fallback?.summaryDate).toBe('2026-07-08');
    expect(repo.parseCachedSummary(fallback!)).toEqual(SUMMARY_A);
    expect(await repo.getCachedSummary(OWNER, '2026-07-12')).toBeNull();
    expect(
      ctx.sqlite
        .prepare('select summary_json from daily_summaries where id = ?')
        .get('legacy-today')
    ).toEqual({ summary_json: legacy });
  });

  it('refreshes the current version while preserving legacy content on the same day', async () => {
    ctx.sqlite
      .prepare(
        `
      insert into daily_summaries
        (id, user_id, summary_date, summary_json, generated_at, model)
      values ('legacy', ?, '2026-07-10', ?, '2026-07-10T00:00:00Z', 'old-model')
    `
      )
      .run(OWNER, JSON.stringify({ summary: 'Legacy pooled summary', highlights: [] }));
    const legacy = ctx.sqlite.prepare('select * from daily_summaries where id = ?').get('legacy');
    await repo.upsertCachedSummary(OWNER, '2026-07-10', SUMMARY_A, 'm1');
    await repo.upsertCachedSummary(OWNER, '2026-07-10', SUMMARY_B, 'm2');
    expect(ctx.sqlite.prepare('select * from daily_summaries where id = ?').get('legacy')).toEqual(
      legacy
    );
    expect(ctx.sqlite.prepare('select count(*) as n from daily_summaries').get()).toEqual({ n: 2 });
    const current = await repo.getCachedSummary(OWNER, '2026-07-10');
    expect(current?.contextVersion).toBe(OWNER_AI_CONTEXT_VERSION);
    expect(repo.parseCachedSummary(current!)).toEqual(SUMMARY_B);
  });

  it("is owner-scoped — one user never reads another user's cache", async () => {
    await repo.upsertCachedSummary(OWNER, '2026-07-10', SUMMARY_A, 'm');
    expect(await repo.getCachedSummary(VIEWER, '2026-07-10')).toBeNull();
    expect(await repo.getLatestCachedSummary(VIEWER)).toBeNull();
  });
});

describe('ownerLocalDayKey — America/Phoenix boundary', () => {
  it('an instant just after UTC midnight is still the previous day in Phoenix', () => {
    // Phoenix is UTC-7 (MST, no DST). 2026-07-11T04:30:00Z → 2026-07-10 21:30 local.
    expect(cacheMod.ownerLocalDayKey(new Date('2026-07-11T04:30:00Z'))).toBe('2026-07-10');
  });

  it('crosses to the new local day once it is past 07:00 UTC', () => {
    // 2026-07-11T07:30:00Z → 2026-07-11 00:30 local.
    expect(cacheMod.ownerLocalDayKey(new Date('2026-07-11T07:30:00Z'))).toBe('2026-07-11');
  });

  it('midday UTC resolves to the same calendar day in Phoenix', () => {
    expect(cacheMod.ownerLocalDayKey(new Date('2026-07-11T19:00:00Z'))).toBe('2026-07-11');
  });
});
