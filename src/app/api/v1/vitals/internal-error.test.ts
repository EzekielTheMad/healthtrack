// @vitest-environment node
/**
 * v1 vitals write endpoints — 500 responses must never reflect internal
 * error details (review M1): clients get a generic 'internal_error' and the
 * real message goes to console.error, matching src/lib/api/respond.ts.
 *
 * The repo layer is mocked to throw so the routes' catch paths are exercised.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

const SECRET = 'SQLITE_CORRUPT: secret internal detail at /data/healthtrack.db';

vi.mock('@/lib/repos/vitals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/repos/vitals')>();
  return {
    ...actual,
    listVitals: async () => {
      throw new Error(SECRET);
    },
    upsertOwnVital: () => {
      throw new Error(SECRET);
    },
  };
});

type SingleRoute = typeof import('./route');
type BatchRoute = typeof import('./batch/route');
type ApiAuth = typeof import('@/lib/api-auth');

let ctx: RepoTestDb;
let single: SingleRoute;
let batch: BatchRoute;
let apiAuth: ApiAuth;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-vitals-500-');
  single = await import('./route');
  batch = await import('./batch/route');
  apiAuth = await import('@/lib/api-auth');
  insertUser(ctx.sqlite, OWNER);
});

afterEach(() => ctx.restore());

function mintToken(userId: string, scopes: string[]): string {
  const { token, prefix, hash } = apiAuth.generateApiKey();
  ctx.sqlite
    .prepare(
      `insert into api_keys (id, user_id, name, token_hash, prefix, scopes, created_at)
       values (?, ?, 'test key', ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      userId,
      hash,
      prefix,
      JSON.stringify(scopes),
      new Date().toISOString(),
    );
  return token;
}

const RECORD = {
  metric_key: 'steps',
  value: 8200,
  source: 'watch',
  recorded_at: '2026-07-08',
};

describe('v1 vitals — 500 responses are generic (M1)', () => {
  it('GET returns internal_error, logs the real message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const token = mintToken(OWNER, ['read:vitals']);
      const res = await single.GET(
        new NextRequest('http://localhost/api/v1/vitals', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('internal_error');
      expect(JSON.stringify(body)).not.toContain('SQLITE_CORRUPT');
      expect(spy).toHaveBeenCalled();
      const logged = spy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
      expect(logged).toContain('SQLITE_CORRUPT');
    } finally {
      spy.mockRestore();
    }
  });

  it('POST returns internal_error, logs the real message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const token = mintToken(OWNER, ['write:vitals']);
      const res = await single.POST(
        new NextRequest('http://localhost/api/v1/vitals', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(RECORD),
        }),
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('internal_error');
      expect(JSON.stringify(body)).not.toContain('SQLITE_CORRUPT');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('batch POST returns internal_error, logs the real message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const token = mintToken(OWNER, ['write:vitals']);
      const res = await batch.POST(
        new NextRequest('http://localhost/api/v1/vitals/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ records: [RECORD] }),
        }),
      );
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('internal_error');
      expect(JSON.stringify(body)).not.toContain('SQLITE_CORRUPT');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
