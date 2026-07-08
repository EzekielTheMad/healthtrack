import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { rowsToSnake } from '@/lib/api/snake';
import {
  getShareByToken,
  getShareDisplayName,
  listSharedData,
} from '@/lib/repos/shares';

// Best-effort in-memory rate limiter to slow down token enumeration on this
// unauthenticated endpoint. 30 requests / IP / minute. In a multi-instance
// deploy this is per-instance — accept that as a floor rather than no limit
// at all. A future improvement would use a shared store.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const ipHits = new Map<string, number[]>();

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

function rateLimitExceeded(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  // Opportunistic cleanup so the map doesn't grow forever in a long-lived process
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) {
      const fresh = v.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length === 0) ipHits.delete(k);
      else ipHits.set(k, fresh);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET /api/share/public?token=<share_token>
// Unauthenticated endpoint: the token is the credential. Token → share row
// (must be accepted + unexpired) → the shares repo reads each shared section
// under the share's exact owner/dependent scope (trusted path — it never
// widens authorize()).
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  if (rateLimitExceeded(clientIp(request))) {
    return apiError(429, 'rate_limited', 'Too many requests. Please try again shortly.');
  }

  const token = request.nextUrl.searchParams.get('token');

  // Share tokens are crypto.randomUUID() — reject anything that doesn't look
  // like a UUID before touching the database.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!token || !uuidRe.test(token)) {
    return apiError(400, 'validation_error', 'token is required');
  }

  const share = await getShareByToken(token);

  if (!share) {
    return apiError(404, 'not_found', 'Share not found or link is invalid');
  }

  if (!share.accepted) {
    return apiError(403, 'not_accepted', 'This share has not been accepted yet');
  }

  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return apiError(410, 'expired', 'This share link has expired');
  }

  const [ownerName, sectionData] = await Promise.all([
    getShareDisplayName(share),
    listSharedData(share),
  ]);

  const data: Record<string, unknown[]> = {};
  for (const [section, rows] of Object.entries(sectionData)) {
    data[section] = rowsToSnake(rows);
  }

  return NextResponse.json({
    share: {
      id: share.id,
      owner_id: share.ownerId,
      owner_name: ownerName,
      access_level: share.accessLevel,
      shared_sections: share.sharedSections,
      expires_at: share.expiresAt,
      created_at: share.createdAt,
    },
    data,
  });
}
