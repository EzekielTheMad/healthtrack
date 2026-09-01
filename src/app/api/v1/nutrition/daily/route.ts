/**
 * GET /api/v1/nutrition/daily — canonical daily actual intake.
 *
 * Reads ONLY the nutrition_daily snapshot table, never the raw webhook
 * history (PRD §6.7). Self-scope only: a PAT resolves to exactly one user.
 *
 * Query: ?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&source_package=&limit=
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { listNutritionDaily } from '@/lib/repos/nutrition';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const ctx = await validateApiKey(request.headers.get('Authorization'));
  if (!ctx) return unauthorized();
  if (!hasScope(ctx, 'read:nutrition')) return forbidden('read:nutrition');

  const { searchParams } = request.nextUrl;
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10);

  try {
    const rows = await listNutritionDaily(ctx.userId, {
      startDate: searchParams.get('start_date') ?? undefined,
      endDate: searchParams.get('end_date') ?? undefined,
      sourcePackage: searchParams.get('source_package') ?? undefined,
      limit: Number.isNaN(rawLimit) ? undefined : rawLimit,
    });

    return Response.json(
      rows.map((r) => ({
        date: r.date,
        source_package: r.sourcePackage,
        calories: r.calories,
        protein_grams: r.proteinGrams,
        carbs_grams: r.carbsGrams,
        fat_grams: r.fatGrams,
        fiber_grams: r.fiberGrams,
        sugar_grams: r.sugarGrams,
        sodium_milligrams: r.sodiumMilligrams,
        record_count: r.recordCount,
        updated_at: r.updatedAt,
      })),
      { headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? 'Invalid query parameters' },
        { status: 400, headers: corsHeaders },
      );
    }
    // Never reflect internal error details to API clients (respond.ts policy).
    console.error('v1 nutrition daily GET error:', error);
    return Response.json({ error: 'internal_error' }, { status: 500, headers: corsHeaders });
  }
}
