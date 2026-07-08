/**
 * /api/medications — session-authenticated medication CRUD (replaces the
 * client's direct PostgREST `medications` queries).
 * GET supports ?active=true|false in addition to the standard scope params.
 */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createMedication, listMedications } from '@/lib/repos/medications';

const handlers = collectionHandlers({
  list: (actorId, scope, searchParams) => {
    const activeParam = searchParams.get('active');
    return listMedications(actorId, scope, {
      active: activeParam === null ? undefined : activeParam === 'true',
    });
  },
  create: (actorId, scope, input) => createMedication(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
