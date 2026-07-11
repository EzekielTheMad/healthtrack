/**
 * /api/exercises — session-authenticated exercise catalog listing for the UI
 * (trends picker + unreviewed-cleanup card). Supports ?review_status= and the
 * standard ?owner_id= delegate scoping. The catalog is strictly per-user, so
 * no dependent filter applies. Writes: PATCH lives at /api/exercises/{id};
 * catalog rows are otherwise created implicitly by workout writes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { deepToSnake } from '@/lib/api/snake';
import { scopeFromParams } from '@/lib/repos/_scope';
import { listExercises } from '@/lib/repos/exercises';
import { EXERCISE_REVIEW_STATUSES, type ExerciseReviewStatus } from '@/db/schema';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    const scope = scopeFromParams(user.id, params);
    const status = params.get('review_status');
    const rows = await listExercises(user.id, scope.ownerId, {
      reviewStatus: EXERCISE_REVIEW_STATUSES.includes(status as ExerciseReviewStatus)
        ? (status as ExerciseReviewStatus)
        : undefined,
    });
    // Deep conversion — exercise rows carry the aliases array (fitness convention).
    return NextResponse.json(deepToSnake(rows));
  } catch (error) {
    return errorResponse(error);
  }
}
