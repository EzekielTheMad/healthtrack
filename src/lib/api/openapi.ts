/**
 * Hand-maintained OpenAPI 3.1 description of the /api/v1 PAT surface, served
 * at GET /api/v1/openapi.json (public — API shape only, no user data).
 *
 * Kept honest by a drift test (src/app/api/v1/openapi.json/route.test.ts)
 * that asserts every route file under src/app/api/v1/** has a corresponding
 * path entry here. When you add a v1 route, add its path below.
 */
import { AVAILABLE_SCOPES } from '@/lib/api-scopes';

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
          'when provided, must equal the canonical unit (exception: weight ' +
          'accepts "kg" and is converted to lbs). `recorded_at` is normalized ' +
          'to day granularity unless the metric is intraday-capable.',
        properties: {
          metric_key: { type: 'string' },
          value: { type: 'number' },
          value_label: { type: 'string', description: 'Ordinal metrics only' },
          unit: { type: ['string', 'null'] },
          recorded_at: { type: 'string', description: 'ISO date or datetime' },
          source: { type: 'string', description: 'Device/bridge id, e.g. "oura", "myair"' },
          metadata: { type: 'object', additionalProperties: true },
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
            },
            required: ['weight_avg', 'weight_min', 'days_weighed'],
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
          'and recovery averages over the days that exist, latest neck/waist, ' +
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
