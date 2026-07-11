/**
 * POST /api/lab-warning-dismissals — dismiss lab-derived AI warning cards
 * until newer lab data is imported (fitness-domain spec §AI integration #3).
 *
 * Body: { tests: string[] } — the labTests array from the highlight being
 * dismissed. The server normalizes the names and stamps the user's latest
 * lab visit date itself; nothing date-shaped is trusted from the client.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { safeError } from '@/lib/safe-log';
import {
  dismissLabWarnings,
  NoLabDataError,
} from '@/lib/repos/lab-warning-dismissals';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return apiError(401, 'unauthorized', 'Authentication required');
    }
    throw err;
  }

  let tests: unknown;
  try {
    const body = await request.json();
    tests = body.tests;
  } catch {
    return apiError(400, 'invalid_body', 'Invalid JSON request body');
  }

  try {
    const result = await dismissLabWarnings(userId, tests);
    return NextResponse.json({ dismissed: result.keys, labVisitDate: result.labVisitDate });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return apiError(400, 'invalid_tests', 'tests must be a non-empty array of test names');
    }
    if (err instanceof NoLabDataError) {
      return apiError(400, 'no_lab_data', err.message);
    }
    safeError('Lab warning dismissal error', err);
    return apiError(500, 'internal_error', 'Failed to dismiss lab warning');
  }
}
