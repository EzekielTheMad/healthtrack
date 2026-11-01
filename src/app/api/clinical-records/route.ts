import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { scopeFromParams } from '@/lib/repos/_scope';
import { listClinicalFacts } from '@/lib/fidelity/clinical';
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    const kind = z
      .enum(['lab', 'medication', 'medication_event'])
      .optional()
      .parse(params.get('kind') ?? undefined);
    const records = await listClinicalFacts(user.id, scopeFromParams(user.id, params), {
      kind,
      limit: Math.min(1000, Math.max(1, Number(params.get('limit')) || 200)),
    });
    return NextResponse.json({
      format: 'typed',
      records,
      coverage: {
        limit: Math.min(1000, Math.max(1, Number(params.get('limit')) || 200)),
        legacy_receipt: 'unknown',
        warning:
          'Legacy originals with typed corrections are replaced by their overlays; conflicts show both versions. Numeric default APIs omit all superseded originals.',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
