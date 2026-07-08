/** /api/allergies — session-authenticated allergy CRUD. */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createAllergy, listAllergies } from '@/lib/repos/allergies';

const handlers = collectionHandlers({
  list: (actorId, scope) => listAllergies(actorId, scope),
  create: (actorId, scope, input) => createAllergy(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
