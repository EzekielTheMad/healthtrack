import { randomUUID } from 'node:crypto';
import { getSqlite } from '@/db';
import { requireAuthz, NotFoundError, type AuthzScope } from '@/lib/authz';
import { FitnessConflictError, FitnessWriteError } from '@/lib/repos/_fitness';
import { scanInputSchema, type BodyScan } from './contracts';
import { contentRevision } from './security';
import { normalizeScanMeasurements } from '@/lib/metrics/scan-normalization';
import { compareScans } from './scan-selection';
import { deriveScanMeasurements } from './scan-derivations';
export { compareScans, selectCoherentScan } from './scan-selection';

type ScanRow = {
  id: string;
  user_id: string;
  dependent_id: string | null;
  payload_json: string;
  normalized_json: string;
  revision: string;
  received_at: string;
};
export const MAX_SCAN_ROWS = 1000;
export const MAX_SCAN_BYTES = 131072;
function toScan(row: ScanRow): BodyScan {
  const measurements: BodyScan['measurements'] = JSON.parse(row.normalized_json);
  return {
    id: row.id,
    user_id: row.user_id,
    dependent_id: row.dependent_id,
    scan: JSON.parse(row.payload_json),
    measurements,
    derived_measurements: deriveScanMeasurements(measurements),
    revision: row.revision,
    received_at: row.received_at,
  };
}
function validateReferences(scope: AuthzScope, scan: BodyScan['scan']) {
  const sqlite = getSqlite();
  for (const id of scan.supplement_record_ids ?? []) {
    if (id.startsWith('legacy:medication:')) {
      const legacyId = id.slice('legacy:medication:'.length);
      const legacy = sqlite
        .prepare('SELECT category FROM medications WHERE id=? AND user_id=? AND dependent_id IS ?')
        .get(legacyId, scope.ownerId, scope.dependentId) as { category: string | null } | undefined;
      if (!legacy || legacy.category !== 'supplement')
        throw new FitnessWriteError('A linked supplement must belong to this exact person.');
      continue;
    }
    const row = sqlite
      .prepare(
        'SELECT kind,payload_json FROM clinical_records WHERE id=? AND user_id=? AND dependent_id IS ?'
      )
      .get(id, scope.ownerId, scope.dependentId) as
      | { kind: string; payload_json: string }
      | undefined;
    if (!row || row.kind !== 'medication' || JSON.parse(row.payload_json).supplement !== true)
      throw new FitnessWriteError('A linked supplement must belong to this exact person.');
  }
  for (const source of scan.provenance.sources) {
    if (!source.document_id) continue;
    const document = sqlite
      .prepare('SELECT id FROM import_batches WHERE id=? AND user_id=? AND dependent_id IS ?')
      .get(source.document_id, scope.ownerId, scope.dependentId);
    if (!document)
      throw new FitnessWriteError('A source document must belong to this exact person.');
  }
}
export async function createBodyScan(
  actorId: string,
  scope: AuthzScope,
  input: unknown
): Promise<{ result: 'created' | 'existing'; scan: BodyScan }> {
  await requireAuthz(actorId, scope, 'vitals', 'write');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_SCAN_BYTES)
    throw new FitnessWriteError('A scan must not exceed 128 KiB.');
  const scan = scanInputSchema.parse(input);
  const measurements = normalizeScanMeasurements(scan);
  const revision = contentRevision(scan);
  const sqlite = getSqlite();
  return sqlite
    .transaction(() => {
      validateReferences(scope, scan);
      const prior = sqlite
        .prepare(
          'SELECT * FROM body_scans WHERE user_id=? AND dependent_id IS ? AND source=? AND external_id=?'
        )
        .get(scope.ownerId, scope.dependentId, scan.source, scan.external_id) as
        | ScanRow
        | undefined;
      if (prior) {
        if (prior.revision !== revision)
          throw new FitnessConflictError(
            'This source scan identity already has different content. Use a separate external_id for a distinct scan.'
          );
        return { result: 'existing' as const, scan: toScan(prior) };
      }
      const id = randomUUID();
      const received = new Date().toISOString();
      sqlite
        .prepare(
          'INSERT INTO body_scans(id,user_id,dependent_id,source,external_id,payload_json,normalized_json,revision,received_at)VALUES(?,?,?,?,?,?,?,?,?)'
        )
        .run(
          id,
          scope.ownerId,
          scope.dependentId,
          scan.source,
          scan.external_id,
          JSON.stringify(scan),
          JSON.stringify(measurements),
          revision,
          received
        );
      return {
        result: 'created' as const,
        scan: {
          id,
          user_id: scope.ownerId,
          dependent_id: scope.dependentId,
          scan,
          measurements,
          derived_measurements: deriveScanMeasurements(measurements),
          revision,
          received_at: received,
        },
      };
    })
    .immediate();
}
export async function listBodyScans(
  actorId: string,
  scope: AuthzScope,
  opts: { limit?: number; source?: string } = {}
): Promise<BodyScan[]> {
  await requireAuthz(actorId, scope, 'vitals', 'read');
  if (opts.source !== undefined && (!opts.source.trim() || opts.source.length > 100))
    throw new FitnessWriteError('Source must be between 1 and 100 characters.');
  const limit = Math.min(MAX_SCAN_ROWS, Math.max(1, Math.trunc(opts.limit ?? 100)));
  if (!Number.isFinite(limit)) throw new FitnessWriteError('Invalid scan limit.');
  const rows = getSqlite()
    .prepare(
      'SELECT * FROM body_scans WHERE user_id=? AND dependent_id IS ?' +
        (opts.source ? ' AND source=?' : '') +
        ' ORDER BY received_at DESC,id ASC LIMIT ?'
    )
    .all(
      scope.ownerId,
      scope.dependentId,
      ...(opts.source ? [opts.source] : []),
      MAX_SCAN_ROWS + 1
    ) as ScanRow[];
  if (rows.length > MAX_SCAN_ROWS)
    throw new FitnessWriteError(
      'Scan history exceeds 1000 sessions. Choose a source to narrow the history.'
    );
  return rows.map(toScan).sort(compareScans).slice(0, limit);
}
export async function getBodyScan(
  actorId: string,
  scope: AuthzScope,
  id: string
): Promise<BodyScan> {
  await requireAuthz(actorId, scope, 'vitals', 'read');
  const row = getSqlite()
    .prepare('SELECT * FROM body_scans WHERE id=? AND user_id=? AND dependent_id IS ?')
    .get(id, scope.ownerId, scope.dependentId) as ScanRow | undefined;
  if (!row) throw new NotFoundError();
  return toScan(row);
}
