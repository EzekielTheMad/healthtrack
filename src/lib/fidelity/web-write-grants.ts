/** Server-only opt-ins include persisted targets, not just incoming report fields. */
import { getSqlite } from '@/db';
import { intakeSchema, type ClinicalIntake, type ScanInput } from './contracts';
import { WEB_SCAN_METRICS } from './web-scan-contracts';
const oldKinds = new Set(['lab', 'medication', 'medication_event']);
const newMetrics = new Set<string>(WEB_SCAN_METRICS);
function extendedBatch(value: { items?: { fact?: { kind?: string } }[] }) {
  return (
    !Array.isArray(value.items) || value.items.some((item) => !oldKinds.has(item.fact?.kind ?? ''))
  );
}
export function clinicalReportGrantRequired(ownerId: string, intake: ClinicalIntake): boolean {
  if (extendedBatch(intake)) return true;
  const sqlite = getSqlite();
  for (const item of intake.items) {
    if (!item.target_id) continue;
    const target = sqlite
      .prepare(
        'SELECT kind FROM clinical_records WHERE id=? AND user_id=? AND dependent_id IS NULL'
      )
      .get(item.target_id, ownerId) as { kind: string } | undefined;
    if (target && !oldKinds.has(target.kind)) return true;
    if (
      item.target_id.startsWith('legacy:condition:') ||
      item.target_id.startsWith('legacy:procedure:')
    )
      return true;
  }
  const previous = sqlite
    .prepare(
      'SELECT payload_json FROM clinical_intake_batches WHERE external_id=? AND user_id=? AND dependent_id IS NULL'
    )
    .get(intake.external_id, ownerId) as { payload_json: string } | undefined;
  return Boolean(previous && extendedBatch(JSON.parse(previous.payload_json)));
}
export function hasExtendedScanFields(
  scan: Pick<ScanInput, 'measurements' | 'vendor_results'>
): boolean {
  return (
    scan.vendor_results !== undefined ||
    scan.measurements.some((m) => newMetrics.has(m.metric_key) || m.definition !== undefined)
  );
}
export function scanReportGrantRequired(ownerId: string, scan: ScanInput): boolean {
  if (hasExtendedScanFields(scan)) return true;
  const previous = getSqlite()
    .prepare(
      'SELECT payload_json FROM body_scans WHERE user_id=? AND dependent_id IS NULL AND source=? AND external_id=?'
    )
    .get(ownerId, scan.source, scan.external_id) as { payload_json: string } | undefined;
  return Boolean(previous && hasExtendedScanFields(JSON.parse(previous.payload_json)));
}

/** A legacy intake grant does not disclose newly scoped report previews. */
export function clinicalBatchReportGrantRequired(ownerId: string, batchId: string): boolean {
  const row = getSqlite()
    .prepare(
      'SELECT payload_json FROM clinical_intake_batches WHERE id=? AND user_id=? AND dependent_id IS NULL'
    )
    .get(batchId, ownerId) as { payload_json: string } | undefined;
  if (!row) return false;
  const intake = intakeSchema.safeParse(JSON.parse(row.payload_json));
  // Previews include selected target facts even when the staged item has another kind.
  return !intake.success || clinicalReportGrantRequired(ownerId, intake.data);
}
