/** /api/vaccines — session-authenticated vaccine CRUD. */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createVaccine, listVaccines } from '@/lib/repos/vaccines';

const handlers = collectionHandlers({
  list: (actorId, scope) => listVaccines(actorId, scope),
  create: (actorId, scope, input) => createVaccine(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
