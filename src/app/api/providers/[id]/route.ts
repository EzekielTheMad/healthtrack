/** /api/providers/[id] — PATCH/DELETE (authz derived from the row's scope). */
import { itemHandlers } from '@/lib/api/crud-routes';
import { deleteProvider, updateProvider } from '@/lib/repos/providers';

const handlers = itemHandlers({
  update: (actorId, id, updates) => updateProvider(actorId, id, updates),
  remove: (actorId, id) => deleteProvider(actorId, id),
});

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
