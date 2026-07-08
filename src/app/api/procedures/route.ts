/** /api/procedures — session-authenticated procedure CRUD. */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createProcedure, listProcedures } from '@/lib/repos/procedures';

const handlers = collectionHandlers({
  list: (actorId, scope) => listProcedures(actorId, scope),
  create: (actorId, scope, input) => createProcedure(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
