/**
 * Shared column helpers for the HealthTrack schema.
 *
 * Translation conventions (from the legacy Postgres migrations → SQLite):
 *   uuid PK        → text PK, crypto.randomUUID()
 *   timestamptz    → text ISO-8601 string
 *   date           → text ISO date string (YYYY-MM-DD)
 *   numeric        → real
 *   boolean        → integer {mode:'boolean'}
 *   jsonb / text[] → text {mode:'json'}
 *   check-in list  → text {enum} (+ zod validation at the repository boundary)
 */
import { text } from 'drizzle-orm/sqlite-core';

export const isoNow = () => new Date().toISOString();

/** uuid primary key default gen_random_uuid() */
export const uuidPk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** timestamptz not null default now() */
export const timestampNow = (name: string) =>
  text(name).notNull().$defaultFn(isoNow);
