/**
 * GET /api/invites/validate?token=… — pre-flight check used by the signup
 * form to show a friendly state before the user fills anything in.
 *
 * Public by necessity (the visitor has no account yet), so it is a token
 * oracle: rate-limited per client to blunt enumeration, and tokens are
 * 192-bit random so brute force is hopeless anyway. Returns only a boolean.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';
import { isInviteValid } from '@/lib/repos/invites';

export async function GET(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit(`invite-validate:${ip}`, { max: 30, windowMs: HOUR_MS })) {
    return apiError(429, 'rate_limited', 'Too many attempts. Please try again later.');
  }
  const token = request.nextUrl.searchParams.get('token') ?? '';
  return NextResponse.json({ valid: await isInviteValid(token) });
}
