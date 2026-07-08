/**
 * HealthTrack Drizzle schema — translated from the legacy SQL migrations 001–014.
 *
 * Not translated here (by design):
 *   002 seed data            → src/db/seed-reference-ranges.ts
 *   003/012/014 RLS policies → src/lib/authz (Phase 3)
 *   009 delete RPC           → src/lib/auth/delete-account (Phase 2)
 *   010 storage bucket       → src/lib/storage (Phase 5)
 *
 * Better Auth tables: `user` below is a minimal placeholder; Phase 2 adds
 * session/account/verification via `npx @better-auth/cli generate`.
 */
export * from './auth';
export * from './users';
export * from './clinical';
export * from './vitals';
export * from './sharing';
export * from './integrations';
export * from './system';
