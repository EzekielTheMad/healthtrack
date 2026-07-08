/**
 * Next.js server-boot hook: applies pending database migrations before the
 * server accepts requests (`register` runs once per server instance — dev
 * server and `next start`/standalone alike; it does NOT run during
 * `next build`).
 *
 * The Docker entrypoint also runs db-migrate.js before starting the server
 * (fail-fast with clearer logs); this hook makes bare `npm run dev` /
 * `node server.js` work on a fresh DATA_DIR without extra steps. Both paths
 * are idempotent.
 */
export async function register(): Promise<void> {
  // Only the Node.js runtime can touch better-sqlite3 (proxy.ts may evaluate
  // this module under the edge runtime).
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { runMigrations } = await import('@/db/migrate');
  runMigrations();
}
