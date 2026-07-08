/**
 * Runtime data paths.
 *
 * All persistent state lives under DATA_DIR:
 *   healthtrack.db   SQLite database
 *   uploads/<userId> lab PDFs / images
 *   keys/            auto-generated secrets (AUTH_SECRET, ENCRYPTION_KEY)
 *
 * Resolution: DATA_DIR env var wins; otherwise `/data` in production
 * (the Docker volume) and `./data` in development.
 *
 * Paths are resolved lazily (functions, not import-time constants) so tests
 * can point DATA_DIR at a temp directory before first use, and so importing
 * this module from build tooling never creates directories as a side effect
 * of a stale env snapshot.
 */
import fs from 'fs';
import path from 'path';

export function getDataDir(): string {
  const dir =
    process.env.DATA_DIR ?? (process.env.NODE_ENV === 'production' ? '/data' : './data');
  return path.resolve(dir);
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'healthtrack.db');
}

export function getUploadsDir(): string {
  return path.join(getDataDir(), 'uploads');
}

export function getKeysDir(): string {
  return path.join(getDataDir(), 'keys');
}

/** Ensure the DATA_DIR tree exists. Idempotent. Returns the data dir. */
export function ensureDataDirs(): string {
  const dataDir = getDataDir();
  for (const dir of [dataDir, getUploadsDir(), getKeysDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dataDir;
}

// No import-time side effects here: `next build` evaluates route modules
// during page-data collection, and an eager mkdir of /data fails on hosts
// where the build user cannot create it (e.g. CI runners). Directories are
// created lazily by getDb(), getOrCreateSecret(), and saveUpload().
