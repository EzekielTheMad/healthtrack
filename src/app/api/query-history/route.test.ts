// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import { makeOwnerAiContext } from '@/lib/claude/owner-context';

const authState = vi.hoisted(() => ({ userId: null as string | null }));
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
let history: typeof import('./route');
let dismissal: typeof import('../lab-warning-dismissals/route');
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-owner-ai-api-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  authState.userId = OWNER;
  history = await import('./route');
  dismissal = await import('../lab-warning-dismissals/route');
});
afterEach(() => {
  authState.userId = null;
  ctx.restore();
});
const get = (query = '') => new Request(`http://localhost/api/query-history?${query}`);
const post = (body: unknown, query = '') =>
  new Request(`http://localhost/api/lab-warning-dismissals?${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('owner-only AI history and dismissals API', () => {
  it('returns only current owner history, retaining legacy/dependent/other-account rows', async () => {
    const dep = crypto.randomUUID();
    insertDependent(ctx.sqlite, dep, OWNER);
    for (const [user, dependent, version, answer] of [
      [OWNER, null, 0, 'LEGACY_POOLED_SENTINEL'],
      [OWNER, dep, 1, 'DEPENDENT_SENTINEL'],
      [STRANGER, null, 1, 'OTHER_SENTINEL'],
      [OWNER, null, 1, 'SELF_SENTINEL'],
    ] as const) {
      ctx.sqlite
        .prepare(
          'INSERT INTO query_history (id,user_id,dependent_id,context_version,query_text,response_text,created_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run(
          crypto.randomUUID(),
          user,
          dependent,
          version,
          'same question',
          answer,
          new Date().toISOString()
        );
    }
    const res = await history.GET(get('dependent_id=self'));
    const rows = await res.json();
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: OWNER,
      dependent_id: null,
      context_version: 1,
      response_text: 'SELF_SENTINEL',
    });
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM query_history').get()).toEqual({ n: 4 });
  });

  it.each([
    'dependent_id=all',
    'dependent_id=dependent-one',
    'owner_id=other-owner',
    'scope=household',
  ])('both APIs reject unsupported URL selectors: %s', async (query) => {
    expect((await history.GET(get(query))).status).toBe(400);
    expect((await dismissal.POST(post({ tests: ['SYNTHETIC_LAB'] }, query))).status).toBe(400);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM ai_lab_warning_dismissals').get()).toEqual({
      n: 0,
    });
  });

  it.each([{ dependent_id: 'dependent-one' }, { owner_id: STRANGER }, { context_version: 0 }])(
    'dismissal rejects body selectors before writing: %j',
    async (selector) => {
      const res = await dismissal.POST(post({ tests: ['SYNTHETIC_LAB'], ...selector }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('unsupported_context');
    }
  );

  it('dismissal success carries owner context and stamps only owner labs', async () => {
    const dep = crypto.randomUUID();
    insertDependent(ctx.sqlite, dep, OWNER);
    const seed = ctx.sqlite.prepare(
      'INSERT INTO lab_visits (id,user_id,dependent_id,visit_date,created_at) VALUES (?,?,?,?,?)'
    );
    seed.run(crypto.randomUUID(), OWNER, null, '2026-01-01', new Date().toISOString());
    seed.run(crypto.randomUUID(), OWNER, dep, '2026-02-01', new Date().toISOString());
    const res = await dismissal.POST(post({ tests: ['SYNTHETIC_LAB'], dependent_id: 'self' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      labVisitDate: '2026-01-01',
      context: makeOwnerAiContext(OWNER),
    });
  });

  it('both APIs require authentication before selectors', async () => {
    authState.userId = null;
    expect((await history.GET(get('dependent_id=all'))).status).toBe(401);
    expect((await dismissal.POST(post({ tests: ['LAB'], dependent_id: 'all' }))).status).toBe(401);
  });
});
