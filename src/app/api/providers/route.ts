/**
 * /api/providers — session-authenticated provider CRUD (replaces the client's
 * direct PostgREST `providers` queries).
 */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createProvider, listProviders } from '@/lib/repos/providers';

const handlers = collectionHandlers({
  list: (actorId, scope) => listProviders(actorId, scope),
  create: (actorId, scope, input) => createProvider(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
