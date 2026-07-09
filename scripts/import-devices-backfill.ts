/**
 * Device-metrics backfill importer — reference bridge implementation.
 *
 * Reads a JSON array of vital records (format: docs/backfill-format.md) and
 * pushes them to a HealthTrack instance via POST /api/v1/vitals/batch in
 * chunks of 500, printing a reconciliation table at the end.
 *
 * Usage:
 *   HEALTHTRACK_URL=https://your-instance \
 *   HEALTHTRACK_TOKEN=ohts_pat_... \
 *     npx tsx scripts/import-devices-backfill.ts --file backfill.json [--dry-run]
 *
 * --dry-run validates every record against the local metric registry (the
 * exact rules the server applies via validateVitalWrite) and prints the plan
 * without making any network calls — no URL/token needed.
 *
 * Failure handling: a non-2xx response (or network error) on a chunk is
 * retried up to 3 times with exponential backoff; after that the import
 * aborts (remaining chunks are NOT sent) and the reconciliation so far is
 * printed. Per-record validation errors returned by the server do not abort
 * the batch — they are listed by (global) record index.
 */
import fs from 'fs';
import { pathToFileURL } from 'url';
import { validateVitalWrite } from '../src/lib/repos/vitals';
import { bodyToCamel } from '../src/lib/api/snake';

export const CHUNK_SIZE = 500;

export interface RecordIssue {
  index: number;
  message: string;
}

export interface DryRunReport {
  read: number;
  valid: number;
  perMetric: Map<string, number>;
  issues: RecordIssue[];
}

export interface PushResult {
  read: number;
  sent: number;
  inserted: number;
  updated: number;
  errors: RecordIssue[];
  /** true when a chunk kept failing after all retries; remaining chunks were not sent. */
  aborted: boolean;
}

/** Parse the backfill file: must be a JSON array of record objects. */
export function parseBackfillFile(text: string): unknown[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `File is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(data)) {
    throw new Error('File must be a JSON array of records — see docs/backfill-format.md');
  }
  return data;
}

/**
 * Validate records locally against the metric registry — the same
 * validateVitalWrite rules the server enforces (closed registry, ordinal
 * labels, canonical units, recorded_at normalization).
 */
export function validateRecords(records: unknown[]): DryRunReport {
  const issues: RecordIssue[] = [];
  const perMetric = new Map<string, number>();
  let valid = 0;
  records.forEach((record, index) => {
    try {
      const v = validateVitalWrite(bodyToCamel(record));
      valid += 1;
      perMetric.set(v.metricKey, (perMetric.get(v.metricKey) ?? 0) + 1);
    } catch (err) {
      issues.push({ index, message: err instanceof Error ? err.message : String(err) });
    }
  });
  return { read: records.length, valid, perMetric, issues };
}

/** Split records into batch-endpoint-sized chunks (max 500 per request). */
export function chunkRecords<T>(records: readonly T[], size: number = CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < records.length; i += size) {
    chunks.push(records.slice(i, i + size));
  }
  return chunks;
}

export interface PushOptions {
  url: string;
  token: string;
  records: unknown[];
  /** Injection points for tests. */
  fetchImpl?: typeof fetch;
  retries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface BatchResponse {
  inserted: number;
  updated: number;
  errors: RecordIssue[];
}

/**
 * POST all records to `${url}/api/v1/vitals/batch` in chunks, retrying each
 * failed chunk with exponential backoff, and accumulate a reconciliation.
 * Server-reported per-record error indexes are re-based to the position in
 * the input file.
 */
export async function pushAll(opts: PushOptions): Promise<PushResult> {
  const {
    url,
    token,
    records,
    fetchImpl = fetch,
    retries = 3,
    backoffMs = 1000,
    sleep = defaultSleep,
    log = () => {},
  } = opts;
  const endpoint = `${url.replace(/\/+$/, '')}/api/v1/vitals/batch`;
  const result: PushResult = {
    read: records.length,
    sent: 0,
    inserted: 0,
    updated: 0,
    errors: [],
    aborted: false,
  };

  const chunks = chunkRecords(records);
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    const offset = c * CHUNK_SIZE;
    let response: BatchResponse | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: chunk }),
        });
        if (res.ok) {
          response = (await res.json()) as BatchResponse;
          break;
        }
        const body = await res.text().catch(() => '');
        log(
          `chunk ${c + 1}/${chunks.length}: HTTP ${res.status}${
            attempt < retries ? ` — retrying (${attempt + 1}/${retries})` : ''
          } ${body.slice(0, 200)}`,
        );
      } catch (err) {
        log(
          `chunk ${c + 1}/${chunks.length}: ${err instanceof Error ? err.message : String(err)}${
            attempt < retries ? ` — retrying (${attempt + 1}/${retries})` : ''
          }`,
        );
      }
      if (attempt < retries) await sleep(backoffMs * 2 ** attempt);
    }

    if (!response) {
      result.aborted = true;
      break;
    }

    result.sent += chunk.length;
    result.inserted += response.inserted;
    result.updated += response.updated;
    for (const e of response.errors ?? []) {
      result.errors.push({ index: offset + e.index, message: e.message });
    }
    log(
      `chunk ${c + 1}/${chunks.length}: sent ${chunk.length} — inserted ${response.inserted}, updated ${response.updated}, errors ${response.errors?.length ?? 0}`,
    );
  }

  return result;
}

export function formatDryRun(report: DryRunReport): string {
  const lines: string[] = [
    'Dry run — no records were sent.',
    '',
    `  records read    ${report.read}`,
    `  valid           ${report.valid}`,
    `  invalid         ${report.issues.length}`,
  ];
  if (report.perMetric.size > 0) {
    lines.push('', '  per metric:');
    for (const [key, n] of [...report.perMetric.entries()].sort()) {
      lines.push(`    ${key.padEnd(24)} ${n}`);
    }
  }
  if (report.issues.length > 0) {
    lines.push('', '  issues:');
    for (const issue of report.issues) {
      lines.push(`    [${issue.index}] ${issue.message}`);
    }
  }
  return lines.join('\n');
}

export function formatReconciliation(result: PushResult): string {
  const lines: string[] = [
    result.aborted
      ? 'IMPORT ABORTED — a chunk failed after all retries. Reconciliation so far:'
      : 'Import complete.',
    '',
    `  records read     ${result.read}`,
    `  records sent     ${result.sent}`,
    `  inserted         ${result.inserted}`,
    `  updated          ${result.updated}`,
    `  record errors    ${result.errors.length}`,
  ];
  if (result.errors.length > 0) {
    lines.push('', '  errors (by record index in the file):');
    for (const e of result.errors) {
      lines.push(`    [${e.index}] ${e.message}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  file?: string;
  dryRun: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file') {
      args.file = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument '${arg}'`);
    }
  }
  return args;
}

const USAGE = `Usage:
  HEALTHTRACK_URL=https://your-instance HEALTHTRACK_TOKEN=ohts_pat_... \\
    npx tsx scripts/import-devices-backfill.ts --file <records.json> [--dry-run]

The file is a JSON array of records — see docs/backfill-format.md.
--dry-run validates locally against the metric registry; no URL/token needed.`;

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    process.exit(2);
  }
  if (!args.file) {
    console.error('Missing required --file argument.');
    console.error(USAGE);
    process.exit(2);
  }

  let records: unknown[];
  try {
    records = parseBackfillFile(fs.readFileSync(args.file, 'utf8'));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  if (args.dryRun) {
    const report = validateRecords(records);
    console.log(formatDryRun(report));
    process.exit(report.issues.length > 0 ? 1 : 0);
  }

  const url = process.env.HEALTHTRACK_URL;
  const token = process.env.HEALTHTRACK_TOKEN;
  if (!url || !token) {
    console.error('HEALTHTRACK_URL and HEALTHTRACK_TOKEN must be set for a live import.');
    console.error(USAGE);
    process.exit(2);
  }

  console.log(
    `Importing ${records.length} records to ${url} in chunks of ${CHUNK_SIZE} (tip: run --dry-run first)\n`,
  );
  const result = await pushAll({ url, token, records, log: (line) => console.log(`  ${line}`) });
  console.log('\n' + formatReconciliation(result));
  process.exit(result.aborted || result.errors.length > 0 ? 1 : 0);
}

// Run only when executed directly (npx tsx scripts/import-devices-backfill.ts),
// not when imported by tests.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
