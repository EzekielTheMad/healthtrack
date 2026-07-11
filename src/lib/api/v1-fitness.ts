/**
 * Shared plumbing for the fitness-domain /api/v1 routes (workouts, exercises,
 * checkins, weeks, goals) — PAT auth + scope gate, JSON body parsing, and the
 * repo-error → HTTP mapping from the fitness design spec §Error handling:
 *
 *   FitnessWriteError / VitalWriteError → 400 { error }
 *   FitnessConflictError               → 409 { error, existing_id? }
 *   NotFoundError (authz/ownership)    → 404 { error: 'Not found' }
 *   anything else                      → 500 { error: 'internal_error' }
 *                                        (never reflect internals — respond.ts policy)
 *
 * Follows the conventions of src/app/api/v1/vitals/route.ts exactly: bearer
 * PAT via validateApiKey, hasScope with read:all/write:all fallthrough,
 * wildcard CORS with per-route method lists.
 */
import type { NextRequest } from 'next/server';
import {
  validateApiKey,
  hasScope,
  unauthorized,
  forbidden,
  type ApiKeyContext,
} from '@/lib/api-auth';
import { FitnessWriteError, FitnessConflictError } from '@/lib/repos/_fitness';
import { VitalWriteError } from '@/lib/repos/vitals';
import { NotFoundError } from '@/lib/authz';

/** Wildcard CORS headers for a v1 route's method list, e.g. 'GET, POST, OPTIONS'. */
export function corsHeaders(methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

/**
 * Validate the bearer PAT and require a scope. Returns the key context, or a
 * ready 401/403 Response — callers do `if (auth instanceof Response) return auth`.
 */
export async function requirePat(
  request: NextRequest,
  scope: string,
): Promise<ApiKeyContext | Response> {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, scope)) return forbidden(scope);
  return ctx;
}

/** Parse the JSON request body; a 400 Response for malformed JSON. */
export async function readJsonBody(
  request: NextRequest,
  headers: Record<string, string>,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: Response.json(
        { error: 'Request body must be valid JSON' },
        { status: 400, headers },
      ),
    };
  }
}

/** Map a repo-layer error to its HTTP response (see module doc). */
export function fitnessErrorResponse(
  error: unknown,
  headers: Record<string, string>,
  logLabel: string,
): Response {
  if (error instanceof FitnessWriteError || error instanceof VitalWriteError) {
    return Response.json({ error: error.message }, { status: 400, headers });
  }
  if (error instanceof FitnessConflictError) {
    return Response.json(
      {
        error: error.message,
        ...(error.existingId ? { existing_id: error.existingId } : {}),
      },
      { status: 409, headers },
    );
  }
  if (error instanceof NotFoundError) {
    return Response.json({ error: 'Not found' }, { status: 404, headers });
  }
  // Never reflect internal error details to API clients (respond.ts policy).
  console.error(`${logLabel} error:`, error);
  return Response.json({ error: 'internal_error' }, { status: 500, headers });
}

/** Clamp an integer query param to [1, max] with a default — negative/zero
    values must never become "unlimited" (SQLite LIMIT -1 semantics). */
export function clampLimit(raw: string | null, fallback: number, max: number): number {
  const parsed = parseInt(raw ?? '', 10);
  return Math.min(Math.max(1, Number.isNaN(parsed) ? fallback : parsed), max);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize an inclusive `?to=` bound against ISO-timestamp columns: a plain
    day means "through the end of that day", so extend it past any timestamp
    on that date. Full datetimes pass through unchanged. */
export function inclusiveDayUpperBound(to: string): string {
  return ISO_DAY.test(to) ? `${to}T23:59:59.999Z` : to;
}
