import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth/session";
import type { ApiError } from "@/lib/types";

/**
 * Build a JSON `NextResponse` that matches the `ApiError` shape.
 */
export function apiError(
  status: number,
  error: string,
  message: string,
): NextResponse<ApiError> {
  return NextResponse.json({ error, message, status }, { status });
}

type RouteHandler = (
  request: Request,
  context: { userId: string },
) => Promise<NextResponse> | NextResponse;

/**
 * Higher-order function that wraps an API route handler with Better Auth
 * session validation. If the session is missing or the user cannot be
 * retrieved, a 401 response is returned automatically.
 *
 * Usage:
 * ```ts
 * export const GET = withAuth(async (request, { userId }) => {
 *   // userId is guaranteed to be a valid authenticated user id
 *   return NextResponse.json({ ok: true });
 * });
 * ```
 */
export function withAuth(handler: RouteHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const user = await getUser();

    if (!user) {
      return apiError(401, "unauthorized", "You must be signed in.");
    }

    return handler(request, { userId: user.id });
  };
}
