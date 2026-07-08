/** /api/allergies/[id] — PATCH/DELETE (authz derived from the row's scope). */
import { itemHandlers } from '@/lib/api/crud-routes';
import { deleteAllergy, updateAllergy } from '@/lib/repos/allergies';

const handlers = itemHandlers({
  update: (actorId, id, updates) => updateAllergy(actorId, id, updates),
  remove: (actorId, id) => deleteAllergy(actorId, id),
});

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
