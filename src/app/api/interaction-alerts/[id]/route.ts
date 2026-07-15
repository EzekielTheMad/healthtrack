/**
 * PATCH /api/interaction-alerts/[id] — snooze an alert for a number of days
 * (body: { snooze_days: 1 | 7 | 30 }, clamped to the severity cap in the repo).
 * Owner-only; a non-owner snooze is a silent no-op success (RLS parity — the
 * update matched 0 rows and still reported success).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { apiError } from '@/lib/api-error';
import { snoozeInteractionAlert } from '@/lib/repos/interaction-alerts';

const ALLOWED_DAYS = new Set([1, 7, 30]);

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const body = await request.json().catch(() => ({}));
    const days = Number((body as { snooze_days?: unknown }).snooze_days);
    if (!ALLOWED_DAYS.has(days)) {
      return apiError(400, 'invalid_snooze', 'snooze_days must be 1, 7, or 30');
    }

    const snoozedUntil = await snoozeInteractionAlert(user.id, id, days);
    return NextResponse.json({ success: true, snoozed_until: snoozedUntil });
  } catch (error) {
    return errorResponse(error);
  }
}
