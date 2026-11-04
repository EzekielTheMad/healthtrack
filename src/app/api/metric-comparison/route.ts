import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { scopeFromParams } from '@/lib/repos/_scope';
import { buildMetricComparison, comparisonDaysSchema } from '@/lib/metrics/comparison';

const scopeSchema = z.object({
  owner_id: z.string().trim().min(1).max(200).optional(),
  dependent_id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((id) => id !== 'all', 'Choose one person for comparison.')
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    for (const name of ['days', 'owner_id', 'dependent_id']) {
      z.array(z.string()).max(1, `Only one ${name} is allowed.`).parse(params.getAll(name));
    }
    const requested = scopeSchema.parse({
      owner_id: params.get('owner_id') ?? undefined,
      dependent_id: params.get('dependent_id') ?? undefined,
    });
    if (requested.owner_id && requested.owner_id !== user.id && requested.dependent_id) {
      return NextResponse.json(
        {
          error: 'validation_error',
          message: 'Choose the owner or one of your dependent profiles separately.',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    const days = comparisonDaysSchema.parse(params.get('days') ?? 30);
    const result = await buildMetricComparison(user.id, scopeFromParams(user.id, params), days);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
