// @vitest-environment node
/**
 * Envelope validation + the pin that keeps RECORD_TYPES honest against the
 * checked-in upstream JSON Schema. If the relay renames a field or adds a
 * type, this fails loudly instead of silently dropping records.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  MAX_ARRAYS_PER_PAYLOAD,
  RECORD_TYPES,
  UPSTREAM_SCHEMA_COMMIT,
  dailyTotalsSchema,
  envelopeSchema,
  getRecordType,
  isSupportedTimestamp,
  isTestPing,
  maxBodyBytes,
  nutritionRecordSchema,
} from './schema';
import { TEST_PING, PREVIEW_PAYLOAD, BACKFILL_PAYLOAD } from './fixtures/payloads';

interface UpstreamSchema {
  properties: Record<string, { type?: string; items?: { properties?: Record<string, unknown>; required?: string[] } }>;
  required: string[];
}

const upstream = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'src/lib/integrations/health-connect/fixtures/webhook-schema.json'),
    'utf8',
  ),
) as UpstreamSchema;

describe('upstream schema pin', () => {
  it('records the pinned commit', () => {
    expect(UPSTREAM_SCHEMA_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  it('covers every record array the upstream schema can emit', () => {
    const upstreamArrays = Object.entries(upstream.properties)
      .filter(([, v]) => v.type === 'array')
      .map(([k]) => k);
    const known = new Set(RECORD_TYPES.map((r) => r.type));
    for (const type of upstreamArrays) {
      expect(known, `RECORD_TYPES is missing upstream array '${type}'`).toContain(type);
    }
    expect(upstreamArrays.length).toBeLessThanOrEqual(MAX_ARRAYS_PER_PAYLOAD);
  });

  it('names timestamp fields that actually exist upstream', () => {
    for (const def of RECORD_TYPES) {
      const props = upstream.properties[def.type]?.items?.properties;
      expect(props, `upstream has no array '${def.type}'`).toBeDefined();
      expect(Object.keys(props!), `${def.type}.startField`).toContain(def.startField);
      if (def.endField) {
        expect(Object.keys(props!), `${def.type}.endField`).toContain(def.endField);
      }
    }
  });

  it('declares a semantic for every type, and normalizes exactly two', () => {
    for (const def of RECORD_TYPES) expect(def.semantic).toBeTruthy();
    expect(RECORD_TYPES.filter((r) => r.normalized).map((r) => r.type)).toEqual([
      'daily_totals',
      'nutrition',
    ]);
  });

  it('keeps competing-source types raw-only (Oura / Renpho / myAir ownership)', () => {
    for (const type of ['sleep', 'weight', 'body_fat', 'heart_rate_variability', 'resting_heart_rate', 'oxygen_saturation']) {
      expect(getRecordType(type)?.normalized, `${type} must stay raw-only`).toBe(false);
    }
  });

  it('never treats a generic exercise session as a completed workout', () => {
    const exercise = getRecordType('exercise')!;
    expect(exercise.normalized).toBe(false);
    expect(exercise.semantic).toBe('discrete_event');
  });
});

describe('envelope validation', () => {
  it('accepts the published fixtures', () => {
    expect(envelopeSchema.safeParse(PREVIEW_PAYLOAD).success).toBe(true);
    expect(envelopeSchema.safeParse(BACKFILL_PAYLOAD).success).toBe(true);
  });

  it('requires the fields the upstream schema marks required', () => {
    expect(upstream.required.sort()).toEqual(['app_version', 'source', 'timestamp']);
    for (const missing of upstream.required) {
      const body: Record<string, unknown> = {
        timestamp: '2026-09-01T00:00:00Z',
        app_version: '1.8.0',
        source: 'health_connect',
      };
      delete body[missing];
      expect(envelopeSchema.safeParse(body).success, `missing ${missing}`).toBe(false);
    }
  });

  it('rejects a non-health_connect source (iOS / screen-time payloads)', () => {
    for (const source of ['healthkit_ios', 'screen_time', 'nonsense']) {
      const result = envelopeSchema.safeParse({
        timestamp: '2026-09-01T00:00:00Z',
        app_version: '1.8.0',
        source,
      });
      expect(result.success, `source '${source}' must be rejected`).toBe(false);
    }
  });

  it('rejects invalid and out-of-range timestamps', () => {
    for (const timestamp of ['not-a-date', '1899-12-31T00:00:00Z', '2200-01-01T00:00:00Z', '']) {
      const result = envelopeSchema.safeParse({
        timestamp,
        app_version: '1.8.0',
        source: 'health_connect',
      });
      expect(result.success, `timestamp '${timestamp}' must be rejected`).toBe(false);
    }
    expect(isSupportedTimestamp('2026-09-01T00:00:00Z')).toBe(true);
    expect(isSupportedTimestamp(12345)).toBe(false);
  });

  it('retains unknown top-level fields', () => {
    const parsed = envelopeSchema.parse({
      timestamp: '2026-09-01T00:00:00Z',
      app_version: '1.8.0',
      source: 'health_connect',
      _diagnostics: { steps: 'ok' },
      some_future_field: [1, 2, 3],
    });
    expect(parsed._diagnostics).toEqual({ steps: 'ok' });
    expect(parsed.some_future_field).toEqual([1, 2, 3]);
  });

  it('recognises the companion test ping (which carries no app_version)', () => {
    expect(isTestPing(TEST_PING)).toBe(true);
    expect(isTestPing(PREVIEW_PAYLOAD)).toBe(false);
    // The ping is deliberately NOT a valid health envelope.
    expect(envelopeSchema.safeParse(TEST_PING).success).toBe(false);
  });
});

describe('record schemas', () => {
  it('requires a YYYY-MM-DD date on daily_totals and allows partial metrics', () => {
    expect(dailyTotalsSchema.safeParse({ date: '2026-09-01' }).success).toBe(true);
    expect(dailyTotalsSchema.safeParse({ date: '09/01/2026' }).success).toBe(false);
    expect(dailyTotalsSchema.safeParse({ steps: 10 }).success).toBe(false);
    expect(dailyTotalsSchema.safeParse({ date: '2026-09-01', steps: -5 }).success).toBe(false);
  });

  it('keeps null nutrients null rather than defaulting them', () => {
    const parsed = nutritionRecordSchema.parse({
      calories: null,
      start_time: '2026-09-01T14:00:00Z',
    });
    expect(parsed.calories).toBeNull();
    expect(parsed.protein_grams).toBeUndefined();
  });
});

describe('limits', () => {
  it('defaults to 2 MiB and honours the env override', () => {
    const saved = process.env.HEALTH_CONNECT_MAX_BODY_BYTES;
    delete process.env.HEALTH_CONNECT_MAX_BODY_BYTES;
    expect(maxBodyBytes()).toBe(2 * 1024 * 1024);
    process.env.HEALTH_CONNECT_MAX_BODY_BYTES = '4096';
    expect(maxBodyBytes()).toBe(4096);
    process.env.HEALTH_CONNECT_MAX_BODY_BYTES = 'garbage';
    expect(maxBodyBytes()).toBe(2 * 1024 * 1024);
    if (saved === undefined) delete process.env.HEALTH_CONNECT_MAX_BODY_BYTES;
    else process.env.HEALTH_CONNECT_MAX_BODY_BYTES = saved;
  });
});
