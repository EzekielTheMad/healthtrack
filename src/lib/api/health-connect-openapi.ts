/**
 * The HealthConnectEnvelope request schema, DERIVED from the pinned relay
 * contract rather than hand-copied.
 *
 * The relay publishes 35 record arrays. Restating their fields by hand in the
 * OpenAPI document would be a second copy of the wire format that drifts
 * silently the moment upstream renames anything — the exact failure the
 * generated contract exists to prevent. So the property list is built from
 * RELAY_CONTRACT, and only the human explanations are written here.
 */
import { RELAY_CONTRACT } from '@/lib/integrations/health-connect/generated/relay-schema';
import {
  RECORD_TYPES,
  UPSTREAM_SCHEMA_COMMIT,
} from '@/lib/integrations/health-connect/schema';
import type { RelayField } from '@/lib/integrations/health-connect/derive-relay-schema';

const NOTE_BY_TYPE = new Map(RECORD_TYPES.map((r) => [r.type, r]));

/** JSON Schema type for a relay field, nullable where the relay sends null. */
function fieldSchema(field: RelayField): Record<string, unknown> {
  const base: Record<string, unknown> =
    field.kind === 'array'
      ? { type: 'array', items: { type: 'object', additionalProperties: true } }
      : field.kind === 'object'
        ? { type: 'object', additionalProperties: true }
        : { type: [field.kind, 'null'] };
  if (field.format) base.format = field.format;
  if (field.name === 'source') {
    base.description = 'Exact Android package that wrote the record to Health Connect';
  }
  if (field.name === 'uuid') {
    base.description = 'Stable Health Connect record id — the deduplication key';
  }
  return base;
}

function recordArraySchema(type: string, fields: RelayField[], required: string[]) {
  const def = NOTE_BY_TYPE.get(type);
  const description = [
    def ? `Semantic: ${def.semantic}.` : null,
    def ? (def.normalized ? 'Written to canonical tables.' : 'Retained RAW ONLY.') : null,
    def?.note ?? null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    type: 'array',
    ...(description ? { description } : {}),
    items: {
      type: 'object',
      properties: Object.fromEntries(fields.map((f) => [f.name, fieldSchema(f)])),
      required,
      additionalProperties: true,
    },
  };
}

/** Every record array the pinned relay can emit, plus the envelope fields. */
export function healthConnectEnvelopeSchema() {
  const properties: Record<string, unknown> = {
    timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601' },
    app_version: { type: 'string', description: 'Companion app version, e.g. "1.8.0"' },
    source: {
      type: 'string',
      enum: ['health_connect'],
      description:
        'Only health_connect is accepted here; healthkit_ios and screen_time payloads are refused.',
    },
    backfill: { type: 'boolean', description: 'True for a historical catch-up delivery' },
    window_start: { type: 'string', format: 'date-time' },
    window_end: { type: 'string', format: 'date-time' },
    _diagnostics: {
      type: 'object',
      additionalProperties: true,
      description:
        'Per-type read diagnostics from the phone (e.g. permission_denied). Retained verbatim in the ingest run; never treated as health data.',
    },
  };

  for (const array of RELAY_CONTRACT.recordArrays) {
    properties[array.type] = recordArraySchema(array.type, array.fields, array.required);
  }

  return {
    type: 'object',
    description:
      'Life Dashboard companion payload — the COMPLETE pinned contract, ' +
      `derived from docs/webhook-schema.json at upstream commit ${UPSTREAM_SCHEMA_COMMIT}. ` +
      'Unknown top-level fields and unknown record fields are retained verbatim ' +
      'in the raw layer and never become normalized health data, so a relay ' +
      'that adds a field does not start failing deliveries. Known record types ' +
      'are structurally validated and any failures are COUNTED and reported ' +
      '(normalization.invalid_records) without discarding the valid records ' +
      'delivered alongside them. Every per-record array carries optional `uuid` ' +
      '(the deduplication key) and `source` (the exact writing Android package). ' +
      'The companion’s "Send Test Ping" payload (`{"test": true, …}`) is also accepted.',
    properties,
    required: ['timestamp', 'app_version', 'source'],
    additionalProperties: true,
  };
}
