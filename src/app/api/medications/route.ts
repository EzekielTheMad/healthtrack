/**
 * /api/medications — session-authenticated medication CRUD (replaces the
 * client's direct PostgREST `medications` queries).
 * GET supports ?active=true|false in addition to the standard scope params.
 */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createMedication, listMedications } from '@/lib/repos/medications';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { errorResponse } from '@/lib/api/respond';
import { scopeFromParams } from '@/lib/repos/_scope';
import { rowsToSnake } from '@/lib/api/snake';
import { clinicalProjectionCoverage, listClinicalFacts } from '@/lib/fidelity/clinical';

const handlers = collectionHandlers({
  list: (actorId, scope, searchParams) => {
    const activeParam = searchParams.get('active');
    return listMedications(actorId, scope, {
      active: activeParam === null ? undefined : activeParam === 'true',
    });
  },
  create: (actorId, scope, input) => createMedication(actorId, scope, input),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const params = request.nextUrl.searchParams;
    const scope = scopeFromParams(user.id, params);
    if (params.get('format') === 'typed')
      return NextResponse.json({
        format: 'typed',
        records: await listClinicalFacts(user.id, scope, { kind: 'medication' }),
        coverage: {
          warning: 'Prescribed, reported actual use, status and date precision are independent.',
        },
      });
    const active = params.get('active');
    return NextResponse.json(
      rowsToSnake(
        await listMedications(user.id, scope, {
          active: active === null ? undefined : active === 'true',
        })
      ),
      {
        headers: {
          'X-HealthTrack-Clinical-Coverage': JSON.stringify(
            await clinicalProjectionCoverage(user.id, scope, 'medication')
          ),
          Link: '</api/medications?format=typed>; rel="alternate"',
        },
      }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export const POST = handlers.POST;
