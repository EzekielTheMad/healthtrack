import { getSqlite } from '@/db';

/** Called only after the existing owner/recent-auth export fence. No secrets/files are read. */
export function exportFidelityData(ownerId: string) {
  const sqlite = getSqlite();
  const records = sqlite
    .prepare('SELECT * FROM clinical_records WHERE user_id=? ORDER BY received_at,id')
    .all(ownerId) as Array<
    Record<string, unknown> & {
      id: string;
      dependent_id: string | null;
      payload_json: string;
      legacy_table: string | null;
      legacy_id: string | null;
    }
  >;
  const scans = sqlite
    .prepare('SELECT * FROM body_scans WHERE user_id=? ORDER BY received_at,id')
    .all(ownerId) as Array<
    Record<string, unknown> & { payload_json: string; normalized_json: string }
  >;
  const historicalSources = records.flatMap((record) => {
    if (!record.legacy_id || !['lab_results', 'medications'].includes(record.legacy_table ?? ''))
      return [];
    const table = record.legacy_table === 'lab_results' ? 'lab_results' : 'medications';
    const source = sqlite
      .prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=? AND dependent_id IS ?`)
      .get(record.legacy_id, ownerId, record.dependent_id);
    return source
      ? [
          {
            table,
            record_id: record.legacy_id,
            superseded_by: record.id,
            source_history_only: true,
            source,
          },
        ]
      : [];
  });
  return {
    schema_version: 1,
    coverage: {
      subjects: 'All owned people',
      clinical_records: 'All stored typed records',
      body_scans: 'All stored scans; complete source payload and normalized evidence',
      corrections: 'All owned correction audits',
      legacy_sources:
        'Superseded rows are historical evidence; use typed current reads for conflict/revision interpretation',
    },
    clinical_records: records.map(({ payload_json, ...row }) => ({
      ...row,
      fact: JSON.parse(payload_json),
    })),
    body_scans: scans.map(({ payload_json, normalized_json, ...row }) => ({
      ...row,
      scan: JSON.parse(payload_json),
      measurements: JSON.parse(normalized_json),
    })),
    historical_source_rows: historicalSources,
    correction_history: sqlite
      .prepare('SELECT * FROM clinical_corrections WHERE user_id=? ORDER BY created_at,id')
      .all(ownerId),
  };
}
