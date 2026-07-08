/**
 * /api/api-keys — PAT management (owner-only, 013). Response shapes preserved
 * from the pre-drizzle route ({ error: string } errors, key objects without
 * token_hash, plaintext token returned exactly once on create).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth/session';
import { rowToSnake, rowsToSnake } from '@/lib/api/snake';
import { generateApiKey, AVAILABLE_SCOPES } from '@/lib/api-auth';
import {
  AlreadyRevokedError,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '@/lib/repos/api-keys';
import { NotFoundError } from '@/lib/authz';

const VALID_SCOPES = AVAILABLE_SCOPES.map((s) => s.value);

// ---------------------------------------------------------------------------
// GET — List user's API keys (no token_hash)
// ---------------------------------------------------------------------------
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const keys = await listApiKeys(user.id);
    return NextResponse.json(rowsToSnake(keys));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create a new API key
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: { name?: string; scopes?: string[]; expires_at?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, scopes, expires_at } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
    return NextResponse.json(
      { error: 'scopes must be a non-empty array' },
      { status: 400 },
    );
  }

  const invalidScopes = scopes.filter(
    (s) => !VALID_SCOPES.includes(s as (typeof VALID_SCOPES)[number]),
  );
  if (invalidScopes.length > 0) {
    return NextResponse.json(
      { error: `Invalid scopes: ${invalidScopes.join(', ')}` },
      { status: 400 },
    );
  }

  const { token, prefix, hash } = generateApiKey();

  try {
    const key = await createApiKey(user.id, {
      name: name.trim(),
      prefix,
      tokenHash: hash,
      scopes,
      expiresAt: expires_at || null,
    });
    return NextResponse.json({ key: rowToSnake(key), token }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Revoke a key by id (?id=...)
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { error: 'id query parameter is required' },
      { status: 400 },
    );
  }

  try {
    await revokeApiKey(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }
    if (error instanceof AlreadyRevokedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
