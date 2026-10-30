import { seedAiConfiguration } from '@/lib/repos/repo-test-harness';
// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  OWNER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
const { identity } = vi.hoisted(() => ({ identity: { id: null as string | null } }));
vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!identity.id) throw new UnauthorizedError();
      return { id: identity.id };
    },
  };
});
vi.mock('@/lib/claude/call', () => ({
  createMessage: vi.fn(async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          visit_date: null,
          provider_name: null,
          results: [{ test_name: 'Synthetic marker', value: 5, unit: 'mg' }],
        }),
      },
    ],
  })),
}));
let ctx: RepoTestDb;
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-import-routes-');
  insertUser(ctx.sqlite, OWNER);
  seedAiConfiguration(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, STRANGER);
  identity.id = OWNER;
});
afterEach(() => ctx.restore());
function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
describe('authoritative import entry points', () => {
  it('detects phone upload bytes despite empty or wrong MIME, then holds an unknown collection date', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'synthetic-placeholder';
    try {
      const { POST } = await import('@/app/api/parse-lab-pdf/route');
      const { createMessage } = await import('@/lib/claude/call');
      for (const declared of ['', 'application/pdf']) {
        const form = new FormData();
        form.append(
          'file',
          new File([new Uint8Array([0xff, 0xd8, 0xff, declared ? 1 : 0])], 'synthetic-phone.jpg', {
            type: declared,
          })
        );
        const response = await POST(
          new NextRequest('http://localhost/api/parse-lab-pdf', { method: 'POST', body: form })
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.parsed.visit_date).toBeNull();
        expect(body.batch.items[0].payload.visit_date).toBeNull();
        const call = vi.mocked(createMessage).mock.calls.at(-1)![2];
        expect(
          (call.messages[0].content as { type: string; source: { media_type: string } }[])[0]
        ).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });
        const { commitImportBatch } = await import('@/lib/import/batches');
        const held = await commitImportBatch(OWNER, body.batch_id, {
          decisions: [{ item_id: body.batch.items[0].id, action: 'add' }],
        });
        expect(held.counts.error).toBe(1);
      }
      expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_visits').get()).toEqual({ n: 0 });
      const form = new FormData();
      form.append('file', new File(['not-a-pdf'], 'synthetic.pdf', { type: 'application/pdf' }));
      const invalid = await POST(
        new NextRequest('http://localhost/api/parse-lab-pdf', { method: 'POST', body: form })
      );
      expect(invalid.status).toBe(415);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
  it('legacy history payload uses staged outcomes and cannot discard different doses by name', async () => {
    const route = await import('@/app/api/import-medical-history/route');
    const one = {
      medications: [
        { name: 'Synthetic medication', dosage: '5 mg', start_date: '2026-01-02', active: true },
      ],
    };
    const first = await route.POST(post('/api/import-medical-history', one));
    expect(first.status).toBe(200);
    await route.POST(post('/api/import-medical-history', one));
    const two = await route.POST(
      post('/api/import-medical-history', {
        medications: [{ ...one.medications[0], dosage: '10 mg' }],
      })
    );
    expect(two.status).toBe(200);
    expect(ctx.sqlite.prepare('SELECT dosage FROM medications ORDER BY dosage').all()).toHaveLength(
      2
    );
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM import_items').get()).toEqual({ n: 2 });
  });
  it('blocks the old standalone lab save for a document with a staged review', async () => {
    const { stageImportBatch } = await import('@/lib/import/batches');
    const batch = await stageImportBatch(OWNER, null, {
      hash: 'synthetic',
      kind: 'labs',
      name: 'synthetic.pdf',
      sourcePath: `${OWNER}/synthetic.pdf`,
      items: [
        {
          domain: 'lab_results',
          payload: { test_name: 'Synthetic', value: 5, visit_date: '2026-01-02' },
        },
      ],
    });
    const { POST } = await import('@/app/api/labs/route');
    const response = await POST(
      post('/api/labs', {
        visit_date: '2026-01-02',
        source_pdf_path: `${OWNER}/synthetic.pdf`,
        results: [{ test_name: 'Synthetic', value: 5 }],
      })
    );
    expect(response.status).toBe(409);
    expect((await response.json()).batch_id).toBe(batch.id);
    expect(ctx.sqlite.prepare('SELECT count(*) n FROM lab_results').get()).toEqual({ n: 0 });
  });
  it('requires session ownership for reading and committing a saved batch', async () => {
    const { stageImportBatch } = await import('@/lib/import/batches');
    const batch = await stageImportBatch(OWNER, null, {
      hash: 'owner-file',
      kind: 'labs',
      name: 'synthetic.pdf',
      items: [],
    });
    const route = await import('@/app/api/import-batches/[id]/route');
    identity.id = STRANGER;
    const denied = await route.POST(post('/api/import-batches/' + batch.id, { decisions: [] }), {
      params: Promise.resolve({ id: batch.id }),
    });
    expect(denied.status).toBe(404);
    identity.id = null;
    const unauth = await route.GET(
      new NextRequest('http://localhost/api/import-batches/' + batch.id),
      { params: Promise.resolve({ id: batch.id }) }
    );
    expect(unauth.status).toBe(401);
  });
});
