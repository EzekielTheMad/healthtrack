/** /api/medications/[id] — PATCH/DELETE (authz derived from the row's scope). */
import { itemHandlers } from '@/lib/api/crud-routes';
import { deleteMedication, updateMedication } from '@/lib/repos/medications';

const handlers = itemHandlers({
  update: (actorId, id, updates) => updateMedication(actorId, id, updates),
  remove: (actorId, id) => deleteMedication(actorId, id),
});

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
