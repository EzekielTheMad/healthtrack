// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertDelegate,
  insertShare,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from './repo-test-harness';
import { OWNER_AI_CONTEXT_VERSION } from '@/lib/claude/owner-context';

type Repo = typeof import('./query-history');
let ctx: RepoTestDb;
let repo: Repo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-owner-query-history-');
  repo = await import('./query-history');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertDependent(ctx.sqlite, 'dep-one', OWNER);
  insertDependent(ctx.sqlite, 'dep-two', OWNER);
  insertDependent(ctx.sqlite, 'other-account-dep', VIEWER);
});
afterEach(() => ctx.restore());

function insertHistory(
  id: string,
  userId: string,
  dependentId: string | null,
  version: number,
  date: string
) {
  ctx.sqlite
    .prepare(
      `insert into query_history
    (id, user_id, dependent_id, query_text, response_text, context_version, created_at)
    values (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, userId, dependentId, `${id} query`, `${id} answer`, version, date);
}

describe('owner-only query history', () => {
  it('lists only the current actor owner-only version, never legacy, either dependent, or another account', async () => {
    insertHistory('old-pooled', OWNER, null, 0, '2026-10-10T12:00:00Z');
    insertHistory(
      'dep-one-current',
      OWNER,
      'dep-one',
      OWNER_AI_CONTEXT_VERSION,
      '2026-10-10T13:00:00Z'
    );
    insertHistory(
      'dep-two-current',
      OWNER,
      'dep-two',
      OWNER_AI_CONTEXT_VERSION,
      '2026-10-10T14:00:00Z'
    );
    insertHistory(
      'foreign-current',
      VIEWER,
      null,
      OWNER_AI_CONTEXT_VERSION,
      '2026-10-10T15:00:00Z'
    );
    insertHistory(
      'foreign-dependent',
      VIEWER,
      'other-account-dep',
      OWNER_AI_CONTEXT_VERSION,
      '2026-10-10T15:30:00Z'
    );
    insertHistory('unknown-version', OWNER, null, 99, '2026-10-10T16:00:00Z');
    insertHistory('owner-earlier', OWNER, null, OWNER_AI_CONTEXT_VERSION, '2026-10-10T10:00:00Z');
    insertHistory('owner-later', OWNER, null, OWNER_AI_CONTEXT_VERSION, '2026-10-10T11:00:00Z');
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'admin',
    });
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['medications', 'labs'],
    });

    expect((await repo.listQueryHistory(OWNER)).map((row) => row.id)).toEqual([
      'owner-later',
      'owner-earlier',
    ]);
    expect((await repo.listQueryHistory(VIEWER)).map((row) => row.id)).toEqual(['foreign-current']);
    // Isolation is a read filter, never destructive cleanup.
    expect(ctx.sqlite.prepare('select count(*) as n from query_history').get()).toEqual({ n: 8 });
  });

  it('stamps fresh owner history with a trusted version despite client-like extra fields', async () => {
    const forged = {
      queryText: 'Synthetic owner question',
      responseText: 'Synthetic owner answer',
      userId: VIEWER,
      contextVersion: 99,
      context_version: 99,
    };
    const row = await repo.createQueryHistoryEntry(OWNER, forged);
    expect(row).toMatchObject({
      userId: OWNER,
      dependentId: null,
      contextVersion: OWNER_AI_CONTEXT_VERSION,
    });
    const explicitNull = await repo.createQueryHistoryEntry(OWNER, {
      queryText: 'Q2',
      responseText: 'A2',
      dependentId: null,
    });
    expect(explicitNull.dependentId).toBeNull();
    expect(explicitNull.contextVersion).toBe(OWNER_AI_CONTEXT_VERSION);
  });

  it.each(['dep-one', 'dep-two', 'other-account-dep', 'all', ''])(
    'rejects non-owner scope %j before writing history',
    async (dependentId) => {
      await expect(
        repo.createQueryHistoryEntry(OWNER, {
          queryText: 'Synthetic question',
          responseText: 'Synthetic answer',
          dependentId,
        })
      ).rejects.toBeInstanceOf(z.ZodError);
      expect(ctx.sqlite.prepare('select count(*) as n from query_history').get()).toEqual({ n: 0 });
    }
  );

  it('rejects absent actors before reading or creating history', async () => {
    await expect(repo.listQueryHistory('')).rejects.toThrow();
    await expect(
      repo.createQueryHistoryEntry('', { queryText: 'Q', responseText: 'A' })
    ).rejects.toThrow();
  });
});
