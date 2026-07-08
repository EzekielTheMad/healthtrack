/**
 * Container boot migration runner.
 *
 * Bundled by esbuild in the Docker build stage into a self-contained
 * db-migrate.js placed next to the standalone server.js (better-sqlite3 is
 * left external and resolved from the standalone node_modules). The
 * entrypoint runs it before starting the server:
 *
 *   node /app/db-migrate.js
 *
 * Migration SQL is read from DRIZZLE_MIGRATIONS_DIR when set, otherwise
 * ./drizzle relative to the process cwd (/app in the image).
 */
import path from 'path';
import { runMigrations } from '../src/db/migrate';

const folder =
  process.env.DRIZZLE_MIGRATIONS_DIR ?? path.join(process.cwd(), 'drizzle');

try {
  runMigrations(folder);
  console.log(`[db-migrate] migrations applied (folder: ${folder})`);
  process.exit(0);
} catch (err) {
  console.error('[db-migrate] migration failed:', err);
  process.exit(1);
}
