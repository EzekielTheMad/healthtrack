// @vitest-environment node
/**
 * v1 vitals write endpoints — POST /api/v1/vitals and POST /api/v1/vitals/batch.
 *
 * Covers the PAT auth matrix (401 / 403 read-only / write:vitals / write:all),
 * registry validation at the API boundary, idempotent re-POST semantics,
 * batch partial-error responses, CORS methods, and the cross-user isolation
 * pin: a PAT resolves to exactly one user and can never read or write another
 * user's rows.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import { AVAILABLE_SCOPES } from '@/lib/api-scopes';

type SingleRoute = typeof import('./route');
type BatchRoute = typeof import('./batch/route');
type ApiAuth = typeof import('@/lib/api-auth');

let ctx: RepoTestDb;
let single: SingleRoute;
let batch: BatchRoute;
let apiAuth: ApiAuth;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-v1-vitals-write-');
  [single, batch, apiAuth] = await Promise.all([
    import('./route'),
    import('./batch/route'),
    import('@/lib/api-auth'),
  ]);
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
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

function post(url: string, token: string | null, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function get(url: string, token: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

const RECORD = {
  metric_key: 'steps',
  value: 8200,
  source: 'samsung_health',
  recorded_at: '2026-07-08T21:15:00Z',
};

describe('scope registry', () => {
  it('exposes write:vitals in AVAILABLE_SCOPES (ApiKeyManager renders from it)', () => {
    const scope = AVAILABLE_SCOPES.find((s) => s.value === 'write:vitals');
    expect(scope).toBeDefined();
    expect(scope!.description).toMatch(/write/i);
  });
});

describe('POST /api/v1/vitals — auth matrix', () => {
  it('401 without a token', async () => {
    const res = await single.POST(post('/api/v1/vitals', null, RECORD));
    expect(res.status).toBe(401);
  });

  it('403 for read-only scopes (read:all and read:vitals)', async () => {
    for (const scopes of [['read:all'], ['read:vitals']]) {
      const res = await single.POST(post('/api/v1/vitals', mintToken(OWNER, scopes), RECORD));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain('write:vitals');
    }
  });

  it('201 with write:vitals', async () => {
    const res = await single.POST(
      post('/api/v1/vitals', mintToken(OWNER, ['write:vitals']), RECORD),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.result).toBe('inserted');
    expect(body.vital).toMatchObject({
      metric_key: 'steps',
      value: 8200,
      unit: 'steps',
      source: 'samsung_health',
      recorded_at: '2026-07-08T00:00:00Z', // day-normalized
    });
    expect(body.vital.id).toBeTruthy();
  });

  it('201 with write:all', async () => {
    const res = await single.POST(
      post('/api/v1/vitals', mintToken(OWNER, ['write:all']), RECORD),
    );
    expect(res.status).toBe(201);
  });
});

describe('POST /api/v1/vitals — validation + semantics', () => {
  it('400 for a registry-unknown metric, naming the key and the docs', async () => {
    const res = await single.POST(
      post('/api/v1/vitals', mintToken(OWNER, ['write:vitals']), {
        ...RECORD,
        metric_key: 'quantum_flux',
      }),
    );
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain('quantum_flux');
    expect(error).toContain('/docs/api');
  });

  it('400 for malformed JSON', async () => {
    const res = await single.POST(
      post('/api/v1/vitals', mintToken(OWNER, ['write:vitals']), '{nope'),
    );
    expect(res.status).toBe(400);
  });

  it('resolves ordinal value_label and echoes metadata.label', async () => {
    const res = await single.POST(
      post('/api/v1/vitals', mintToken(OWNER, ['write:vitals']), {
        metric_key: 'resilience',
        value_label: 'solid',
        source: 'oura',
        recorded_at: '2026-07-08',
      }),
    );
    expect(res.status).toBe(201);
    const { vital } = await res.json();
    expect(vital.value).toBe(3);
    expect(vital.metadata.label).toBe('solid');
  });

  it('converts weight kg to lbs', async () => {
    const res = await single.POST(
      post('/api/v1/vitals', mintToken(OWNER, ['write:vitals']), {
        metric_key: 'weight',
        value: 80,
        unit: 'kg',
        source: 'renpho',
        recorded_at: '2026-07-08',
      }),
    );
    expect(res.status).toBe(201);
    const { vital } = await res.json();
    expect(vital.value).toBeCloseTo(176.4, 5);
    expect(vital.unit).toBe('lbs');
  });

  it('re-POST of the same (metric, day, source) tuple is an update', async () => {
    const token = mintToken(OWNER, ['write:vitals']);
    const first = await single.POST(post('/api/v1/vitals', token, RECORD));
    expect((await first.json()).result).toBe('inserted');

    const second = await single.POST(
      post('/api/v1/vitals', token, { ...RECORD, value: 9100 }),
    );
    expect(second.status).toBe(201);
    const body = await second.json();
    expect(body.result).toBe('updated');
    expect(body.vital.value).toBe(9100);

    const count = ctx.sqlite
      .prepare("select count(*) as n from vitals where metric_key = 'steps'")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('POST /api/v1/vitals/batch', () => {
  it('requires write scope (401/403) like the single endpoint', async () => {
    expect((await batch.POST(post('/api/v1/vitals/batch', null, { records: [RECORD] }))).status).toBe(401);
    expect(
      (
        await batch.POST(
          post('/api/v1/vitals/batch', mintToken(OWNER, ['read:all']), { records: [RECORD] }),
        )
      ).status,
    ).toBe(403);
  });

  it('mixed valid/invalid records → counts + per-index errors, valid ones written', async () => {
    const token = mintToken(OWNER, ['write:vitals']);
    const res = await batch.POST(
      post('/api/v1/vitals/batch', token, {
        records: [
          RECORD,
          { metric_key: 'weight', value: 181.2, source: 'renpho', recorded_at: '2026-07-08' },
          { metric_key: 'resilience', value_label: 'strong', source: 'oura', recorded_at: '2026-07-08' },
          { metric_key: 'quantum_flux', value: 1, source: 'x', recorded_at: '2026-07-08' },
          { metric_key: 'resilience', value_label: 'meh', source: 'oura', recorded_at: '2026-07-09' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(3);
    expect(body.updated).toBe(0);
    expect(body.errors).toHaveLength(2);
    expect(body.errors[0]).toMatchObject({ index: 3 });
    expect(body.errors[0].message).toContain('quantum_flux');
    expect(body.errors[1]).toMatchObject({ index: 4 });

    const count = ctx.sqlite.prepare('select count(*) as n from vitals').get() as { n: number };
    expect(count.n).toBe(3);
  });

  it('re-POST of the same batch reports updates, not inserts', async () => {
    const token = mintToken(OWNER, ['write:vitals']);
    const payload = {
      records: [
        RECORD,
        { metric_key: 'weight', value: 181.2, source: 'renpho', recorded_at: '2026-07-08' },
      ],
    };
    await batch.POST(post('/api/v1/vitals/batch', token, payload));
    const res = await batch.POST(post('/api/v1/vitals/batch', token, payload));
    const body = await res.json();
    expect(body.inserted).toBe(0);
    expect(body.updated).toBe(2);
    expect(body.errors).toEqual([]);
  });

  it('400 for a malformed envelope (missing records, > 500 records)', async () => {
    const token = mintToken(OWNER, ['write:vitals']);
    expect(
      (await batch.POST(post('/api/v1/vitals/batch', token, { rows: [RECORD] }))).status,
    ).toBe(400);
    expect(
      (
        await batch.POST(
          post('/api/v1/vitals/batch', token, { records: Array(501).fill(RECORD) }),
        )
      ).status,
    ).toBe(400);
    expect((await batch.POST(post('/api/v1/vitals/batch', token, '{nope'))).status).toBe(400);
  });
});

describe('GET /api/v1/vitals — limit clamping (M5)', () => {
  it('clamps limit to [1, 1000]; negative values never mean "unlimited"', async () => {
    const token = mintToken(OWNER, ['read:vitals', 'write:vitals']);
    // Three rows on distinct days.
    for (const day of ['2026-07-06', '2026-07-07', '2026-07-08']) {
      await single.POST(
        post('/api/v1/vitals', token, {
          metric_key: 'steps',
          value: 1000,
          source: 'watch',
          recorded_at: day,
        }),
      );
    }

    // SQLite treats LIMIT -1 as unlimited — must clamp to 1 instead.
    const negative = await single.GET(get('/api/v1/vitals?limit=-1', token));
    expect(await negative.json()).toHaveLength(1);

    const zero = await single.GET(get('/api/v1/vitals?limit=0', token));
    expect(await zero.json()).toHaveLength(1);

    const two = await single.GET(get('/api/v1/vitals?limit=2', token));
    expect(await two.json()).toHaveLength(2);

    // Default (no param) still returns everything under the 100 default.
    const all = await single.GET(get('/api/v1/vitals', token));
    expect(await all.json()).toHaveLength(3);
  });
});

describe('CORS', () => {
  it('single route allows GET, POST, OPTIONS', async () => {
    const res = await single.OPTIONS();
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('batch route allows POST, OPTIONS', async () => {
    const res = await batch.OPTIONS();
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
  });

  it('POST responses carry CORS headers', async () => {
    const res = await single.POST(
      post('/api/v1/vitals', mintToken(OWNER, ['write:vitals']), RECORD),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('cross-user isolation (pin)', () => {
  it("token A can never read or write user B's rows", async () => {
    const tokenA = mintToken(OWNER, ['read:vitals', 'write:vitals']);
    const tokenB = mintToken(VIEWER, ['read:vitals', 'write:vitals']);

    // B writes a row.
    const bRes = await single.POST(
      post('/api/v1/vitals', tokenB, {
        metric_key: 'weight',
        value: 200,
        source: 'renpho',
        recorded_at: '2026-07-08',
      }),
    );
    expect(bRes.status).toBe(201);

    // A writes the SAME (metric, day, source) tuple — must insert a new row
    // owned by A, never update B's. Client-supplied scope fields are ignored.
    const aRes = await single.POST(
      post('/api/v1/vitals', tokenA, {
        metric_key: 'weight',
        value: 180,
        source: 'renpho',
        recorded_at: '2026-07-08',
        user_id: VIEWER, // must be stripped
        dependent_id: crypto.randomUUID(), // must be stripped
      }),
    );
    expect(aRes.status).toBe(201);
    expect((await aRes.json()).result).toBe('inserted');

    const rows = ctx.sqlite
      .prepare('select user_id, value, dependent_id from vitals order by value')
      .all() as { user_id: string; value: number; dependent_id: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: OWNER, value: 180, dependent_id: null });
    expect(rows[1]).toMatchObject({ user_id: VIEWER, value: 200, dependent_id: null });

    // A's GET sees only A's data; B's GET sees only B's.
    const aGet = await single.GET(get('/api/v1/vitals', tokenA));
    const aRows = await aGet.json();
    expect(aRows).toHaveLength(1);
    expect(aRows[0].value).toBe(180);

    const bGet = await single.GET(get('/api/v1/vitals', tokenB));
    const bRows = await bGet.json();
    expect(bRows).toHaveLength(1);
    expect(bRows[0].value).toBe(200);

    // Batch writes are equally pinned to the token owner.
    await batch.POST(
      post('/api/v1/vitals/batch', tokenA, {
        records: [
          { metric_key: 'steps', value: 5000, source: 'watch', recorded_at: '2026-07-08' },
        ],
      }),
    );
    const stepsRow = ctx.sqlite
      .prepare("select user_id from vitals where metric_key = 'steps'")
      .get() as { user_id: string };
    expect(stepsRow.user_id).toBe(OWNER);

    // B's row is untouched by everything A did.
    const bRow = ctx.sqlite
      .prepare('select value from vitals where user_id = ?')
      .get(VIEWER) as { value: number };
    expect(bRow.value).toBe(200);
  });
});
