/** /api/conditions/[id] — PATCH/DELETE (authz derived from the row's scope). */
import { itemHandlers } from '@/lib/api/crud-routes';
import { deleteCondition, updateCondition } from '@/lib/repos/conditions';

const handlers = itemHandlers({
  update: (actorId, id, updates) => updateCondition(actorId, id, updates),
  remove: (actorId, id) => deleteCondition(actorId, id),
});

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
