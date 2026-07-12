/**
 * POST /api/v1/health-summary/refresh — PAT-authenticated cache warm.
 *
 * A daily Unraid cron POSTs this with the owner's personal access token to
 * precompute the dashboard AI Health Overview before the owner looks, so the
 * dashboard is instant. It regenerates the summary and upserts today's
 * (owner-local) cache row unconditionally — running it twice simply refreshes.
 *
 * Auth: the same PAT layer as the other /api/v1 routes (Bearer ohts_pat_...).
 * Because this triggers a write (cache upsert) plus an expensive model call, it
 * requires one of the broad account scopes — write:all or read:all.
 */
import { NextRequest } from 'next/server';
import { validateApiKey, unauthorized, forbidden } from '@/lib/api-auth';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { generateAndCacheSummary, ownerLocalDayKey } from '@/lib/claude/summary-cache';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  // Broad-scope gate: write:all (a mutation) or read:all (the summary product).
  if (!ctx.scopes.includes('write:all') && !ctx.scopes.includes('read:all')) {
    return forbidden('write:all');
  }

  if (!getCapabilities().ai) {
    return Response.json({ error: AI_NOT_CONFIGURED }, { status: 501, headers: corsHeaders });
  }

  try {
    const date = ownerLocalDayKey();
    const { cached } = await generateAndCacheSummary(ctx.userId);
    // `cached` is false only when the owner has no data to summarize yet (the
    // welcome message is intentionally never cached).
    return Response.json({ generated: cached, date }, { headers: corsHeaders });
  } catch (error) {
    // Never reflect internal error details to API clients (respond.ts policy).
    console.error('v1 health-summary refresh error:', error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
