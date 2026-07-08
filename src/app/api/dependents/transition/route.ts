/**
 * POST /api/dependents/transition — transition a dependent to an independent
 * user. Semantics preserved from the pre-drizzle route: mark transitioned +
 * create a dependent-scoped read-only health_share invitation (the repo does
 * both atomically). Response payload text is unchanged.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import {
  AlreadyTransitionedError,
  transitionDependent,
} from '@/lib/repos/dependents';

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      dependent_id?: string;
      new_user_email?: string;
    };
    const { dependent_id, new_user_email } = body;

    if (!dependent_id || !new_user_email) {
      return apiError(
        400,
        'validation_error',
        'dependent_id and new_user_email are required',
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(new_user_email)) {
      return apiError(400, 'validation_error', 'Invalid email address');
    }

    const { shareToken } = await transitionDependent(
      user.id,
      dependent_id,
      new_user_email,
    );

    return NextResponse.json({
      success: true,
      message:
        'Dependent has been marked as transitioned. A health share invitation has been created for the new user.',
      instructions:
        'The dependent should create their own HealthTrack account using the provided email address. Once signed in, they can accept the health share invitation to access their historical health data.',
      share_token: shareToken,
    });
  } catch (error) {
    if (error instanceof AlreadyTransitionedError) {
      return apiError(409, 'already_transitioned', error.message);
    }
    return errorResponse(error);
  }
}
