/**
 * Regenerate src/lib/integrations/health-connect/generated/relay-schema.ts
 * from the vendored Life Dashboard webhook schema.
 *
 *   npm run generate:relay-schema
 *
 * Run this after bumping the vendored schema (and UPSTREAM_SCHEMA_COMMIT in
 * src/lib/integrations/health-connect/schema.ts). The drift test in
 * relay-schema.test.ts fails if the checked-in file does not match what this
 * would emit, so the generated module can never silently fall behind.
 */
import fs from 'fs';
import path from 'path';
import {
  deriveRelayContract,
  renderRelaySchemaModule,
  type UpstreamSchema,
} from '../src/lib/integrations/health-connect/derive-relay-schema';
import { UPSTREAM_SCHEMA_COMMIT } from '../src/lib/integrations/health-connect/schema';

const HC_DIR = path.join(process.cwd(), 'src', 'lib', 'integrations', 'health-connect');
const SCHEMA_PATH = path.join(HC_DIR, 'fixtures', 'webhook-schema.json');
const OUT_PATH = path.join(HC_DIR, 'generated', 'relay-schema.ts');

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')) as UpstreamSchema;
const source = renderRelaySchemaModule(
  deriveRelayContract(schema),
  UPSTREAM_SCHEMA_COMMIT,
);

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
// The repo checks in CRLF-normalized TypeScript on Windows; write LF and let
// git's eol handling apply, exactly as an editor save would.
fs.writeFileSync(OUT_PATH, source, 'utf8');

console.log(
  `Wrote ${path.relative(process.cwd(), OUT_PATH)} — ` +
    `${deriveRelayContract(schema).recordArrays.length} record arrays ` +
    `@ ${UPSTREAM_SCHEMA_COMMIT.slice(0, 12)}`,
);
