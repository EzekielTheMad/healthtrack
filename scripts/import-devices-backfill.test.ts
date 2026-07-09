// @vitest-environment node
/**
 * Backfill importer — pure parts: file parsing, local registry validation,
 * chunking math, push/retry/reconciliation accumulation with a mocked fetch.
 * No network, no DB (validateVitalWrite never touches the connection).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CHUNK_SIZE,
  chunkRecords,
  formatDryRun,
  formatReconciliation,
  parseBackfillFile,
  parseCliArgs,
  pushAll,
  validateRecords,
} from './import-devices-backfill';

const GOOD = {
  metric_key: 'steps',
  value: 8200,
  source: 'samsung_health',
  recorded_at: '2026-07-08',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseBackfillFile', () => {
  it('parses a JSON array', () => {
    expect(parseBackfillFile('[]')).toEqual([]);
    expect(parseBackfillFile(JSON.stringify([GOOD]))).toHaveLength(1);
  });

  it('rejects invalid JSON and non-array roots', () => {
    expect(() => parseBackfillFile('{nope')).toThrow(/not valid JSON/);
    expect(() => parseBackfillFile('{"records": []}')).toThrow(/JSON array/);
  });
});

describe('validateRecords (local registry rules)', () => {
  it('accepts valid records and counts per metric', () => {
    const report = validateRecords([
      GOOD,
      { metric_key: 'weight', value: 181.2, source: 'renpho', recorded_at: '2026-07-08' },
      { metric_key: 'resilience', value_label: 'solid', source: 'oura', recorded_at: '2026-07-08' },
      { metric_key: 'steps', value: 4000, source: 'samsung_health', recorded_at: '2026-07-07' },
    ]);
    expect(report.read).toBe(4);
    expect(report.valid).toBe(4);
    expect(report.issues).toEqual([]);
    expect(report.perMetric.get('steps')).toBe(2);
    expect(report.perMetric.get('weight')).toBe(1);
  });

  it('reports invalid records by index with the server-equivalent message', () => {
    const report = validateRecords([
      GOOD,
      { metric_key: 'quantum_flux', value: 1, source: 'x', recorded_at: '2026-07-08' },
      { metric_key: 'resilience', value_label: 'meh', source: 'oura', recorded_at: '2026-07-08' },
    ]);
    expect(report.valid).toBe(1);
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0].index).toBe(1);
    expect(report.issues[0].message).toContain('quantum_flux');
    expect(report.issues[1].index).toBe(2);
    expect(report.issues[1].message).toContain('meh');
    expect(formatDryRun(report)).toContain('[1] ');
  });
});

describe('chunkRecords', () => {
  it('chunks at the batch-endpoint limit', () => {
    expect(chunkRecords([])).toEqual([]);
    expect(chunkRecords([1])).toEqual([[1]]);
    expect(chunkRecords(Array(CHUNK_SIZE).fill(0))).toHaveLength(1);
    const twoPlus = chunkRecords(Array(CHUNK_SIZE + 1).fill(0));
    expect(twoPlus).toHaveLength(2);
    expect(twoPlus[0]).toHaveLength(CHUNK_SIZE);
    expect(twoPlus[1]).toHaveLength(1);
    const chunks = chunkRecords(Array(1250).fill(0));
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 250]);
  });
});

describe('pushAll', () => {
  it('POSTs chunks with the bearer token and accumulates the reconciliation', async () => {
    const records = Array.from({ length: CHUNK_SIZE + 10 }, (_, i) => ({ ...GOOD, value: i }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ inserted: 490, updated: 10, errors: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ inserted: 9, updated: 0, errors: [{ index: 3, message: 'bad' }] }),
      );

    const result = await pushAll({
      url: 'https://ht.example.com/',
      token: 'ohts_pat_test',
      records,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe('https://ht.example.com/api/v1/vitals/batch');
    expect(init.headers.Authorization).toBe('Bearer ohts_pat_test');
    expect(JSON.parse(init.body).records).toHaveLength(CHUNK_SIZE);

    expect(result).toMatchObject({
      read: CHUNK_SIZE + 10,
      sent: CHUNK_SIZE + 10,
      inserted: 499,
      updated: 10,
      aborted: false,
    });
    // Second-chunk error index re-based to the file position.
    expect(result.errors).toEqual([{ index: CHUNK_SIZE + 3, message: 'bad' }]);
    expect(formatReconciliation(result)).toContain(`[${CHUNK_SIZE + 3}] bad`);
  });

  it('retries a failing chunk with backoff, then succeeds', async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ inserted: 1, updated: 0, errors: [] }));

    const result = await pushAll({
      url: 'https://ht.example.com',
      token: 't',
      records: [GOOD],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 100,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]); // exponential backoff
    expect(result).toMatchObject({ sent: 1, inserted: 1, aborted: false });
  });

  it('aborts after 3 retries and does not send remaining chunks', async () => {
    const records = Array(CHUNK_SIZE + 1).fill(GOOD);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'down' }, 503));

    const result = await pushAll({
      url: 'https://ht.example.com',
      token: 't',
      records,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      backoffMs: 0,
    });

    // 1 initial + 3 retries on the FIRST chunk only; second chunk never sent.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ read: CHUNK_SIZE + 1, sent: 0, aborted: true });
    expect(formatReconciliation(result)).toContain('ABORTED');
  });
});

describe('parseCliArgs', () => {
  it('parses --file and --dry-run and rejects unknown flags', () => {
    expect(parseCliArgs(['--file', 'x.json', '--dry-run'])).toEqual({
      file: 'x.json',
      dryRun: true,
    });
    expect(parseCliArgs([])).toEqual({ dryRun: false });
    expect(() => parseCliArgs(['--nope'])).toThrow(/--nope/);
  });
});
