/**
 * /api/vitals — session-authenticated vitals (replaces the client's direct
 * PostgREST `vitals` queries). GET supports ?start_date= / ?end_date=
 * (inclusive recorded_at bounds) in addition to the standard scope params;
 * the PDF export reads without a dependent filter via ?dependent_id=all.
 */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createVital, listVitals } from '@/lib/repos/vitals';

const handlers = collectionHandlers({
  list: (actorId, scope, searchParams) =>
    listVitals(actorId, scope, {
      startDate: searchParams.get('start_date') ?? undefined,
      endDate: searchParams.get('end_date') ?? undefined,
    }),
  create: (actorId, scope, input) => createVital(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
