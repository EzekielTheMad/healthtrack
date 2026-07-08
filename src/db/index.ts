/**
 * SQLite connection + Drizzle client singleton.
 *
 * - PRAGMA journal_mode=WAL (concurrent reads during writes)
 * - PRAGMA foreign_keys=ON (SQLite defaults to OFF)
 * - Cached on globalThis so Next.js dev HMR does not leak connections.
 *   The cache is keyed by DB path so tests pointing DATA_DIR at a temp
 *   directory get a fresh connection.
 */
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ensureDataDirs, getDbPath } from '@/lib/runtime/paths';
import * as schema from './schema';

export type DB = BetterSQLite3Database<typeof schema>;

interface DbHandle {
  path: string;
  sqlite: Database.Database;
  db: DB;
}

const globalForDb = globalThis as unknown as { __healthtrackDb?: DbHandle };

function createHandle(path: string): DbHandle {
  ensureDataDirs();
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return { path, sqlite, db: drizzle(sqlite, { schema }) };
}

function getHandle(): DbHandle {
  const path = getDbPath();
  const cached = globalForDb.__healthtrackDb;
  if (cached && cached.path === path && cached.sqlite.open) return cached;
  const handle = createHandle(path);
  globalForDb.__healthtrackDb = handle;
  return handle;
}

/** Drizzle client bound to the current DATA_DIR database. */
export function getDb(): DB {
  return getHandle().db;
}

/** Raw better-sqlite3 connection (pragmas, backups, tests). */
export function getSqlite(): Database.Database {
  return getHandle().sqlite;
}

/**
 * Lazy singleton export so call sites can `import { db } from '@/db'` and use
 * it directly (`db.select()...`). Resolution happens per property access, so
 * a DATA_DIR change (tests) or an HMR reload picks up the right connection.
 */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb(), prop, receiver);
    return typeof value === 'function' ? value.bind(getDb()) : value;
  },
});
