/**
 * /api/profile — session-authenticated profile access (replaces the client's
 * direct PostgREST `profiles` queries).
 *
 * GET  ?owner_id=<id>  read a profile (own by default; delegates may read
 *                      their owner's profile — authz enforced in the repo)
 * PUT                  upsert the signed-in user's own profile
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getProfile, upsertProfile } from '@/lib/repos/profiles';
import { apiError } from '@/lib/api-error';
import { errorResponse } from '@/lib/api/respond';
import { bodyToCamel, rowToSnake } from '@/lib/api/snake';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const ownerId = request.nextUrl.searchParams.get('owner_id') ?? user.id;
    const profile = await getProfile(user.id, ownerId);
    if (!profile) {
      return apiError(404, 'not_found', 'Profile not found');
    }
    return NextResponse.json(rowToSnake(profile));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = bodyToCamel(await request.json());
    const profile = await upsertProfile(user.id, user.id, body);
    return NextResponse.json(rowToSnake(profile));
  } catch (error) {
    return errorResponse(error);
  }
}
