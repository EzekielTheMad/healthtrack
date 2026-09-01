// @vitest-environment node
/**
 * The pinned relay contract: derivation, the generated-file drift guard, and
 * per-record structural validation.
 *
 * Why a generated module rather than a second hand-written table: the relay
 * publishes 35 record arrays with ~140 fields between them. A copy would drift
 * silently, because unknown fields are (correctly) retained rather than
 * rejected — so a rename would look like "the source stopped sending that",
 * not like a bug.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  deriveRelayContract,
  renderRelaySchemaModule,
  type UpstreamSchema,
} from './derive-relay-schema';
import { RELAY_CONTRACT, RELAY_SCHEMA_COMMIT } from './generated/relay-schema';
import { RECORD_TYPES, UPSTREAM_SCHEMA_COMMIT, getRecordType } from './schema';
import { isKnownRecordType, validateRelayRecord } from './validate-record';

const HC_DIR = path.join(process.cwd(), 'src', 'lib', 'integrations', 'health-connect');

const upstream = JSON.parse(
  fs.readFileSync(path.join(HC_DIR, 'fixtures', 'webhook-schema.json'), 'utf8'),
) as UpstreamSchema;

const derived = deriveRelayContract(upstream);

describe('generated relay schema', () => {
  it('matches a fresh derivation from the vendored schema', () => {
    const expected = renderRelaySchemaModule(derived, UPSTREAM_SCHEMA_COMMIT);
    const actual = fs
      .readFileSync(path.join(HC_DIR, 'generated', 'relay-schema.ts'), 'utf8')
      .replace(/\r\n/g, '\n');
    // If this fails: `npm run generate:relay-schema` and commit the result.
    expect(actual).toBe(expected);
  });

  it('is pinned to the same upstream commit as the record table', () => {
    expect(RELAY_SCHEMA_COMMIT).toBe(UPSTREAM_SCHEMA_COMMIT);
  });

  it('is vendored, not fetched — the schema file is on disk', () => {
    expect(fs.existsSync(path.join(HC_DIR, 'fixtures', 'webhook-schema.json'))).toBe(true);
  });
});

describe('the complete pinned contract', () => {
  /** Every record type the follow-up brief requires the relay to represent. */
  const REQUIRED_COVERAGE = [
    'steps',
    'distance',
    'active_calories',
    'total_calories',
    'heart_rate',
    'resting_heart_rate',
    'heart_rate_variability',
    'sleep',
    'weight',
    'height',
    'body_fat',
    'lean_body_mass',
    'bone_mass',
    'body_water_mass',
    'exercise',
    'blood_pressure',
    'blood_glucose',
    'oxygen_saturation',
    'body_temperature',
    'skin_temperature',
    'basal_body_temperature',
    'respiratory_rate',
    'hydration',
    'nutrition',
    'mindfulness',
    'basal_metabolic_rate',
    'vo2_max',
    'menstruation_period',
    'menstruation_flow',
    'intermenstrual_bleeding',
    'ovulation_test',
    'cervical_mucus',
    'sexual_activity',
    'screen_time',
    'daily_totals',
  ];

  it('covers every record type the relay can send', () => {
    const known = new Set(RELAY_CONTRACT.recordArrays.map((a) => a.type));
    for (const type of REQUIRED_COVERAGE) {
      expect(known, `relay contract is missing '${type}'`).toContain(type);
    }
    expect(RELAY_CONTRACT.recordArrays).toHaveLength(35);
  });

  it('gives every relay array an ingestion semantic in RECORD_TYPES', () => {
    for (const array of RELAY_CONTRACT.recordArrays) {
      const def = getRecordType(array.type);
      expect(def, `RECORD_TYPES has no entry for '${array.type}'`).toBeDefined();
      expect(def!.semantic).toBeTruthy();
    }
    expect(RECORD_TYPES).toHaveLength(RELAY_CONTRACT.recordArrays.length);
  });

  it('carries sleep stages, and diagnostics/backfill envelope metadata', () => {
    const sleep = RELAY_CONTRACT.recordArrays.find((a) => a.type === 'sleep')!;
    expect(sleep.fields.map((f) => f.name)).toContain('stages');
    const envelope = RELAY_CONTRACT.envelopeFields.map((f) => f.name);
    expect(envelope).toEqual(
      expect.arrayContaining([
        '_diagnostics',
        'backfill',
        'window_start',
        'window_end',
        'app_version',
        'timestamp',
        'source',
      ]),
    );
  });

  it('names a uuid and a source on every per-record array', () => {
    for (const array of RELAY_CONTRACT.recordArrays) {
      // daily_totals and screen_time are date-keyed aggregates with neither.
      if (array.type === 'daily_totals' || array.type === 'screen_time') continue;
      const names = array.fields.map((f) => f.name);
      expect(names, `${array.type}`).toContain('uuid');
      expect(names, `${array.type}`).toContain('source');
    }
  });
});

describe('structural validation', () => {
  it('accepts a well-formed record of a known type', () => {
    expect(
      validateRelayRecord('nutrition', {
        calories: 520,
        start_time: '2026-09-01T14:05:00Z',
        end_time: '2026-09-01T14:05:00Z',
        source: 'com.sbs.diet',
        uuid: 'mf-1',
      }).valid,
    ).toBe(true);
  });

  it('retains unknown FIELDS without complaint — the relay may add any', () => {
    const check = validateRelayRecord('nutrition', {
      start_time: '2026-09-01T14:05:00Z',
      end_time: '2026-09-01T14:05:00Z',
      fiber_grams: 8.2,
      some_future_field: { nested: true },
    });
    expect(check.valid).toBe(true);
  });

  it('does not validate an unknown record TYPE at all', () => {
    expect(isKnownRecordType('teleportation_sessions')).toBe(false);
    expect(validateRelayRecord('teleportation_sessions', { anything: 1 }).valid).toBe(true);
  });

  it('flags a missing required field', () => {
    const check = validateRelayRecord('heart_rate', { time: '2026-09-01T14:00:00Z' });
    expect(check.valid).toBe(false);
    expect(check.issues[0]).toContain("missing required 'bpm'");
  });

  it('flags a wrong primitive type', () => {
    const check = validateRelayRecord('steps', {
      count: 'lots',
      start_time: '2026-09-01T14:00:00Z',
      end_time: '2026-09-01T15:00:00Z',
    });
    expect(check.valid).toBe(false);
    expect(check.issues[0]).toContain("'count' must be integer");
  });

  it('flags an unparseable timestamp', () => {
    const check = validateRelayRecord('weight', { kilograms: 88.9, time: 'yesterday' });
    expect(check.valid).toBe(false);
    expect(check.issues[0]).toContain('not a supported timestamp');
  });

  it('treats an explicit null as absent, not as a type error', () => {
    // The relay writes null for "Health Connect had no value"; the nutrition
    // path depends on absent staying distinguishable from zero.
    const check = validateRelayRecord('nutrition', {
      calories: null,
      protein_grams: null,
      start_time: '2026-09-01T14:05:00Z',
      end_time: '2026-09-01T14:05:00Z',
    });
    expect(check.valid).toBe(true);
  });

  it('rejects a record that is not an object', () => {
    expect(validateRelayRecord('nutrition', 'not-a-record').valid).toBe(false);
    expect(validateRelayRecord('nutrition', [1, 2, 3]).valid).toBe(false);
  });
});
