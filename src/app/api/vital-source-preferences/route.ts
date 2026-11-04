import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { getMetric } from '@/lib/metrics/registry';
import {
  listVitalSourcePreferences,
  setVitalSourcePreference,
  deleteVitalSourcePreference,
} from '@/lib/repos/vitals';

const input = z
  .object({
    metric_key: z
      .string()
      .min(1)
      .max(100)
      .refine((key) => !!getMetric(key), 'Unknown metric'),
    preferred_source: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await listVitalSourcePreferences(user.id);
    return NextResponse.json(
      Object.fromEntries(rows.map((row) => [row.metricKey, row.preferredSource]))
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = input
      .required({ preferred_source: true })
      .parse(await request.json().catch(() => null));
    await setVitalSourcePreference(user.id, body.metric_key, body.preferred_source);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = input.parse(await request.json().catch(() => null));
    await deleteVitalSourcePreference(user.id, body.metric_key);
    return NextResponse.json({ saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
