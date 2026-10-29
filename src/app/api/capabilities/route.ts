/**
 * GET /api/capabilities — which optional features this instance has enabled.
 *
 * Deliberately unauthenticated: the login page needs googleAuth and
 * signupsEnabled before any session exists. Returns four booleans only —
 * no secrets, no config values.
 */
import { NextResponse } from 'next/server';
import { getCapabilities } from '@/lib/capabilities';
import { getUser } from '@/lib/auth/session';
import { hasAiConfiguration } from '@/lib/ai/settings';

// Env is read at request time (the Docker image is built without these vars).
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getUser();
  return NextResponse.json(getCapabilities(user ? hasAiConfiguration(user.id) : false), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
