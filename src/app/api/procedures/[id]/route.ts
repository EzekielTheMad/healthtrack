/** /api/procedures/[id] — PATCH/DELETE (authz derived from the row's scope). */
import { itemHandlers } from '@/lib/api/crud-routes';
import { deleteProcedure, updateProcedure } from '@/lib/repos/procedures';

const handlers = itemHandlers({
  update: (actorId, id, updates) => updateProcedure(actorId, id, updates),
  remove: (actorId, id) => deleteProcedure(actorId, id),
});

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
