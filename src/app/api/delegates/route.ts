/**
 * /api/delegates — delegate invitation management. Wire shapes preserved:
 * GET ?type=sent|received, POST invite (400 self-invite, 409 duplicate),
 * PATCH { id, action: accept|reject|update_permission, permission_level? },
 * DELETE ?id= (owner only). Meta-authorization lives in the delegates repo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { rowToSnake, rowsToSnake } from '@/lib/api/snake';
import {
  DELEGATE_PERMISSION_LEVELS,
  DuplicateDelegateError,
  acceptDelegate,
  createDelegateInvite,
  deleteDelegate,
  listReceivedDelegates,
  listSentDelegates,
  rejectDelegate,
  updateDelegatePermission,
  type DelegatePermissionLevel,
} from '@/lib/repos/delegates';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const type = request.nextUrl.searchParams.get('type') ?? 'sent';

    if (type === 'sent') {
      return NextResponse.json(rowsToSnake(await listSentDelegates(user.id)));
    }
    if (type === 'received') {
      return NextResponse.json(
        rowsToSnake(await listReceivedDelegates(user.id, user.email ?? null)),
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
    const body = (await request.json()) as {
      delegate_email?: string;
      permission_level?: string;
      expires_at?: string;
    };
    const { delegate_email, permission_level, expires_at } = body;

    if (!delegate_email || !permission_level) {
      return apiError(
        400,
        'validation_error',
        'Email and permission level are required',
      );
    }

    if (
      !DELEGATE_PERMISSION_LEVELS.includes(
        permission_level as DelegatePermissionLevel,
      )
    ) {
      return apiError(
        400,
        'validation_error',
        'Permission level must be "read_only", "read_write", or "admin"',
      );
    }

    if (delegate_email.toLowerCase() === user.email?.toLowerCase()) {
      return apiError(
        400,
        'validation_error',
        'You cannot grant delegate access to yourself',
      );
    }

    const row = await createDelegateInvite(user.id, {
      delegateEmail: delegate_email,
      permissionLevel: permission_level,
      expiresAt: expires_at,
    });
    return NextResponse.json(rowToSnake(row), { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateDelegateError) {
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
      permission_level?: string;
    };
    const { id, action, permission_level } = body;

    if (!id || !action) {
      return apiError(400, 'validation_error', 'Delegate id and action are required');
    }

    if (action === 'accept') {
      const updated = await acceptDelegate(user.id, user.email ?? null, id);
      return NextResponse.json(rowToSnake(updated));
    }

    if (action === 'reject') {
      const updated = await rejectDelegate(user.id, user.email ?? null, id);
      return NextResponse.json(rowToSnake(updated));
    }

    if (action === 'update_permission') {
      if (
        !permission_level ||
        !DELEGATE_PERMISSION_LEVELS.includes(
          permission_level as DelegatePermissionLevel,
        )
      ) {
        return apiError(400, 'validation_error', 'Valid permission level is required');
      }
      const updated = await updateDelegatePermission(user.id, id, permission_level);
      return NextResponse.json(rowToSnake(updated));
    }

    return apiError(
      400,
      'validation_error',
      'Action must be "accept", "reject", or "update_permission"',
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
      return apiError(400, 'validation_error', 'Delegate id is required');
    }
    await deleteDelegate(user.id, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
