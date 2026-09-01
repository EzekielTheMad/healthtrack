/**
 * POST /api/integrations/health-connect/{id}/reprocess-nutrition — rebuild the
 * canonical nutrition rows from the RETAINED raw records (owner-only, session).
 *
 * The gap this closes: approving a source package, switching the nutrition
 * strategy or enabling canonical writes used to affect only the NEXT webhook
 * delivery, so an account could sit on retained records that never became
 * canonical rows. Normalizing what is already stored must never require
 * another sync from the phone.
 *
 * Idempotent by construction — the rebuild is a pure function of the retained
 * raw state, so pressing the button twice produces identical rows.
 *
 * Optional body: `{ "dates": ["YYYY-MM-DD", …] }` to rebuild specific Phoenix
 * days instead of the whole retained history.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { reprocessRetainedNutrition } from '@/lib/integrations/health-connect/rebuild-nutrition';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dates must be YYYY-MM-DD'))
    .max(400)
    .optional(),
});

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;

    let dates: string[] | undefined;
    try {
      const raw = await request.json();
      if (raw && typeof raw === 'object') dates = bodySchema.parse(raw).dates;
    } catch (error) {
      // An absent/empty body means "rebuild everything"; a malformed `dates`
      // array is a real client error and must not be silently ignored.
      if (error instanceof z.ZodError) throw error;
    }

    const report = reprocessRetainedNutrition(user.id, id, { dates });
    return NextResponse.json({
      dates_rebuilt: report.datesRebuilt,
      rows_upserted: report.rowsUpserted,
      rows_deleted: report.rowsDeleted,
      records_considered: report.recordsConsidered,
      records_skipped: report.recordsSkipped,
      errors: report.errors,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 },
      );
    }
    return errorResponse(error);
  }
}
