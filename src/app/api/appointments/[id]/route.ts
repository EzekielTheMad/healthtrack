/** /api/appointments/[id] — PATCH/DELETE (authz derived from the row's scope). */
import { itemHandlers } from '@/lib/api/crud-routes';
import { deleteAppointment, updateAppointment } from '@/lib/repos/appointments';

const handlers = itemHandlers({
  update: (actorId, id, updates) => updateAppointment(actorId, id, updates),
  remove: (actorId, id) => deleteAppointment(actorId, id),
});

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
