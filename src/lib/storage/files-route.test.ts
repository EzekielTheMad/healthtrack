// @vitest-environment node
/**
 * GET /api/files/[...path] — authz on stored uploads.
 *
 * The owning record decides access: a lab_visits row referencing the path
 * carries the scope (owner + dependent) for the labs 'read' check; files no
 * row references are owner-only. Denials are 404 (RLS parity).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertShare,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
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
    getUser: async () =>
      authState.userId ? { id: authState.userId } : null,
  };
});

type RouteModule = typeof import('@/app/api/files/[...path]/route');

let ctx: RepoTestDb;
let route: RouteModule;

const DEPENDENT = crypto.randomUUID();
const PDF = Buffer.from('%PDF-1.4 files-route test');

async function saveFor(ownerId: string): Promise<string> {
  const { saveUpload } = await import('@/lib/storage');
  return saveUpload(ownerId, PDF, { mime: 'application/pdf' });
}

async function referenceInVisit(
  relPath: string,
  dependentId: string | null = null,
): Promise<void> {
  const { createLabVisitWithResults } = await import('@/lib/repos/labs');
  await createLabVisitWithResults(
    OWNER,
    { ownerId: OWNER, dependentId },
    { visitDate: '2026-06-01', sourcePdfPath: relPath, results: [] },
  );
}

function fetchFile(relPath: string) {
  return route.GET(new NextRequest(`http://localhost/api/files/${relPath}`), {
    params: Promise.resolve({ path: relPath.split('/') }),
  });
}

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-files-route-');
  route = await import('@/app/api/files/[...path]/route');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
  insertUser(ctx.sqlite, STRANGER);
  insertDependent(ctx.sqlite, DEPENDENT, OWNER);
  authState.userId = null;
});

afterEach(() => ctx.restore());

describe('GET /api/files/[...path]', () => {
  it('requires authentication', async () => {
    const relPath = await saveFor(OWNER);
    const res = await fetchFile(relPath);
    expect(res.status).toBe(401);
  });

  it('streams the owner their own unreferenced upload with inline headers', async () => {
    const relPath = await saveFor(OWNER);
    authState.userId = OWNER;
    const res = await fetchFile(relPath);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('inline');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('denies a stranger an unreferenced upload with 404 (not 403)', async () => {
    const relPath = await saveFor(OWNER);
    authState.userId = STRANGER;
    const res = await fetchFile(relPath);
    expect(res.status).toBe(404);
  });

  it('grants a viewer with an accepted labs share access to a referenced PDF', async () => {
    const relPath = await saveFor(OWNER);
    await referenceInVisit(relPath);
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['labs'],
    });
    authState.userId = VIEWER;
    const res = await fetchFile(relPath);
    expect(res.status).toBe(200);
  });

  it('denies a viewer whose share lacks the labs section', async () => {
    const relPath = await saveFor(OWNER);
    await referenceInVisit(relPath);
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['medications'],
    });
    authState.userId = VIEWER;
    expect((await fetchFile(relPath)).status).toBe(404);
  });

  it('scopes shares to the exact dependent: owner-scoped share cannot read a dependent visit PDF', async () => {
    const relPath = await saveFor(OWNER);
    await referenceInVisit(relPath, DEPENDENT);
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['labs'],
      dependentId: null, // owner's own data only
    });
    authState.userId = VIEWER;
    expect((await fetchFile(relPath)).status).toBe(404);
  });

  it('grants a dependent-scoped share access to that dependent visit PDF', async () => {
    const relPath = await saveFor(OWNER);
    await referenceInVisit(relPath, DEPENDENT);
    insertShare(ctx.sqlite, {
      ownerId: OWNER,
      sharedWithId: VIEWER,
      sections: ['labs'],
      dependentId: DEPENDENT,
    });
    authState.userId = VIEWER;
    expect((await fetchFile(relPath)).status).toBe(200);
  });

  it('lets the owner read a PDF referenced by their dependent-scoped visit', async () => {
    const relPath = await saveFor(OWNER);
    await referenceInVisit(relPath, DEPENDENT);
    authState.userId = OWNER;
    expect((await fetchFile(relPath)).status).toBe(200);
  });

  it('returns 404 for missing files and traversal probes alike', async () => {
    authState.userId = OWNER;
    expect((await fetchFile(`${OWNER}/nope.pdf`)).status).toBe(404);

    const traversal = await route.GET(
      new NextRequest('http://localhost/api/files/x'),
      { params: Promise.resolve({ path: [OWNER, '..', '..', 'keys', 'auth_secret'] }) },
    );
    expect(traversal.status).toBe(404);

    const tooShort = await route.GET(
      new NextRequest('http://localhost/api/files/x'),
      { params: Promise.resolve({ path: [OWNER] }) },
    );
    expect(tooShort.status).toBe(404);
  });
});
