/** /api/vaccines/[id] — PATCH/DELETE (authz derived from the row's scope). */
import { itemHandlers } from '@/lib/api/crud-routes';
import { deleteVaccine, updateVaccine } from '@/lib/repos/vaccines';

const handlers = itemHandlers({
  update: (actorId, id, updates) => updateVaccine(actorId, id, updates),
  remove: (actorId, id) => deleteVaccine(actorId, id),
});

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
