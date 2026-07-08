/**
 * /api/notes — session-authenticated notes (replaces the client's direct
 * PostgREST `notes` queries). Notes are create/delete only (no update UI;
 * notes has no updated_at column).
 */
import { collectionHandlers } from '@/lib/api/crud-routes';
import { createNote, listNotes } from '@/lib/repos/notes';

const handlers = collectionHandlers({
  list: (actorId, scope) => listNotes(actorId, scope),
  create: (actorId, scope, input) => createNote(actorId, scope, input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
