/**
 * Hand-maintained OpenAPI 3.1 description of the /api/v1 PAT surface, served
 * at GET /api/v1/openapi.json (public — API shape only, no user data).
 *
 * Kept honest by a drift test (src/app/api/v1/openapi.json/route.test.ts)
 * that asserts every route file under src/app/api/v1/** has a corresponding
 * path entry here. When you add a v1 route, add its path below.
 */
import { AVAILABLE_SCOPES } from '@/lib/api-scopes';
import { healthConnectEnvelopeSchema } from './health-connect-openapi';

const SCOPE_DOC = AVAILABLE_SCOPES.map((s) => `- \`${s.value}\` — ${s.description}`).join('\n');

/** Standard list-endpoint responses (401 missing/invalid token, 403 missing scope). */
const AUTH_ERRORS = {
  '401': {
    description: 'Missing or invalid bearer token',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  '403': {
    description: 'Token lacks the required scope',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
} as const;

function listOperation(summary: string, scope: string, parameters?: unknown[]) {
  return {
    summary,
    description: `Requires scope \`${scope}\` (or \`read:all\`).`,
    ...(parameters ? { parameters } : {}),
    responses: {
      '200': {
        description: 'JSON array of records (snake_case fields)',
        content: {
          'application/json': {
            schema: { type: 'array', items: { type: 'object' } },
          },
        },
      },
      ...AUTH_ERRORS,
    },
  };
}

/** 400 validation-failure response (fitness/vitals write paths). */
const VALIDATION_400 = {
  '400': {
    description: 'Validation failure',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
} as const;

/** 404 for ownership-scoped by-id lookups (cross-user probes included). */
const NOT_FOUND_404 = {
  '404': {
    description: 'Not found (ownership-scoped — other users’ ids look absent)',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
} as const;

function pathParam(name: string, description: string) {
  return { name, in: 'path', required: true, schema: { type: 'string' }, description };
}

function jsonBody(ref: string) {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: ref } } },
  };
}

function jsonResponse(description: string, schema: unknown) {
  return { description, content: { 'application/json': { schema } } };
}

export const OPENAPI_DOCUMENT = {
  openapi: '3.1.0',
  info: {
    title: 'HealthTrack API',
    version: '1.0.0',
    description:
      'Personal-access-token API for a self-hosted HealthTrack instance. ' +
      'Every token resolves to exactly one user; all reads and writes are ' +
      'hard-scoped to that owner. Human-readable cookbook: /docs/api on this instance.',
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Personal access token created in Settings → API Keys ' +
          '(format `ohts_pat_...`), sent as `Authorization: Bearer <token>`. ' +
          'Each token carries a set of scopes:\n' +
          SCOPE_DOC +
          '\n\n`read:all` satisfies every read scope; `write:all` satisfies every write scope.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
      },
      Vital: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          metric_key: { type: 'string' },
          value: { type: 'number' },
          unit: { type: ['string', 'null'] },
          source: { type: 'string' },
          recorded_at: { type: 'string', description: 'ISO 8601 UTC' },
        },
        required: ['id', 'metric_key', 'value', 'unit', 'source', 'recorded_at'],
      },
      VitalWrite: {
        type: 'object',
        description:
          'One vital record. `metric_key` must exist in the metric registry ' +
          '(GET /api/v1/metrics). Ordinal metrics take `value` (1-based ' +
          'integer) or `value_label`; number metrics require `value`. `unit`, ' +
          'when provided, must be an accepted input unit for the metric: the ' +
          'canonical unit, or a registered alternate that is converted ' +
          'server-side (metrics stored in "lbs" accept "kg"; metrics stored ' +
          'in "in" — every body_measurement circumference — accept "cm"). An ' +
          'omitted unit means the value is already in the canonical unit; any ' +
          'other unit is rejected rather than guessed at. The stored and ' +
          'returned unit is always the canonical one. `recorded_at` is ' +
          'normalized to day granularity unless the metric is ' +
          'intraday-capable.',
        properties: {
          metric_key: { type: 'string' },
          value: { type: 'number' },
          value_label: { type: 'string', description: 'Ordinal metrics only' },
          unit: {
            type: ['string', 'null'],
            description:
              'Canonical or accepted alternate unit (e.g. "in" or "cm" for ' +
              'circumferences). Omit to declare the value already canonical.',
          },
          recorded_at: { type: 'string', description: 'ISO date or datetime' },
          source: {
            type: 'string',
            description:
              'Free-form identifier for the submitting integration, e.g. ' +
              '"example_tape", "mobile_health_bridge", "manual_import". Part ' +
              'of the idempotency tuple.',
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            description:
              'Opaque provenance owned by the submitting integration — stored ' +
              'and echoed verbatim, never interpreted as a canonical value.',
          },
        },
        required: ['metric_key', 'recorded_at', 'source'],
      },
      VitalWriteResult: {
        type: 'object',
        properties: {
          result: { type: 'string', enum: ['inserted', 'updated'] },
          vital: {
            allOf: [
              { $ref: '#/components/schemas/Vital' },
              {
                type: 'object',
                properties: { metadata: { type: 'object', additionalProperties: true } },
              },
            ],
          },
        },
        required: ['result'],
      },
      BatchEnvelope: {
        type: 'object',
        properties: {
          records: {
            type: 'array',
            items: { $ref: '#/components/schemas/VitalWrite' },
            maxItems: 500,
          },
        },
        required: ['records'],
      },
      NutritionDay: {
        type: 'object',
        description:
          'Canonical daily actual intake — ONE row per (user, Phoenix ' +
          'calendar date, source package), recomputed and overwritten on ' +
          'every sync. A null nutrient means UNKNOWN, never zero.',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD (America/Phoenix)' },
          source_package: { type: 'string', description: 'Exact Android package, e.g. "com.sbs.diet"' },
          calories: { type: ['number', 'null'] },
          protein_grams: { type: ['number', 'null'] },
          carbs_grams: { type: ['number', 'null'] },
          fat_grams: { type: ['number', 'null'] },
          fiber_grams: { type: ['number', 'null'], description: 'Reserved — the relay does not publish it yet' },
          sugar_grams: { type: ['number', 'null'], description: 'Reserved — the relay does not publish it yet' },
          sodium_milligrams: { type: ['number', 'null'], description: 'Reserved — the relay does not publish it yet' },
          record_count: { type: 'integer', description: 'Raw source records this day was computed from' },
          updated_at: { type: 'string' },
        },
        required: ['date', 'source_package', 'record_count'],
      },
      HealthConnectEnvelope: healthConnectEnvelopeSchema(),
      HealthConnectInventoryEntry: {
        type: 'object',
        description:
          'One (record type × EXACT source package) group the account has ' +
          'received, with its canonical-write policy.',
        properties: {
          integration_id: { type: ['string', 'null'] },
          integration_status: {
            type: ['string', 'null'],
            enum: ['inventory', 'active', 'paused', 'error', null],
          },
          record_type: { type: 'string' },
          source_package: {
            type: 'string',
            description: 'Exact Android package, e.g. "com.sbs.diet"',
          },
          identity_kind: {
            type: 'string',
            enum: ['uuid', 'derived'],
            description:
              '"derived" means the relay sent no Health Connect record id, so deduplication is content-derived and cannot recognise an edited record.',
          },
          record_count: { type: 'integer' },
          earliest_record_at: { type: ['string', 'null'] },
          latest_record_at: { type: ['string', 'null'] },
          fields_observed: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fields at least one recent record of this group populated',
          },
          canonical_policy: { type: 'string', enum: ['normalized', 'raw_only'] },
          canonical_policy_reason: { type: 'string' },
          last_received_at: { type: ['string', 'null'] },
          last_normalized_at: { type: ['string', 'null'] },
          last_seen_at: { type: 'string' },
        },
        required: [
          'record_type',
          'source_package',
          'identity_kind',
          'record_count',
          'canonical_policy',
          'canonical_policy_reason',
        ],
      },
      HealthConnectRawRecord: {
        type: 'object',
        description:
          'One retained raw record. DIAGNOSTIC data: deduplicated but not ' +
          'unit-normalized and not deconflicted against the direct bridges. ' +
          'Never contains secrets — the HMAC secret, PAT hashes and request ' +
          'body digests live in other tables and are not exposed anywhere.',
        properties: {
          id: { type: 'string' },
          integration_id: { type: ['string', 'null'] },
          record_type: { type: 'string' },
          source_package: { type: 'string' },
          source_uuid: {
            type: 'string',
            description: 'Health Connect record id, or a labelled derived identity',
          },
          identity_kind: { type: 'string', enum: ['uuid', 'derived'] },
          recorded_start_at: { type: ['string', 'null'] },
          recorded_end_at: { type: ['string', 'null'] },
          phoenix_date: {
            type: ['string', 'null'],
            description: 'Owner-local (America/Phoenix) calendar date of the start instant',
          },
          source_last_modified_at: { type: ['string', 'null'] },
          observed_fields: { type: 'array', items: { type: 'string' } },
          record: {
            type: 'object',
            additionalProperties: true,
            description:
              'The record object exactly as delivered, unknown fields included. Null and ABSENT are both preserved.',
          },
          first_seen_at: { type: 'string' },
          last_seen_at: { type: 'string' },
        },
        required: [
          'id',
          'record_type',
          'source_package',
          'source_uuid',
          'identity_kind',
          'record',
        ],
      },
      HealthConnectRecordPage: {
        type: 'object',
        properties: {
          records: {
            type: 'array',
            items: { $ref: '#/components/schemas/HealthConnectRawRecord' },
          },
          next_cursor: {
            type: ['string', 'null'],
            description: 'Pass back as ?cursor= for the next page; null on the last page',
          },
          max_page_size: { type: 'integer' },
        },
        required: ['records', 'next_cursor'],
      },
      HealthConnectIngestResult: {
        type: 'object',
        properties: {
          ingest_id: { type: 'string' },
          status: { type: 'string', enum: ['accepted', 'duplicate', 'test_ping'] },
          records: {
            type: 'object',
            properties: {
              received: { type: 'integer' },
              inserted: { type: 'integer' },
              updated: { type: 'integer' },
              duplicates: { type: 'integer' },
              rejected: { type: 'integer' },
            },
            required: ['received', 'inserted', 'updated', 'duplicates', 'rejected'],
          },
          normalization: {
            type: 'object',
            properties: {
              vitals_upserted: { type: 'integer' },
              nutrition_days_upserted: { type: 'integer' },
              skipped_unapproved: {
                type: 'integer',
                description: 'Retained raw but not written canonically (unsupported type, unapproved package, or inventory mode)',
              },
              invalid_records: {
                type: 'integer',
                description:
                  'Known-type records that failed the pinned structural contract. They are still RETAINED (the raw layer is lossless) and never discard the valid records delivered alongside them.',
              },
              invalid_by_type: {
                type: 'object',
                additionalProperties: { type: 'integer' },
                description: 'invalid_records broken down by record type',
              },
              invalid_issues: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Why those records failed. Reported separately from `errors`: a source sending a malformed sample is not an integration failure.',
              },
              errors: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'vitals_upserted',
              'nutrition_days_upserted',
              'skipped_unapproved',
              'invalid_records',
              'invalid_by_type',
              'invalid_issues',
              'errors',
            ],
          },
        },
        required: ['ingest_id', 'status', 'records', 'normalization'],
      },
      BatchResult: {
        type: 'object',
        description:
          'Per-record validation errors are reported by index and do not ' +
          'abort the batch; all valid records are written in one transaction.',
        properties: {
          inserted: { type: 'integer' },
          updated: { type: 'integer' },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                message: { type: 'string' },
              },
              required: ['index', 'message'],
            },
          },
        },
        required: ['inserted', 'updated', 'errors'],
      },
      ExerciseSet: {
        type: 'object',
        description:
          'One structured set. At least one of weight, reps or seconds is ' +
          'required; per_side marks per-arm/per-leg loads (never multiplied); ' +
          'warmup sets are excluded from derived working weight.',
        properties: {
          weight: { type: 'number' },
          reps: { type: 'integer' },
          seconds: { type: 'number' },
          per_side: { type: 'boolean' },
          warmup: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      Exercise: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          variant: { type: ['string', 'null'] },
          mode: { type: 'string', enum: ['weight', 'time'] },
          aliases: { type: 'array', items: { type: 'string' } },
          review_status: {
            type: 'string',
            enum: ['confirmed', 'unreviewed'],
            description: 'Auto-created (drifted) names arrive as `unreviewed`',
          },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
        },
        required: ['id', 'name', 'mode', 'aliases', 'review_status'],
      },
      ExerciseWrite: {
        type: 'object',
        description:
          'Names and aliases must resolve uniquely per user ' +
          '(case-insensitive over every name + alias) — collisions are 400.',
        properties: {
          name: { type: 'string' },
          variant: { type: ['string', 'null'] },
          mode: { type: 'string', enum: ['weight', 'time'], default: 'weight' },
          aliases: { type: 'array', items: { type: 'string' } },
          review_status: { type: 'string', enum: ['confirmed', 'unreviewed'] },
        },
        required: ['name'],
      },
      WorkoutEntry: {
        type: 'object',
        description:
          'One exercise within a session. working_weight/top_reps (weight ' +
          'mode) and top_seconds (time mode) are DERIVED from the heaviest ' +
          'non-warmup set on read, never stored.',
        properties: {
          id: { type: 'string' },
          position: { type: 'integer' },
          sets: { type: 'array', items: { $ref: '#/components/schemas/ExerciseSet' } },
          raw_sets: { type: ['string', 'null'], description: 'Original shorthand verbatim' },
          notes: { type: ['string', 'null'] },
          exercise: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              variant: { type: ['string', 'null'] },
              mode: { type: 'string', enum: ['weight', 'time'] },
              review_status: { type: 'string', enum: ['confirmed', 'unreviewed'] },
            },
            required: ['id', 'name', 'mode', 'review_status'],
          },
          working_weight: { type: ['number', 'null'] },
          top_reps: { type: ['integer', 'null'] },
          top_seconds: { type: ['number', 'null'] },
        },
        required: ['id', 'position', 'sets', 'exercise'],
      },
      Workout: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['strength', 'cardio', 'mobility', 'other'] },
          label: { type: ['string', 'null'] },
          started_at: { type: 'string', description: 'ISO 8601 UTC' },
          duration_min: { type: ['number', 'null'] },
          energy: { type: ['integer', 'null'], description: '1–5' },
          notes: { type: ['string', 'null'] },
          distance_mi: { type: ['number', 'null'] },
          avg_hr: { type: ['number', 'null'] },
          calories: { type: ['number', 'null'] },
          steps: { type: ['integer', 'null'] },
          machine: { type: ['string', 'null'] },
          perceived_effort: { type: ['integer', 'null'], description: '1–5' },
          entries: { type: 'array', items: { $ref: '#/components/schemas/WorkoutEntry' } },
        },
        required: ['id', 'type', 'started_at', 'entries'],
      },
      WorkoutEntryWrite: {
        type: 'object',
        description:
          'exercise_name resolves case-insensitively over the catalog ' +
          '(names + aliases); unknown names auto-create an `unreviewed` ' +
          'catalog entry — a workout write is never bounced on catalog drift.',
        properties: {
          exercise_name: { type: 'string' },
          sets: { type: 'array', items: { $ref: '#/components/schemas/ExerciseSet' } },
          raw_sets: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
        required: ['exercise_name'],
      },
      WorkoutWrite: {
        type: 'object',
        description:
          'Session plus nested entries in one call. For PATCH all fields are ' +
          'optional; `entries`, when present, is a FULL replacement.',
        properties: {
          type: { type: 'string', enum: ['strength', 'cardio', 'mobility', 'other'] },
          label: { type: ['string', 'null'] },
          started_at: { type: 'string', description: 'ISO date or datetime (normalized to UTC)' },
          duration_min: { type: ['number', 'null'] },
          energy: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
          notes: { type: ['string', 'null'] },
          distance_mi: { type: ['number', 'null'] },
          avg_hr: { type: ['number', 'null'] },
          calories: { type: ['number', 'null'] },
          steps: { type: ['integer', 'null'] },
          machine: { type: ['string', 'null'] },
          perceived_effort: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
          entries: {
            type: 'array',
            items: { $ref: '#/components/schemas/WorkoutEntryWrite' },
            maxItems: 100,
          },
        },
        required: ['type', 'started_at'],
      },
      ExerciseHistoryItem: {
        allOf: [
          { $ref: '#/components/schemas/WorkoutEntry' },
          {
            type: 'object',
            properties: {
              session: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  started_at: { type: 'string' },
                  type: { type: 'string' },
                  label: { type: ['string', 'null'] },
                },
                required: ['id', 'started_at', 'type'],
              },
            },
            required: ['session'],
          },
        ],
      },
      Checkin: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          week_start: { type: 'string', description: 'Monday, YYYY-MM-DD' },
          working: { type: ['string', 'null'] },
          not_working: { type: ['string', 'null'] },
          days_logged: { type: ['integer', 'null'], minimum: 0, maximum: 7 },
          avg_calories: { type: ['number', 'null'] },
          avg_protein_g: { type: ['number', 'null'] },
          avg_carbs_g: { type: ['number', 'null'] },
          avg_fat_g: { type: ['number', 'null'] },
          avg_fiber_g: { type: ['number', 'null'] },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
        },
        required: ['id', 'week_start'],
      },
      CheckinWrite: {
        type: 'object',
        description:
          'PUT replaces ALL manual fields — omitted fields clear to null. ' +
          'neck_in/waist_in are accepted but written through to vitals ' +
          '(metric neck/waist, source manual, recorded on the submission ' +
          'day), never stored on the check-in row.',
        properties: {
          working: { type: ['string', 'null'] },
          not_working: { type: ['string', 'null'] },
          days_logged: { type: ['integer', 'null'], minimum: 0, maximum: 7 },
          avg_calories: { type: ['number', 'null'] },
          avg_protein_g: { type: ['number', 'null'] },
          avg_carbs_g: { type: ['number', 'null'] },
          avg_fat_g: { type: ['number', 'null'] },
          avg_fiber_g: { type: ['number', 'null'] },
          neck_in: { type: 'number', description: 'Write-through to vitals (inches)' },
          waist_in: { type: 'number', description: 'Write-through to vitals (inches)' },
        },
      },
      Goal: {
        type: 'object',
        description:
          'kind "metric": metric_key/direction/target_value/target_date. ' +
          'kind "frequency": session_type/per_week. Kind is immutable; at ' +
          'most one ACTIVE metric goal per metric_key and one ACTIVE ' +
          'frequency goal per session_type.',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['metric', 'frequency'] },
          active: { type: 'boolean' },
          metric_key: { type: ['string', 'null'] },
          direction: { type: ['string', 'null'], enum: ['decrease', 'increase', 'maintain', null] },
          target_value: { type: ['number', 'null'] },
          target_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          session_type: {
            type: ['string', 'null'],
            enum: ['strength', 'cardio', 'mobility', 'other', null],
          },
          per_week: { type: ['integer', 'null'] },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
        },
        required: ['id', 'kind', 'active'],
      },
      GoalWrite: {
        type: 'object',
        description:
          'Create body — a discriminated union on `kind`. Metric: ' +
          '{ kind: "metric", metric_key, direction, target_value?, ' +
          'target_date? }. Frequency: { kind: "frequency", session_type, ' +
          'per_week }. PATCH takes the same fields (minus kind) partially.',
        properties: {
          kind: { type: 'string', enum: ['metric', 'frequency'] },
          active: { type: 'boolean', default: true },
          metric_key: { type: 'string' },
          direction: { type: 'string', enum: ['decrease', 'increase', 'maintain'] },
          target_value: { type: ['number', 'null'] },
          target_date: { type: ['string', 'null'] },
          session_type: { type: 'string', enum: ['strength', 'cardio', 'mobility', 'other'] },
          per_week: { type: 'integer', minimum: 1, maximum: 21 },
        },
        required: ['kind'],
      },
      LatestMeasurement: {
        type: ['object', 'null'],
        properties: {
          value: { type: 'number' },
          recorded_at: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['value', 'recorded_at', 'source'],
      },
      LatestBodyMeasurement: {
        type: 'object',
        properties: {
          value: { type: 'number', description: 'In the canonical stored unit' },
          unit: { type: ['string', 'null'], description: 'Canonical unit — "in"' },
          recorded_at: { type: 'string' },
          source: { type: 'string', description: 'Submitting integration id' },
        },
        required: ['value', 'unit', 'recorded_at', 'source'],
      },
      WeekRollup: {
        type: 'object',
        description:
          'Computed weekly rollup — nothing stored, recomputed per call. ' +
          'Weeks are Monday-anchored in the owner timezone (America/Phoenix). ' +
          'Averages are means over per-day values for the days that have ' +
          'data; missing metrics are null. prior_week_deltas is current − ' +
          'prior for each numeric rollup (null when either side has no data).',
        properties: {
          week_start: { type: 'string', description: 'Monday, YYYY-MM-DD' },
          week_end: { type: 'string', description: 'Sunday, YYYY-MM-DD (inclusive)' },
          timezone: { type: 'string' },
          sessions: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              by_type: {
                type: 'object',
                description: 'One entry per session type (strength/cardio/mobility/other)',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    labels: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['count', 'labels'],
                },
              },
            },
            required: ['total', 'by_type'],
          },
          body: {
            type: 'object',
            properties: {
              weight_avg: { type: ['number', 'null'] },
              weight_min: { type: ['number', 'null'], description: 'Lowest single weigh-in' },
              days_weighed: { type: 'integer' },
              body_fat_pct_avg: { type: ['number', 'null'] },
              fat_free_mass_avg: { type: ['number', 'null'] },
              neck_latest: { $ref: '#/components/schemas/LatestMeasurement' },
              waist_latest: { $ref: '#/components/schemas/LatestMeasurement' },
              measurements_latest: {
                type: 'object',
                description:
                  'Latest body-circumference reading per canonical metric key ' +
                  '(waist, neck, left_bicep, …) recorded on or before the ' +
                  "week's Sunday — never a future reading. SPARSE: a metric " +
                  'with no reading is ABSENT rather than null, so clients ' +
                  'iterate what is present. neck_latest/waist_latest carry the ' +
                  'same readings and are retained for backward compatibility. ' +
                  'Left/right keys are independent series — nothing here is ' +
                  'averaged, copied or derived.',
                additionalProperties: { $ref: '#/components/schemas/LatestBodyMeasurement' },
              },
            },
            required: ['weight_avg', 'weight_min', 'days_weighed', 'measurements_latest'],
          },
          recovery: {
            type: 'object',
            properties: {
              hrv_rmssd_avg: { type: ['number', 'null'] },
              readiness_score_avg: { type: ['number', 'null'] },
              sleep_score_avg: { type: ['number', 'null'] },
              sleep_duration_avg: { type: ['number', 'null'], description: 'Hours' },
            },
          },
          frequency_goals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                goal_id: { type: 'string' },
                session_type: { type: 'string' },
                per_week: { type: 'integer' },
                completed: { type: 'integer' },
                met: { type: 'boolean' },
              },
              required: ['goal_id', 'session_type', 'per_week', 'completed', 'met'],
            },
          },
          checkin: {
            oneOf: [{ $ref: '#/components/schemas/Checkin' }, { type: 'null' }],
          },
          prior_week_deltas: {
            type: 'object',
            additionalProperties: { type: ['number', 'null'] },
          },
        },
        required: [
          'week_start',
          'week_end',
          'timezone',
          'sessions',
          'body',
          'recovery',
          'frequency_goals',
          'checkin',
          'prior_week_deltas',
        ],
      },
      Metric: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          category: { type: 'string' },
          unit: { type: ['string', 'null'], description: 'Canonical stored unit' },
          value_type: { type: 'string', enum: ['number', 'ordinal'] },
          ordinal_labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ordinal metrics: value = index + 1',
          },
          aggregate: { type: 'string', enum: ['mean', 'sum', 'latest'] },
          min: { type: 'number' },
          max: { type: 'number' },
          intraday: {
            type: 'boolean',
            description: 'Metric keeps full timestamps instead of day granularity',
          },
        },
        required: ['key', 'label', 'category', 'unit', 'value_type', 'aggregate'],
      },
    },
  },
  paths: {
    '/api/v1': {
      get: {
        summary: 'API index — endpoints and scopes',
        security: [],
        responses: { '200': { description: 'API metadata' } },
      },
    },
    '/api/v1/medications': {
      get: listOperation('List medications (active only by default)', 'read:medications', [
        {
          name: 'include_inactive',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
      ]),
    },
    '/api/v1/conditions': {
      get: listOperation('List medical conditions', 'read:conditions'),
    },
    '/api/v1/allergies': {
      get: listOperation('List allergies', 'read:allergies'),
    },
    '/api/v1/labs': {
      get: listOperation('List lab results', 'read:labs', [
        { name: 'test', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'days', in: 'query', required: false, schema: { type: 'integer' } },
      ]),
    },
    '/api/v1/procedures': {
      get: listOperation('List procedures', 'read:procedures'),
    },
    '/api/v1/vaccines': {
      get: listOperation('List vaccine records', 'read:vaccines'),
    },
    '/api/v1/providers': {
      get: listOperation('List healthcare providers', 'read:providers'),
    },
    '/api/v1/profile': {
      get: listOperation('Get user profile (DOB, height, weight, …)', 'read:profile'),
    },
    '/api/v1/summary': {
      get: listOperation('Full health summary — all data in one call', 'read:all'),
    },
    '/api/v1/nutrition/daily': {
      get: {
        summary: 'Daily nutrition totals (canonical actual intake)',
        description:
          'Requires scope `read:nutrition` (or `read:all`). Returns the ' +
          'canonical daily snapshot table only — never raw webhook history. ' +
          'One row per (Phoenix calendar date, source package); a null ' +
          'nutrient is UNKNOWN, not zero.',
        parameters: [
          {
            name: 'start_date',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Inclusive YYYY-MM-DD lower bound',
          },
          {
            name: 'end_date',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Inclusive YYYY-MM-DD upper bound',
          },
          {
            name: 'source_package',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Exact Android package filter',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 400, maximum: 1000 },
          },
        ],
        responses: {
          '200': jsonResponse('Daily totals, date ascending', {
            type: 'array',
            items: { $ref: '#/components/schemas/NutritionDay' },
          }),
          ...VALIDATION_400,
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/integrations/health-connect/inventory': {
      get: {
        summary: 'Health Connect source inventory (what was retained)',
        description:
          'Requires scope `read:health_connect` (or `read:all`). ' +
          '`write:health_connect` does NOT satisfy it — the token pasted into ' +
          'a phone delivers records, it does not read the retained history ' +
          'back out.\n\n' +
          'Returns one entry per (record type × EXACT source package) the ' +
          'account has received, with counts, the first and last record ' +
          'instants, the fields that source actually populates, and whether ' +
          'the pair becomes canonical data (`canonical_policy`) with the ' +
          'reason it does not.\n\n' +
          'This is a source-coverage and ingestion-diagnostics surface. For ' +
          'product analytics prefer the canonical domain endpoints: ' +
          '`/api/v1/nutrition/daily` for actual intake and `/api/v1/vitals` ' +
          '(source `health_connect_daily`) for approved daily activity.',
        parameters: [
          {
            name: 'integration_id',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Exact integration id; another user’s id matches nothing',
          },
          {
            name: 'record_type',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Exact envelope array key, e.g. "nutrition"',
          },
          {
            name: 'source_package',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Exact Android package — never prefix-matched',
          },
        ],
        responses: {
          '200': jsonResponse('Inventory entries', {
            type: 'array',
            items: { $ref: '#/components/schemas/HealthConnectInventoryEntry' },
          }),
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/integrations/health-connect/records': {
      get: {
        summary: 'Retained raw Health Connect records (bounded, diagnostic)',
        description:
          'Requires scope `read:health_connect` (or `read:all`). ' +
          '`write:health_connect` does NOT satisfy it.\n\n' +
          'These are DIAGNOSTIC / SOURCE records: exactly what the phone ' +
          'delivered, deduplicated on ' +
          '`(user, record_type, source_package, source_uuid)` but NOT ' +
          'unit-normalized and NOT deconflicted against the direct Oura, ' +
          'Renpho and myAir bridges. Product analytics should read the ' +
          'canonical domain endpoints instead — `/api/v1/nutrition/daily` for ' +
          'intake, `/api/v1/vitals` for approved daily metrics, ' +
          '`/api/v1/workouts` for completed programmed workouts. This ' +
          'endpoint exists for the types that are deliberately raw-only and ' +
          'for debugging what a source actually sent.\n\n' +
          'Bounded by construction, with no permissive defaults: ' +
          '`integration_id` or `record_type` is REQUIRED, an explicit ' +
          '`start_at`/`end_at` range is REQUIRED and may span at most 400 ' +
          'days, and pages are cursor-paginated with a maximum size of 200. ' +
          'A missing bound is a 400, never "all of it".\n\n' +
          'Null and ABSENT are both preserved in `record`: the retained ' +
          'object is returned verbatim.',
        parameters: [
          {
            name: 'integration_id',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Required unless record_type is given',
          },
          {
            name: 'record_type',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Required unless integration_id is given',
          },
          {
            name: 'source_package',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Exact Android package — never prefix-matched',
          },
          {
            name: 'start_at',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
            description: 'Inclusive ISO 8601 lower bound on the record start instant',
          },
          {
            name: 'end_at',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
            description: 'Inclusive ISO 8601 upper bound; at most 400 days after start_at',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 50, maximum: 200 },
          },
          {
            name: 'cursor',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Opaque cursor from a previous response’s next_cursor',
          },
        ],
        responses: {
          '200': jsonResponse('One page of retained records', {
            $ref: '#/components/schemas/HealthConnectRecordPage',
          }),
          '400': {
            description:
              'Missing required filter, missing/invalid time range, range too wide, or a malformed cursor',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/integrations/health-connect/webhook': {
      post: {
        summary: 'Health Connect webhook receiver (Life Dashboard companion)',
        description:
          'Requires scope `write:health_connect`. Receives the Life Dashboard ' +
          'companion envelope, verifies `X-Signature` as ' +
          '`sha256=<hex HMAC-SHA256(secret, EXACT raw request body)>` using a ' +
          'constant-time comparison, retains every accepted source record ' +
          'losslessly, and normalizes only the record types and exact source ' +
          'packages the user approved in Settings.\n\n' +
          'Deduplication is per record on ' +
          '`(user, record_type, source_package, source_uuid)`, so retries, ' +
          'overlapping batches and backfills never duplicate. Nutrition is a ' +
          'daily snapshot: each affected America/Phoenix date is recomputed ' +
          'from the retained records and overwritten — an incoming subtotal ' +
          'is never added to a stored total.\n\n' +
          'A new integration starts in `inventory` status: records are stored ' +
          'and inventoried, but nothing is written canonically until exact ' +
          'source packages are approved.',
        parameters: [
          {
            name: 'X-Signature',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description:
              '`sha256=<lowercase hex>` over the exact raw body. Mandatory in ' +
              'production; waivable outside production with ' +
              'HEALTH_CONNECT_ALLOW_UNSIGNED=true.',
          },
        ],
        requestBody: jsonBody('#/components/schemas/HealthConnectEnvelope'),
        responses: {
          '200': jsonResponse(
            'Committed (including a valid no-op retry)',
            { $ref: '#/components/schemas/HealthConnectIngestResult' },
          ),
          '400': {
            description: 'Malformed JSON or invalid envelope',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '401': {
            description: 'Missing or invalid bearer token',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '403': {
            description:
              'Missing scope, no integration, paused/errored integration, or invalid/missing HMAC signature',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '413': {
            description: 'Payload larger than the configured limit (default 2 MiB)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '500': {
            description: 'Transaction or internal failure — nothing was committed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/api/v1/vitals': {
      get: {
        summary: 'List vital signs',
        description: 'Requires scope `read:vitals` (or `read:all`).',
        parameters: [
          { name: 'metric', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'days', in: 'query', required: false, schema: { type: 'integer' } },
          {
            name: 'from',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Inclusive lower bound (ISO day or datetime); wins over `days`',
          },
          {
            name: 'to',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Inclusive upper bound (a plain day means through end of day)',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 100, maximum: 1000 },
          },
        ],
        responses: {
          '200': {
            description: 'Vitals, recorded_at descending',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Vital' } },
              },
            },
          },
          ...AUTH_ERRORS,
        },
      },
      post: {
        summary: 'Upsert one vital record',
        description:
          'Requires scope `write:vitals` (or `write:all`). Idempotent on ' +
          '`(metric_key, recorded_at, source)` per user — re-posting the same ' +
          'tuple updates the existing row.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/VitalWrite' } },
          },
        },
        responses: {
          '201': {
            description: 'Record written',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VitalWriteResult' },
              },
            },
          },
          '400': {
            description: 'Validation failure (unknown metric, bad unit/label/date)',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/vitals/batch': {
      post: {
        summary: 'Upsert up to 500 vital records in one transaction',
        description:
          'Requires scope `write:vitals` (or `write:all`). Same per-record ' +
          'rules and upsert semantics as POST /api/v1/vitals; invalid records ' +
          'are reported by index without aborting the batch.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/BatchEnvelope' } },
          },
        },
        responses: {
          '200': {
            description: 'Batch reconciliation',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/BatchResult' } },
            },
          },
          '400': {
            description: 'Malformed envelope (missing records / more than 500)',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/vitals/latest': {
      get: {
        summary: 'Latest reading per metric',
        description:
          'Requires scope `read:vitals` (or `read:all`). One call for the ' +
          'newest reading of each requested metric; metrics with no data map ' +
          'to null. Metric keys must exist in the registry (max 25 per call).',
        parameters: [
          {
            name: 'metrics',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Comma-separated metric keys, e.g. `weight,hrv_rmssd,ahi`',
          },
        ],
        responses: {
          '200': jsonResponse('Object keyed by metric_key', {
            type: 'object',
            additionalProperties: {
              oneOf: [{ $ref: '#/components/schemas/Vital' }, { type: 'null' }],
            },
          }),
          ...VALIDATION_400,
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/workouts': {
      get: {
        summary: 'List workout sessions (nested entries, derived stats)',
        description:
          'Requires scope `read:fitness` (or `read:all`). started_at ' +
          'descending. `from`/`to` are inclusive ISO day or datetime bounds.',
        parameters: [
          { name: 'from', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'to', in: 'query', required: false, schema: { type: 'string' } },
          {
            name: 'type',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['strength', 'cardio', 'mobility', 'other'] },
          },
          {
            name: 'label',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Exact label match',
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 100, maximum: 500 },
          },
        ],
        responses: {
          '200': jsonResponse('Sessions with nested entries', {
            type: 'array',
            items: { $ref: '#/components/schemas/Workout' },
          }),
          ...VALIDATION_400,
          ...AUTH_ERRORS,
        },
      },
      post: {
        summary: 'Create a workout session (+ nested entries)',
        description:
          'Requires scope `write:fitness` (or `write:all`). Exercise names ' +
          'resolve via the catalog (names + aliases, case-insensitive); ' +
          'unknown names auto-create `unreviewed` catalog entries. A ' +
          '(user, started_at) collision returns 409 with the EXISTING ' +
          'workout in the body — agents treat that as "already logged".',
        requestBody: jsonBody('#/components/schemas/WorkoutWrite'),
        responses: {
          '201': jsonResponse('Created workout', { $ref: '#/components/schemas/Workout' }),
          ...VALIDATION_400,
          '409': jsonResponse('Duplicate started_at — body carries the existing workout', {
            type: 'object',
            properties: {
              error: { type: 'string' },
              workout: { $ref: '#/components/schemas/Workout' },
            },
            required: ['error', 'workout'],
          }),
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/workouts/{id}': {
      get: {
        summary: 'Get one workout session',
        description: 'Requires scope `read:fitness` (or `read:all`).',
        parameters: [pathParam('id', 'Workout session id')],
        responses: {
          '200': jsonResponse('The workout', { $ref: '#/components/schemas/Workout' }),
          ...NOT_FOUND_404,
          ...AUTH_ERRORS,
        },
      },
      patch: {
        summary: 'Correct a workout session',
        description:
          'Requires scope `write:fitness` (or `write:all`). Partial session ' +
          'fields; `entries`, when present, is a FULL replacement. Moving ' +
          'started_at onto another session returns 409 with `existing_id`.',
        parameters: [pathParam('id', 'Workout session id')],
        requestBody: jsonBody('#/components/schemas/WorkoutWrite'),
        responses: {
          '200': jsonResponse('Updated workout', { $ref: '#/components/schemas/Workout' }),
          ...VALIDATION_400,
          ...NOT_FOUND_404,
          '409': jsonResponse('started_at collision', {
            type: 'object',
            properties: { error: { type: 'string' }, existing_id: { type: 'string' } },
            required: ['error'],
          }),
          ...AUTH_ERRORS,
        },
      },
      delete: {
        summary: 'Delete a workout session (entries cascade)',
        description: 'Requires scope `write:fitness` (or `write:all`).',
        parameters: [pathParam('id', 'Workout session id')],
        responses: {
          '204': { description: 'Deleted' },
          ...NOT_FOUND_404,
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/exercises': {
      get: {
        summary: 'List the exercise catalog',
        description:
          'Requires scope `read:fitness` (or `read:all`). ' +
          '`review_status=unreviewed` surfaces auto-created drift for cleanup.',
        parameters: [
          {
            name: 'review_status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['confirmed', 'unreviewed'] },
          },
        ],
        responses: {
          '200': jsonResponse('Catalog, name ascending', {
            type: 'array',
            items: { $ref: '#/components/schemas/Exercise' },
          }),
          ...VALIDATION_400,
          ...AUTH_ERRORS,
        },
      },
      post: {
        summary: 'Create a catalog entry',
        description:
          'Requires scope `write:fitness` (or `write:all`). 400 when the ' +
          'name or an alias collides with an existing name/alias.',
        requestBody: jsonBody('#/components/schemas/ExerciseWrite'),
        responses: {
          '201': jsonResponse('Created exercise', { $ref: '#/components/schemas/Exercise' }),
          ...VALIDATION_400,
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/exercises/{id}': {
      patch: {
        summary: 'Edit a catalog entry (rename/alias/confirm)',
        description: 'Requires scope `write:fitness` (or `write:all`).',
        parameters: [pathParam('id', 'Exercise id')],
        requestBody: jsonBody('#/components/schemas/ExerciseWrite'),
        responses: {
          '200': jsonResponse('Updated exercise', { $ref: '#/components/schemas/Exercise' }),
          ...VALIDATION_400,
          ...NOT_FOUND_404,
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/exercises/{id}/history': {
      get: {
        summary: 'Recent entries for one exercise (newest session first)',
        description:
          'Requires scope `read:fitness` (or `read:all`). Each item is the ' +
          'entry (sets + derived stats) plus its session\'s when/what — ' +
          '"latest entry per exercise" in one call.',
        parameters: [
          pathParam('id', 'Exercise id'),
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20, maximum: 200 },
          },
        ],
        responses: {
          '200': jsonResponse('History items', {
            type: 'array',
            items: { $ref: '#/components/schemas/ExerciseHistoryItem' },
          }),
          ...NOT_FOUND_404,
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/checkins': {
      get: {
        summary: 'List weekly check-ins',
        description:
          'Requires scope `read:fitness` (or `read:all`). week_start ' +
          'descending; `from`/`to` compare against the Monday week keys.',
        parameters: [
          { name: 'from', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'to', in: 'query', required: false, schema: { type: 'string' } },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 100, maximum: 500 },
          },
        ],
        responses: {
          '200': jsonResponse('Check-ins', {
            type: 'array',
            items: { $ref: '#/components/schemas/Checkin' },
          }),
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/checkins/{weekStart}': {
      get: {
        summary: "Get one week's check-in",
        description:
          'Requires scope `read:fitness` (or `read:all`). weekStart must be ' +
          'a Monday `YYYY-MM-DD` (400 otherwise); 404 when no row exists.',
        parameters: [pathParam('weekStart', 'Monday, YYYY-MM-DD')],
        responses: {
          '200': jsonResponse('The check-in', { $ref: '#/components/schemas/Checkin' }),
          ...VALIDATION_400,
          ...NOT_FOUND_404,
          ...AUTH_ERRORS,
        },
      },
      put: {
        summary: "Upsert one week's check-in (full replacement)",
        description:
          'Requires scope `write:fitness` (or `write:all`). Replaces ALL ' +
          'manual fields — omitted fields clear to null. neck_in/waist_in ' +
          'write through to vitals.',
        parameters: [pathParam('weekStart', 'Monday, YYYY-MM-DD')],
        requestBody: jsonBody('#/components/schemas/CheckinWrite'),
        responses: {
          '200': jsonResponse('The stored check-in row', {
            $ref: '#/components/schemas/Checkin',
          }),
          ...VALIDATION_400,
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/weeks/{weekStart}': {
      get: {
        summary: 'Computed weekly rollup',
        description:
          'Requires scope `read:fitness` (or `read:all`). Sessions by type ' +
          'with labels, weigh-in aggregates + days weighed, body-composition ' +
          'and recovery averages over the days that exist, the latest body ' +
          'circumference per registered metric (measurements_latest), ' +
          'active frequency-goal progress, the check-in row, and prior-week ' +
          'deltas. Weeks are Monday-anchored in the owner timezone.',
        parameters: [pathParam('weekStart', 'Monday, YYYY-MM-DD')],
        responses: {
          '200': jsonResponse('The rollup', { $ref: '#/components/schemas/WeekRollup' }),
          ...VALIDATION_400,
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/goals': {
      get: {
        summary: 'List goals',
        description: 'Requires scope `read:fitness` (or `read:all`).',
        parameters: [
          { name: 'active', in: 'query', required: false, schema: { type: 'boolean' } },
          {
            name: 'kind',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['metric', 'frequency'] },
          },
        ],
        responses: {
          '200': jsonResponse('Goals, newest first', {
            type: 'array',
            items: { $ref: '#/components/schemas/Goal' },
          }),
          ...VALIDATION_400,
          ...AUTH_ERRORS,
        },
      },
      post: {
        summary: 'Create a goal',
        description:
          'Requires scope `write:fitness` (or `write:all`). At most one ' +
          'ACTIVE metric goal per metric_key and one ACTIVE frequency goal ' +
          'per session_type — violations return 409 with `existing_id`.',
        requestBody: jsonBody('#/components/schemas/GoalWrite'),
        responses: {
          '201': jsonResponse('Created goal', { $ref: '#/components/schemas/Goal' }),
          ...VALIDATION_400,
          '409': jsonResponse('An active goal for that key already exists', {
            type: 'object',
            properties: { error: { type: 'string' }, existing_id: { type: 'string' } },
            required: ['error'],
          }),
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/goals/{id}': {
      patch: {
        summary: 'Edit a goal (kind is immutable)',
        description:
          'Requires scope `write:fitness` (or `write:all`). Fields must ' +
          'match the row\'s kind; re-activating re-checks the one-active rule.',
        parameters: [pathParam('id', 'Goal id')],
        requestBody: jsonBody('#/components/schemas/GoalWrite'),
        responses: {
          '200': jsonResponse('Updated goal', { $ref: '#/components/schemas/Goal' }),
          ...VALIDATION_400,
          ...NOT_FOUND_404,
          '409': jsonResponse('An active goal for that key already exists', {
            type: 'object',
            properties: { error: { type: 'string' }, existing_id: { type: 'string' } },
            required: ['error'],
          }),
          ...AUTH_ERRORS,
        },
      },
    },
    '/api/v1/health-summary/refresh': {
      post: {
        summary: 'Warm the dashboard AI Health Overview cache',
        description:
          'Requires a broad scope (`write:all` or `read:all`). Regenerates the ' +
          "owner's AI Health Overview and upserts today's (owner-local, " +
          'America/Phoenix) cache row so the dashboard renders instantly. ' +
          'Intended for a daily cron; running it again simply refreshes. ' +
          '`generated` is false only when the owner has no data to summarize ' +
          'yet (the welcome message is never cached). 501 when AI is not ' +
          'configured on the instance.',
        responses: {
          '200': jsonResponse('Cache warmed', {
            type: 'object',
            properties: {
              generated: { type: 'boolean' },
              date: { type: 'string', description: 'Owner-local day, YYYY-MM-DD' },
            },
            required: ['generated', 'date'],
          }),
          ...AUTH_ERRORS,
          '501': {
            description: 'AI features not configured on this instance',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/api/v1/metrics': {
      get: {
        summary: 'Metric registry (public, no auth)',
        description:
          'The closed metric registry as JSON — every metric_key the write ' +
          'endpoints accept, with canonical units and ordinal labels. API ' +
          'shape only; never user data.',
        security: [],
        responses: {
          '200': {
            description: 'All supported metrics',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Metric' } },
              },
            },
          },
        },
      },
    },
    '/api/v1/openapi.json': {
      get: {
        summary: 'This OpenAPI document (public, no auth)',
        security: [],
        responses: { '200': { description: 'OpenAPI 3.1 document' } },
      },
    },
  },
} as const;
