// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  mintApiToken as mintPat,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
let ctx: RepoTestDb;
let sessionUser: string | null;
vi.mock('@/lib/auth/session', async () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!sessionUser) throw new UnauthorizedError();
      return { id: sessionUser };
    },
  };
});
const fact = {
  kind: 'lab',
  test_name: 'Fictional',
  outcome: { kind: 'text', text: 'Negative' },
  collection_date: { precision: 'unknown', value: null },
  provenance: { basis: 'patient_reported' },
};
const input = { external_id: 'api-import', items: [{ item_key: 'one', action: 'add', fact }] };
function request(url: string, body?: unknown, token?: string, origin = 'http://localhost') {
  return new NextRequest('http://localhost' + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json', origin } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(async () => {
  ctx = await setupRepoDb('hf-clinical-routes-');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  sessionUser = OWNER;
});
afterEach(() => ctx.restore());
it('applies typed analyte filtering before limits and rejects every supplied days filter explicitly', async () => {
  const { clinicalFactSchema } = await import('./contracts');
  const labs = await import('@/app/api/v1/labs/route');
  const insert = ctx.sqlite.prepare(
    'INSERT INTO clinical_records(id,user_id,kind,payload_json,received_at,updated_at)VALUES(?,?,?,?,?,?)'
  );
  const wanted = clinicalFactSchema.parse({
    ...fact,
    test_name: 'Fictional Needle analyte',
    collection_date: { precision: 'unknown', value: null, original_text: 'circa 2020' },
  });
  insert.run(
    'old-matching',
    OWNER,
    'lab',
    JSON.stringify(wanted),
    '2000-01-01T00:00:00Z',
    '2000-01-01T00:00:00Z'
  );
  insert.run(
    'wrong-owner',
    STRANGER,
    'lab',
    JSON.stringify(wanted),
    '2026-10-31T00:00:00Z',
    '2026-10-31T00:00:00Z'
  );
  ctx.sqlite.transaction(() => {
    for (let i = 0; i < 1005; i++)
      insert.run(
        'unrelated-' + i,
        OWNER,
        'lab',
        JSON.stringify({ ...wanted, test_name: 'Unrelated ' + i }),
        '2026-10-31T00:00:00Z',
        '2026-10-31T00:00:00Z'
      );
  })();
  const token = mintPat(ctx.sqlite, OWNER, ['read:labs']);
  const filtered = await (
    await labs.GET(request('/api/v1/labs?format=typed&test=nEeDlE&limit=1', undefined, token))
  ).json();
  expect(filtered.records.map((row: { id: string }) => row.id)).toEqual(['old-matching']);
  expect(filtered.records[0].fact.collection_date).toEqual({
    precision: 'unknown',
    value: null,
    original_text: 'circa 2020',
  });
  expect(filtered.coverage).toMatchObject({ test_filter: 'nEeDlE', limit: 1 });
  expect(filtered.coverage.collection_dates).toContain('partial and unknown');
  const empty = await (
    await labs.GET(request('/api/v1/labs?format=typed&test=absent', undefined, token))
  ).json();
  expect(empty.records).toEqual([]);
  for (const days of ['30', '0', '', 'invalid']) {
    const result = await labs.GET(
      request('/api/v1/labs?format=typed&days=' + days, undefined, token)
    );
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain('Omit days');
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*');
  }
  expect((await labs.GET(request('/api/v1/labs?days=30', undefined, token))).status).toBe(200);
});
it('filters legacy typed adapters without resurrecting an old name after its selected overlay correction', async () => {
  const labs = await import('@/app/api/v1/labs/route');
  const legacy = await import('@/lib/repos/labs');
  const clinical = await import('./clinical');
  const scope = { ownerId: OWNER, dependentId: null };
  await legacy.createLabVisitWithResults(OWNER, scope, {
    visitDate: '2026-01-01',
    results: [
      { testName: 'Former Needle', value: 5 },
      { testName: 'Other analyte', value: 7 },
    ],
  });
  const token = mintPat(ctx.sqlite, OWNER, ['read:labs']);
  const before = await (
    await labs.GET(request('/api/v1/labs?format=typed&test=needle', undefined, token))
  ).json();
  expect(before.records).toHaveLength(1);
  const original = before.records[0];
  const preview = await clinical.stageClinicalIntake(OWNER, scope, {
    external_id: 'rename-legacy',
    items: [
      {
        item_key: 'renamed',
        action: 'correct',
        target_id: original.id,
        expected_revision: original.revision,
        reason: 'Owner corrected the printed analyte name.',
        fact: { ...original.fact, test_name: 'Corrected analyte' },
      },
    ],
  });
  await clinical.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
  const after = await (
    await labs.GET(request('/api/v1/labs?format=typed&test=needle', undefined, token))
  ).json();
  expect(after.records).toEqual([]);
  const corrected = await (
    await labs.GET(request('/api/v1/labs?format=typed&test=Corrected', undefined, token))
  ).json();
  expect(corrected.records).toHaveLength(1);
  expect(corrected.records[0].fact.test_name).toBe('Corrected analyte');
});
it('requires explicit new grant for PAT staging and never exposes a PAT commit route', async () => {
  const route = await import('@/app/api/v1/clinical-intake/route');
  for (const scopes of [['write:all'], ['read:all'], ['write:health_connect']]) {
    const token = mintPat(ctx.sqlite, OWNER, scopes);
    expect((await route.POST(request('/api/v1/clinical-intake', input, token))).status).toBe(403);
  }
  const token = mintPat(ctx.sqlite, OWNER, ['write:clinical_intake']);
  const staged = await route.POST(request('/api/v1/clinical-intake', input, token));
  expect(staged.status).toBe(201);
  const preview = await staged.json();
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 0 });
  sessionUser = null;
  const approve = await import('@/app/api/clinical-intake/[id]/approve/route');
  expect(
    (
      await approve.POST(
        request(
          '/api/clinical-intake/' + preview.id + '/approve',
          { version: preview.version, digest: preview.digest },
          token
        ),
        { params: Promise.resolve({ id: preview.id }) }
      )
    ).status
  ).toBe(401);
});
it('rejects PAT subject/owner injection and fences staged readback by owner', async () => {
  const route = await import('@/app/api/v1/clinical-intake/route');
  const token = mintPat(ctx.sqlite, OWNER, ['write:clinical_intake']);
  expect(
    (await route.POST(request('/api/v1/clinical-intake', { ...input, owner_id: STRANGER }, token)))
      .status
  ).toBe(400);
  const staged = await (await route.POST(request('/api/v1/clinical-intake', input, token))).json();
  const read = await import('@/app/api/v1/clinical-intake/[id]/route');
  const other = mintPat(ctx.sqlite, STRANGER, ['write:clinical_intake']);
  expect(
    (
      await read.GET(request('/api/v1/clinical-intake/' + staged.id, undefined, other), {
        params: Promise.resolve({ id: staged.id }),
      })
    ).status
  ).toBe(404);
});
it('requires same-origin owner approval of exact version/digest and preserves durable retry outcomes', async () => {
  const stage = await import('@/app/api/clinical-intake/route');
  const approval = await import('@/app/api/clinical-intake/[id]/approve/route');
  const preview = await (
    await stage.POST(request('/api/clinical-intake', { intake: input }))
  ).json();
  const args = { params: Promise.resolve({ id: preview.id }) };
  const body = { version: preview.version, digest: preview.digest };
  expect(
    (
      await approval.POST(
        request(
          '/api/clinical-intake/' + preview.id + '/approve',
          body,
          undefined,
          'https://foreign.invalid'
        ),
        args
      )
    ).status
  ).toBe(403);
  expect(
    (
      await approval.POST(
        request('/api/clinical-intake/' + preview.id + '/approve', {
          ...body,
          digest: 'a'.repeat(64),
        }),
        args
      )
    ).status
  ).toBe(409);
  const result = await approval.POST(
    request('/api/clinical-intake/' + preview.id + '/approve', body),
    args
  );
  expect(result.status).toBe(200);
  expect((await result.json()).counts.created).toBe(1);
  expect(
    (await approval.POST(request('/api/clinical-intake/' + preview.id + '/approve', body), args))
      .status
  ).toBe(200);
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM clinical_records').get()).toEqual({ n: 1 });
});
it('filters typed read domains by token scopes and leaves legacy numeric responses unchanged', async () => {
  const repo = await import('./clinical');
  const preview = await repo.stageClinicalIntake(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    input
  );
  await repo.approveClinicalIntake(OWNER, preview.id, {
    version: preview.version,
    digest: preview.digest,
  });
  const labs = await import('@/app/api/v1/labs/route');
  const medToken = mintPat(ctx.sqlite, OWNER, ['read:medications']);
  expect((await labs.GET(request('/api/v1/labs?format=typed', undefined, medToken))).status).toBe(
    403
  );
  const labToken = mintPat(ctx.sqlite, OWNER, ['read:labs']);
  const legacy = await labs.GET(request('/api/v1/labs', undefined, labToken));
  expect(await legacy.json()).toEqual([]);
  expect(legacy.headers.get('X-HealthTrack-Clinical-Coverage')).toContain('typed_records');
  const typed = await labs.GET(request('/api/v1/labs?format=typed', undefined, labToken));
  expect((await typed.json()).records[0].fact.outcome).toEqual({ kind: 'text', text: 'Negative' });
  const records = await import('@/app/api/v1/clinical-records/route');
  const partial = await (
    await records.GET(request('/api/v1/clinical-records', undefined, labToken))
  ).json();
  expect(partial.coverage).toMatchObject({
    included_kinds: ['lab'],
    unavailable_kinds: expect.arrayContaining([
      'medication',
      'medication_event',
      'encounter',
      'screening',
      'procedure',
      'allergy_review',
    ]),
  });
  expect(
    (
      await (
        await records.GET(request('/api/v1/clinical-records?kind=lab', undefined, medToken))
      ).json()
    ).error
  ).toContain('Insufficient');
});
