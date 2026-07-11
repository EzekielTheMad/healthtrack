import { NextRequest } from 'next/server';
import { EXERCISE_REVIEW_STATUSES, type ExerciseReviewStatus } from '@/db/schema';
import { deepBodyToCamel, deepToSnake } from '@/lib/api/snake';
import {
  corsHeaders,
  fitnessErrorResponse,
  readJsonBody,
  requirePat,
} from '@/lib/api/v1-fitness';
import { createExercise, listExercises } from '@/lib/repos/exercises';

const cors = corsHeaders('GET, POST, OPTIONS');

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}

/** GET /api/v1/exercises?review_status — the owner's catalog, name ascending.
    `review_status=unreviewed` surfaces auto-created drift for cleanup. */
export async function GET(request: NextRequest) {
  const auth = await requirePat(request, 'read:fitness');
  if (auth instanceof Response) return auth;

  const reviewStatus = request.nextUrl.searchParams.get('review_status');
  if (
    reviewStatus !== null &&
    !(EXERCISE_REVIEW_STATUSES as readonly string[]).includes(reviewStatus)
  ) {
    return Response.json(
      {
        error: `Unknown review_status '${reviewStatus}' — must be one of: ${EXERCISE_REVIEW_STATUSES.join(', ')}.`,
      },
      { status: 400, headers: cors },
    );
  }

  try {
    const rows = await listExercises(auth.userId, auth.userId, {
      reviewStatus: (reviewStatus as ExerciseReviewStatus | null) ?? undefined,
    });
    return Response.json(rows.map(deepToSnake), { headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 exercises GET');
  }
}

/** POST /api/v1/exercises — create a catalog entry. 400 when the name or an
    alias collides (case-insensitively) with an existing name/alias. */
export async function POST(request: NextRequest) {
  const auth = await requirePat(request, 'write:fitness');
  if (auth instanceof Response) return auth;
  const parsed = await readJsonBody(request, cors);
  if (!parsed.ok) return parsed.response;
  try {
    const row = await createExercise(auth.userId, auth.userId, deepBodyToCamel(parsed.body));
    return Response.json(deepToSnake(row), { status: 201, headers: cors });
  } catch (error) {
    return fitnessErrorResponse(error, cors, 'v1 exercises POST');
  }
}
