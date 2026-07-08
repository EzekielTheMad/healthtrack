/** /api/conditions — session-authenticated condition CRUD. */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createCondition, listConditions } from '@/lib/repos/conditions';

const handlers = collectionHandlers({
  list: (actorId, scope) => listConditions(actorId, scope),
  create: (actorId, scope, input) => createCondition(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
