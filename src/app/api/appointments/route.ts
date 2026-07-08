/**
 * /api/appointments — session-authenticated appointment CRUD (replaces the
 * client's direct PostgREST `appointments` queries).
 */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createAppointment, listAppointments } from '@/lib/repos/appointments';

const handlers = collectionHandlers({
  list: (actorId, scope) => listAppointments(actorId, scope),
  create: (actorId, scope, input) => createAppointment(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
