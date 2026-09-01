/**
 * Derive the relay's record contract from the PINNED upstream JSON Schema.
 *
 * The alternative — a second, hand-copied table of every field of every one of
 * the 35 record arrays — is exactly the fragile thing this avoids: it drifts
 * the moment upstream renames a field, and the drift is silent because unknown
 * fields are (correctly) retained rather than rejected.
 *
 * So the field/type/required data has ONE source: the vendored
 * ./fixtures/webhook-schema.json. `scripts/generate-relay-schema.ts` runs the
 * derivation below and writes ./generated/relay-schema.ts; a drift test
 * re-derives and compares, so a schema bump that is not regenerated fails the
 * build instead of quietly narrowing what we understand.
 *
 * The schema is VENDORED, never fetched: builds and tests must not depend on
 * network availability or on an upstream force-push.
 *
 * What stays hand-maintained is the part a schema cannot express — each type's
 * ingestion SEMANTIC and whether this release writes canonical rows for it
 * (RECORD_TYPES in ./schema.ts). Those are product decisions about source
 * ownership, not facts about the wire format.
 */

/** The subset of JSON Schema the relay contract actually uses. */
export interface JsonSchemaNode {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  additionalProperties?: boolean;
}

export interface UpstreamSchema extends JsonSchemaNode {
  properties: Record<string, JsonSchemaNode>;
  required?: string[];
}

/** Primitive kinds a record field can take, collapsed for validation. */
export type RelayFieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

export interface RelayField {
  name: string;
  kind: RelayFieldKind;
  /** JSON Schema `format` — 'date-time' and 'date' drive time validation. */
  format?: string;
  required: boolean;
}

export interface RelayRecordArray {
  /** Envelope key, e.g. 'nutrition'. */
  type: string;
  fields: RelayField[];
  required: string[];
}

export interface RelayContract {
  /** Non-array envelope fields (timestamp, app_version, source, backfill, …). */
  envelopeFields: RelayField[];
  /** Every record array the relay can emit, sorted by key. */
  recordArrays: RelayRecordArray[];
}

function kindOf(node: JsonSchemaNode): RelayFieldKind {
  const raw = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (raw) {
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    case 'array':
      return 'array';
    case 'string':
      return 'string';
    default:
      // `source` at the envelope level is a bare `enum` with no `type`.
      if (node.enum && node.enum.every((v) => typeof v === 'string')) return 'string';
      return 'object';
  }
}

function fieldsOf(node: JsonSchemaNode): RelayField[] {
  const required = new Set(node.required ?? []);
  return Object.entries(node.properties ?? {})
    .map(([name, prop]) => ({
      name,
      kind: kindOf(prop),
      ...(prop.format ? { format: prop.format } : {}),
      required: required.has(name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read the pinned schema and produce the machine-derived contract. */
export function deriveRelayContract(schema: UpstreamSchema): RelayContract {
  const envelopeRequired = new Set(schema.required ?? []);
  const envelopeFields: RelayField[] = [];
  const recordArrays: RelayRecordArray[] = [];

  for (const [key, node] of Object.entries(schema.properties)) {
    if (node.type === 'array' && node.items) {
      recordArrays.push({
        type: key,
        fields: fieldsOf(node.items),
        required: [...(node.items.required ?? [])].sort(),
      });
      continue;
    }
    envelopeFields.push({
      name: key,
      kind: kindOf(node),
      ...(node.format ? { format: node.format } : {}),
      required: envelopeRequired.has(key),
    });
  }

  envelopeFields.sort((a, b) => a.name.localeCompare(b.name));
  recordArrays.sort((a, b) => a.type.localeCompare(b.type));
  return { envelopeFields, recordArrays };
}

/**
 * The generated module's source text. Emitted by
 * `npm run generate:relay-schema` and compared byte-for-byte by the drift test,
 * so "regenerate and commit" is the only way to change it.
 */
export function renderRelaySchemaModule(
  contract: RelayContract,
  commit: string,
): string {
  const lines: string[] = [];
  const push = (line = '') => lines.push(line);

  push('/**');
  push(' * GENERATED — do not edit by hand.');
  push(' *');
  push(' * Derived from the pinned Life Dashboard webhook schema');
  push(' * (src/lib/integrations/health-connect/fixtures/webhook-schema.json,');
  push(` * upstream commit ${commit}) by`);
  push(' * `npm run generate:relay-schema`. A drift test re-derives this file and');
  push(' * fails if it does not match, so the wire contract has exactly one source.');
  push(' *');
  push(' * Semantics and canonical-write policy are NOT here: those are product');
  push(' * decisions and live in ../schema.ts (RECORD_TYPES).');
  push(' */');
  push("import type { RelayContract } from '../derive-relay-schema';");
  push();
  push(`export const RELAY_SCHEMA_COMMIT = '${commit}';`);
  push();
  push('export const RELAY_CONTRACT: RelayContract = {');
  push('  envelopeFields: [');
  for (const f of contract.envelopeFields) push(`    ${renderField(f)},`);
  push('  ],');
  push('  recordArrays: [');
  for (const a of contract.recordArrays) {
    push('    {');
    push(`      type: '${a.type}',`);
    push('      fields: [');
    for (const f of a.fields) push(`        ${renderField(f)},`);
    push('      ],');
    push(`      required: [${a.required.map((r) => `'${r}'`).join(', ')}],`);
    push('    },');
  }
  push('  ],');
  push('};');
  push();
  push('/** Every record array key the pinned relay can emit. */');
  push('export const RELAY_RECORD_ARRAY_KEYS: readonly string[] =');
  push('  RELAY_CONTRACT.recordArrays.map((a) => a.type);');
  push();
  return lines.join('\n');
}

function renderField(f: RelayField): string {
  const parts = [`name: '${f.name}'`, `kind: '${f.kind}'`];
  if (f.format) parts.push(`format: '${f.format}'`);
  parts.push(`required: ${f.required}`);
  return `{ ${parts.join(', ')} }`;
}
