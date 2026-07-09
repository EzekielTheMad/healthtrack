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
