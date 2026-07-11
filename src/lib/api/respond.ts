/**
 * Shared error → HTTP response mapping for session-authenticated API routes.
 *
 *   UnauthorizedError (no session)        → 401
 *   NotFoundError (authz denial / no row) → 404 (RLS-parity: never 403)
 *   VitalWriteError (registry validation) → 400 (message is API-ready)
 *   FitnessWriteError (fitness repos)     → 400 (message is API-ready)
 *   FitnessConflictError (dedupe/goals)   → 409 (message names the conflict)
 *   ZodError (repo boundary validation)   → 400
 *   anything else                         → 500 (logged, message withheld)
 */
import type { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { UnauthorizedError } from '@/lib/auth/session';
import { NotFoundError } from '@/lib/authz';
import { VitalWriteError } from '@/lib/repos/vitals';
import { FitnessWriteError, FitnessConflictError } from '@/lib/repos/_fitness';
import { apiError } from '@/lib/api-error';
import type { ApiError } from '@/lib/types';

export function errorResponse(error: unknown): NextResponse<ApiError> {
  if (error instanceof UnauthorizedError) {
    return apiError(401, 'unauthorized', 'You must be signed in.');
  }
  if (error instanceof NotFoundError) {
    return apiError(404, 'not_found', 'Not found');
  }
  if (error instanceof VitalWriteError || error instanceof FitnessWriteError) {
    return apiError(400, 'validation_error', error.message);
  }
  if (error instanceof FitnessConflictError) {
    return apiError(409, 'conflict', error.message);
  }
  if (error instanceof ZodError) {
    const message = error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    return apiError(400, 'validation_error', message);
  }
  console.error('API route error:', error);
  return apiError(500, 'internal_error', 'An unexpected error occurred.');
}
