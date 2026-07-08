/**
 * /api/share — share invitation management. Wire shapes preserved from the
 * pre-drizzle route: GET ?type=sent|received, POST create (400 self-share,
 * 409 duplicate), PATCH { id, action: accept|revoke|update, ... },
 * DELETE ?id= (owner only). Meta-authorization lives in the shares repo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { bodyToCamel, rowToSnake, rowsToSnake } from '@/lib/api/snake';
import {
  DuplicateShareError,
  acceptShare,
  createShare,
  deleteShare,
  listReceivedShares,
  listSentShares,
  revokeShare,
  updateShare,
} from '@/lib/repos/shares';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const type = request.nextUrl.searchParams.get('type') ?? 'sent';

    if (type === 'sent') {
      return NextResponse.json(rowsToSnake(await listSentShares(user.id)));
    }
    if (type === 'received') {
      return NextResponse.json(
        rowsToSnake(await listReceivedShares(user.id, user.email ?? null)),
      );
    }
    return apiError(400, 'validation_error', 'Type must be "sent" or "received"');
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = bodyToCamel(await request.json());

    if (
      typeof body.sharedWithEmail === 'string' &&
      body.sharedWithEmail.toLowerCase() === user.email?.toLowerCase()
    ) {
      return apiError(
        400,
        'validation_error',
        'You cannot share health data with yourself',
      );
    }

    const row = await createShare(user.id, body);
    return NextResponse.json(rowToSnake(row), { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateShareError) {
      return apiError(409, 'duplicate', error.message);
    }
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      id?: string;
      action?: string;
      access_level?: string;
      shared_sections?: string[];
    };
    const { id, action } = body;

    if (!id || !action) {
      return apiError(400, 'validation_error', 'Share id and action are required');
    }

    if (action === 'accept') {
      const updated = await acceptShare(user.id, user.email ?? null, id);
      return NextResponse.json(rowToSnake(updated));
    }

    if (action === 'revoke') {
      await revokeShare(user.id, user.email ?? null, id);
      return NextResponse.json({ success: true });
    }

    if (action === 'update') {
      const updates: Record<string, unknown> = {};
      if (
        body.access_level &&
        ['read', 'read_write'].includes(body.access_level)
      ) {
        updates.accessLevel = body.access_level;
      }
      if (body.shared_sections && body.shared_sections.length > 0) {
        updates.sharedSections = body.shared_sections;
      }
      if (Object.keys(updates).length === 0) {
        return apiError(400, 'validation_error', 'No valid updates provided');
      }
      const updated = await updateShare(user.id, id, updates);
      return NextResponse.json(rowToSnake(updated));
    }

    return apiError(
      400,
      'validation_error',
      'Action must be "accept", "revoke", or "update"',
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser();
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return apiError(400, 'validation_error', 'Share id is required');
    }
    await deleteShare(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
