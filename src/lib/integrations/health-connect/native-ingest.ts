import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb, getSqlite } from '@/db';
import { findIntegrationRow, type HealthConnectIntegrationRow } from '@/lib/repos/health-connect';
import { rebuildNutritionDays } from './rebuild-nutrition';
import {
  canonicalNativeInstant,
  nativeBatchSchema,
  nativeNutritionDataSchema,
  type NativeBatch,
  type NativeBatchResult,
  type NativeRecord,
} from './native-schema';
import {
  NATIVE_METRIC_KEYS,
  collapseNativeDay,
  nativeRecordDay,
  nativeSource,
} from './native-normalize';
import { DAILY_TOTALS_SOURCE, METERS_PER_MILE } from './normalize-activity';
import { AGGREGATE_SOURCE_PACKAGE, dailyTotalsSchema } from './schema';
import { calendarDayWindow } from '@/lib/calendar-window';

export class NativeSyncError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
export interface NativeDeviceIdentity {
  id: string;
  userId: string;
  integrationId: string;
  generation: string;
  keyId: string;
}
interface RawRow {
  id: string;
  record_type: string;
  source_package: string;
  source_uuid: string;
  recorded_start_at: string;
  recorded_end_at: string | null;
  source_last_modified_at: string | null;
  payload_json: string;
  deleted_at: string | null;
}
interface Scan {
  scan_id: string;
  device_id: string;
  generation: string;
  user_id: string;
  record_type: string;
  packages_json: string;
  start_at: string;
  end_at: string;
  begin_sequence: number;
  next_page: number;
  completed_at: string | null;
}
const identityWhere = 'user_id=? AND record_type=? AND source_package=? AND source_uuid=?';

/** Called inside the same write lock as the batch commit. Authentication
 * before the transaction alone cannot fence an enrollment replaced midflight. */
function assertActive(sqlite: Database.Database, device: NativeDeviceIdentity) {
  const active = sqlite
    .prepare(
      `SELECT 1 FROM mobile_devices d JOIN mobile_delivery_modes m ON m.user_id=d.user_id JOIN api_keys k ON k.id=d.key_id
    WHERE d.id=? AND d.user_id=? AND d.integration_id=? AND d.generation=? AND d.revoked_at IS NULL
    AND k.id=? AND k.user_id=d.user_id AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR julianday(k.expires_at)>julianday('now'))
    AND EXISTS(SELECT 1 FROM json_each(k.scopes) WHERE value='write:health_connect')
    AND m.mode='native' AND m.device_id=d.id`
    )
    .get(device.id, device.userId, device.integrationId, device.generation, device.keyId);
  if (!active)
    throw new NativeSyncError(
      401,
      'device_inactive',
      'This phone is no longer the active delivery device.'
    );
}
function rowRecord(row: RawRow): NativeRecord | null {
  try {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (payload.native_protocol !== 2) return null;
    return {
      record_type: row.record_type,
      source_package: row.source_package,
      record_id: row.source_uuid,
      start_time:
        typeof payload.start_time === 'string' ? payload.start_time : row.recorded_start_at,
      ...(row.recorded_end_at
        ? {
            end_time: typeof payload.end_time === 'string' ? payload.end_time : row.recorded_end_at,
          }
        : {}),
      source_modified_at: row.source_last_modified_at!,
      data: payload.native_data as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
function rawPayload(record: NativeRecord) {
  // Compatible nutrition fields let the one existing day-rebuild service
  // reconcile native and relay deliveries of the same stable UUID.
  return JSON.stringify({
    ...record.data,
    uuid: record.record_id,
    source: record.source_package,
    start_time: record.start_time,
    ...(record.end_time ? { end_time: record.end_time } : {}),
    native_protocol: 2,
    native_data: record.data,
  });
}
export function ingestNativeBatch(
  device: NativeDeviceIdentity,
  input: unknown,
  digest: string
): NativeBatchResult {
  const parsed = nativeBatchSchema.safeParse(input);
  if (!parsed.success)
    throw new NativeSyncError(
      400,
      'invalid_batch',
      'Invalid native sync batch. Check the protocol, event fields, and record limits.'
    );
  const batch = parsed.data;
  if (batch.device_generation !== device.generation)
    throw new NativeSyncError(409, 'generation_mismatch', 'Pair this phone again before syncing.');
  const sqlite = getSqlite();
  return sqlite
    .transaction(() => {
      assertActive(sqlite, device);
      const prior = sqlite
        .prepare(
          `SELECT body_sha256,result_json FROM health_connect_native_batches
      WHERE device_id=? AND generation=? AND batch_id=?`
        )
        .get(device.id, device.generation, batch.batch_id) as
        | { body_sha256: string; result_json: string }
        | undefined;
      if (prior) {
        if (prior.body_sha256 !== digest)
          throw new NativeSyncError(
            409,
            'batch_mismatch',
            'A batch ID cannot be reused for different bytes.'
          );
        return JSON.parse(prior.result_json) as NativeBatchResult;
      }
      sqlite
        .prepare(
          'INSERT OR IGNORE INTO health_connect_native_state(device_id,generation) VALUES(?,?)'
        )
        .run(device.id, device.generation);
      const state = sqlite
        .prepare(
          'SELECT generation,last_sequence FROM health_connect_native_state WHERE device_id=?'
        )
        .get(device.id) as { generation: string; last_sequence: number };
      if (state.generation !== device.generation || batch.sequence !== state.last_sequence + 1)
        throw new NativeSyncError(
          409,
          'sequence_mismatch',
          `Expected sequence ${state.last_sequence + 1}. Retry the pending batch first.`
        );
      const integration = findIntegrationRow(getDb(), device.userId);
      if (
        !integration ||
        integration.id !== device.integrationId ||
        ['paused', 'error'].includes(integration.status)
      )
        throw new NativeSyncError(
          403,
          'integration_paused',
          'Health Connect delivery is paused or unavailable.'
        );
      const now = new Date().toISOString();
      const result: NativeBatchResult = {
        protocol_version: 2,
        batch_id: batch.batch_id,
        sequence: batch.sequence,
        status: 'accepted',
        received_at: now,
        records: { inserted: 0, updated: 0, deleted: 0, unchanged: 0, stale: 0 },
        normalization: {
          vitals_upserted: 0,
          vitals_deleted: 0,
          nutrition_days_upserted: 0,
          nutrition_days_deleted: 0,
          skipped_unapproved: 0,
          invalid_records: 0,
        },
      };
      const touched = new Map<string, { type: string; pkg: string; date: string }>();
      const touch = (record: NativeRecord) => {
        const date = nativeRecordDay(record);
        touched.set(JSON.stringify([record.record_type, record.source_package, date]), {
          type: record.record_type,
          pkg: record.source_package,
          date,
        });
      };
      const touchRaw = (row: RawRow) => {
        const record = rowRecord(row);
        if (record) touch(record);
        else if (row.record_type === 'nutrition')
          touch({
            record_type: 'nutrition',
            source_package: row.source_package,
            record_id: row.source_uuid,
            start_time: row.recorded_start_at,
            source_modified_at: row.source_last_modified_at ?? now,
            data: {},
          });
      };
      const getRaw = (type: string, pkg: string, id: string) =>
        sqlite
          .prepare(`SELECT * FROM health_connect_raw_records WHERE ${identityWhere}`)
          .get(device.userId, type, pkg, id) as RawRow | undefined;
      const tombstone = (row: RawRow, reason: string) => {
        if (row.deleted_at) {
          result.records.unchanged++;
          return;
        }
        touchRaw(row);
        sqlite
          .prepare(
            `UPDATE health_connect_raw_records SET deleted_at=?,last_seen_at=? WHERE id=? AND user_id=?`
          )
          .run(now, now, row.id, device.userId);
        sqlite
          .prepare(
            `INSERT INTO health_connect_native_records(user_id,record_type,source_package,source_uuid,device_id,generation,sequence,source_modified_at,deleted_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,record_type,source_package,source_uuid) DO UPDATE SET device_id=excluded.device_id,generation=excluded.generation,sequence=excluded.sequence,deleted_at=excluded.deleted_at`
          )
          .run(
            device.userId,
            row.record_type,
            row.source_package,
            row.source_uuid,
            device.id,
            device.generation,
            batch.sequence,
            row.source_last_modified_at,
            now
          );
        sqlite
          .prepare(
            `INSERT INTO health_connect_native_deletions(id,user_id,record_type,source_package,source_uuid,device_id,generation,sequence,reason,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            crypto.randomUUID(),
            device.userId,
            row.record_type,
            row.source_package,
            row.source_uuid,
            device.id,
            device.generation,
            batch.sequence,
            reason,
            now
          );
        result.records.deleted++;
      };
      const upsert = (record: NativeRecord) => {
        const old = getRaw(record.record_type, record.source_package, record.record_id);
        const marker = sqlite
          .prepare(
            `SELECT source_modified_at,deleted_at FROM health_connect_native_records WHERE user_id=? AND source_uuid=? AND record_type IN (?,'*') AND source_package IN (?,'*') ORDER BY deleted_at DESC LIMIT 1`
          )
          .get(device.userId, record.record_id, record.record_type, record.source_package) as
          | { source_modified_at: string | null; deleted_at: string | null }
          | undefined;
        const modified = canonicalNativeInstant(record.source_modified_at);
        // A deleted HC UUID is permanent. Recreating a measurement in Health
        // Connect creates a new UUID; stale snapshots cannot revive this one.
        // The legacy relay had no provider modification timestamp; some old
        // rows carry receipt time here. It cannot order native HC revisions.
        const priorModified =
          marker?.source_modified_at ??
          (old && rowRecord(old) ? old.source_last_modified_at : null);
        const previousModified = priorModified ? canonicalNativeInstant(priorModified) : null;
        if (
          marker?.deleted_at ||
          old?.deleted_at ||
          (previousModified && modified < previousModified)
        ) {
          result.records.stale++;
          return;
        }
        const payload = rawPayload(record);
        if (
          old &&
          !old.deleted_at &&
          old.payload_json === payload &&
          old.source_last_modified_at === modified
        ) {
          sqlite
            .prepare(
              `UPDATE health_connect_native_records SET device_id=?,generation=?,sequence=? WHERE ${identityWhere}`
            )
            .run(
              device.id,
              device.generation,
              batch.sequence,
              device.userId,
              record.record_type,
              record.source_package,
              record.record_id
            );
          sqlite
            .prepare(
              'UPDATE health_connect_raw_records SET last_seen_at=?,last_ingest_id=? WHERE id=? AND user_id=?'
            )
            .run(now, batch.batch_id, old.id, device.userId);
          result.records.unchanged++;
          return;
        }
        if (
          old?.source_last_modified_at === modified &&
          old.payload_json !== payload &&
          rowRecord(old)
        ) {
          result.records.stale++;
          return;
        }
        if (old) touchRaw(old);
        sqlite
          .prepare(
            `INSERT INTO health_connect_raw_records(id,integration_id,user_id,record_type,source_package,source_uuid,identity_kind,recorded_start_at,recorded_end_at,source_last_modified_at,payload_json,first_seen_at,last_seen_at,last_ingest_id,deleted_at)
        VALUES(?,?,?,?,?,?,'uuid',?,?,?,?,?,?,?,NULL) ON CONFLICT(user_id,record_type,source_package,source_uuid) DO UPDATE SET integration_id=excluded.integration_id,recorded_start_at=excluded.recorded_start_at,recorded_end_at=excluded.recorded_end_at,source_last_modified_at=excluded.source_last_modified_at,payload_json=excluded.payload_json,last_seen_at=excluded.last_seen_at,last_ingest_id=excluded.last_ingest_id,deleted_at=NULL`
          )
          .run(
            old?.id ?? crypto.randomUUID(),
            integration.id,
            device.userId,
            record.record_type,
            record.source_package,
            record.record_id,
            new Date(record.start_time).toISOString(),
            record.end_time ? new Date(record.end_time).toISOString() : null,
            modified,
            payload,
            now,
            now,
            batch.batch_id
          );
        sqlite
          .prepare(
            `INSERT INTO health_connect_native_records(user_id,record_type,source_package,source_uuid,device_id,generation,sequence,source_modified_at,deleted_at)
        VALUES(?,?,?,?,?,?,?,?,NULL) ON CONFLICT(user_id,record_type,source_package,source_uuid) DO UPDATE SET device_id=excluded.device_id,generation=excluded.generation,sequence=excluded.sequence,source_modified_at=excluded.source_modified_at,deleted_at=NULL`
          )
          .run(
            device.userId,
            record.record_type,
            record.source_package,
            record.record_id,
            device.id,
            device.generation,
            batch.sequence,
            modified
          );
        if (old) result.records.updated++;
        else result.records.inserted++;
        touch(record);
      };
      const scanById = (id: string) => {
        const scan = sqlite
          .prepare(
            'SELECT * FROM health_connect_native_rescans WHERE scan_id=? AND device_id=? AND generation=? AND user_id=?'
          )
          .get(id, device.id, device.generation, device.userId) as Scan | undefined;
        if (!scan || scan.completed_at)
          throw new NativeSyncError(
            409,
            'scan_inactive',
            'Rescan does not exist or is already complete.'
          );
        return scan;
      };
      for (const event of batch.events) {
        if (event.kind === 'upsert') upsert(event.record);
        else if (event.kind === 'delete') {
          const rows = sqlite
            .prepare(
              `SELECT * FROM health_connect_raw_records WHERE user_id=? AND source_uuid=?${event.record_type ? ' AND record_type=?' : ''}${event.source_package ? ' AND source_package=?' : ''}`
            )
            .all(
              device.userId,
              event.record_id,
              ...(event.record_type ? [event.record_type] : []),
              ...(event.source_package ? [event.source_package] : [])
            ) as RawRow[];
          for (const row of rows) tombstone(row, 'provider_delete');
          if (!rows.length) {
            // A delete may arrive before the initial upload or after the read
            // permission vanished. Retain its ID fence without inventing data.
            sqlite
              .prepare(
                `INSERT INTO health_connect_native_records(user_id,record_type,source_package,source_uuid,device_id,generation,sequence,deleted_at)
            VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,record_type,source_package,source_uuid) DO UPDATE SET deleted_at=excluded.deleted_at,sequence=excluded.sequence`
              )
              .run(
                device.userId,
                event.record_type ?? '*',
                event.source_package ?? '*',
                event.record_id,
                device.id,
                device.generation,
                batch.sequence,
                now
              );
            result.records.unchanged++;
          }
        } else if (event.kind === 'daily_snapshot') {
          // This is a full snapshot, including omitted fields. Absent fields
          // become gaps; unchanged historical values preserve their receipt.
          // Retain a stable aggregate row as provenance; never sum it with raw
          // phone/watch intervals, and never create per-package activity totals.
          sqlite
            .prepare(
              `INSERT INTO health_connect_raw_records(id,integration_id,user_id,record_type,source_package,source_uuid,identity_kind,recorded_start_at,payload_json,first_seen_at,last_seen_at,last_ingest_id)
          VALUES(?,?,?,'daily_totals',?,?,'derived',?,?,?,?,?) ON CONFLICT(user_id,record_type,source_package,source_uuid) DO UPDATE SET payload_json=excluded.payload_json,last_seen_at=excluded.last_seen_at,last_ingest_id=excluded.last_ingest_id`
            )
            .run(
              crypto.randomUUID(),
              integration.id,
              device.userId,
              AGGREGATE_SOURCE_PACKAGE,
              `date:${event.date}`,
              `${event.date}T00:00:00.000Z`,
              JSON.stringify({ date: event.date, ...event.values, native_protocol: 2 }),
              now,
              now,
              batch.batch_id
            );
          if (
            integration.status !== 'active' ||
            !integration.enabledTypes.includes('daily_totals')
          ) {
            result.normalization.skipped_unapproved++;
            continue;
          }
          applyNativeDailySnapshot(
            sqlite,
            device.userId,
            integration.id,
            { date: event.date, ...event.values },
            result.normalization
          );
        } else if (event.kind === 'rescan_begin') {
          const scope = event.scope;
          const existing = sqlite
            .prepare('SELECT 1 FROM health_connect_native_rescans WHERE scan_id=?')
            .get(scope.scan_id);
          if (existing)
            throw new NativeSyncError(409, 'scan_exists', 'A rescan ID cannot be reused.');
          sqlite
            .prepare(
              `INSERT INTO health_connect_native_rescans(scan_id,device_id,generation,user_id,record_type,packages_json,start_at,end_at,begin_sequence) VALUES(?,?,?,?,?,?,?,?,?)`
            )
            .run(
              scope.scan_id,
              device.id,
              device.generation,
              device.userId,
              scope.record_type,
              JSON.stringify([...new Set(scope.source_packages)]),
              new Date(scope.start_time).toISOString(),
              new Date(scope.end_time).toISOString(),
              batch.sequence
            );
        } else if (event.kind === 'rescan_page') {
          const scan = scanById(event.scan_id),
            packages = JSON.parse(scan.packages_json) as string[];
          if (event.page !== scan.next_page)
            throw new NativeSyncError(
              409,
              'scan_page_order',
              'Rescan pages must be submitted in order.'
            );
          for (const record of event.records) {
            const at = new Date(record.start_time).toISOString();
            if (
              record.record_type !== scan.record_type ||
              !packages.includes(record.source_package) ||
              at < scan.start_at ||
              at >= scan.end_at
            )
              throw new NativeSyncError(
                400,
                'scan_outside_scope',
                'A rescan record is outside its exact authorized window.'
              );
            upsert(record);
            sqlite
              .prepare(
                'INSERT OR IGNORE INTO health_connect_native_scan_seen(scan_id,source_package,source_uuid) VALUES(?,?,?)'
              )
              .run(scan.scan_id, record.source_package, record.record_id);
          }
          sqlite
            .prepare(
              'UPDATE health_connect_native_rescans SET next_page=next_page+1 WHERE scan_id=?'
            )
            .run(scan.scan_id);
        } else {
          const scan = scanById(event.scan_id),
            packages = JSON.parse(scan.packages_json) as string[];
          if (event.page_count !== scan.next_page)
            throw new NativeSyncError(
              409,
              'scan_incomplete',
              'All rescan pages must be acknowledged before completion.'
            );
          const rows = sqlite
            .prepare(
              `SELECT r.* FROM health_connect_raw_records r
          WHERE r.user_id=? AND r.record_type=? AND r.recorded_start_at>=? AND r.recorded_start_at<? AND r.deleted_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM health_connect_native_scan_seen s WHERE s.scan_id=? AND s.source_package=r.source_package AND s.source_uuid=r.source_uuid)
          AND NOT EXISTS(SELECT 1 FROM health_connect_native_records n WHERE n.user_id=r.user_id AND n.record_type=r.record_type AND n.source_package=r.source_package AND n.source_uuid=r.source_uuid AND n.device_id=? AND n.generation=? AND n.sequence>?)`
            )
            .all(
              device.userId,
              scan.record_type,
              scan.start_at,
              scan.end_at,
              scan.scan_id,
              device.id,
              device.generation,
              scan.begin_sequence
            ) as RawRow[];
          for (const row of rows)
            if (packages.includes(row.source_package)) tombstone(row, 'completed_rescan');
          sqlite
            .prepare('UPDATE health_connect_native_rescans SET completed_at=? WHERE scan_id=?')
            .run(now, scan.scan_id);
        }
      }
      rebuildTouched(sqlite, device.userId, integration, touched.values(), result, batch);
      sqlite
        .prepare(
          `UPDATE health_connect_native_state SET last_sequence=?,last_read_at=?,last_received_at=? WHERE device_id=?`
        )
        .run(batch.sequence, batch.read_at, now, device.id);
      sqlite.prepare('UPDATE mobile_devices SET last_contact_at=? WHERE id=?').run(now, device.id);
      const normalized =
        result.normalization.vitals_upserted +
          result.normalization.vitals_deleted +
          result.normalization.nutrition_days_upserted +
          result.normalization.nutrition_days_deleted >
        0;
      sqlite
        .prepare(
          `UPDATE health_connect_integrations SET last_received_at=?,last_app_version=?,last_error=NULL,updated_at=?,last_normalized_at=CASE WHEN ? THEN ? ELSE last_normalized_at END WHERE id=? AND user_id=?`
        )
        .run(now, batch.app_version, now, normalized ? 1 : 0, now, integration.id, device.userId);
      sqlite
        .prepare(
          `INSERT INTO health_connect_native_batches(device_id,generation,batch_id,sequence,body_sha256,result_json,received_at) VALUES(?,?,?,?,?,?,?)`
        )
        .run(
          device.id,
          device.generation,
          batch.batch_id,
          batch.sequence,
          digest,
          JSON.stringify(result),
          now
        );
      sqlite
        .prepare(
          `INSERT INTO health_connect_ingest_runs(id,integration_id,user_id,payload_timestamp,app_version,body_sha256,is_backfill,status,received_count,inserted_count,updated_count,duplicate_count,rejected_count,normalization_summary_json,raw_envelope_json,received_at,completed_at)
      VALUES(?,?,?,?,?,?,0,'accepted',?,?,?,?,0,?,?,?,?)`
        )
        .run(
          crypto.randomUUID(),
          integration.id,
          device.userId,
          batch.read_at,
          batch.app_version,
          digest,
          Object.values(result.records).reduce((n, v) => n + v, 0),
          result.records.inserted,
          result.records.updated,
          result.records.unchanged + result.records.stale,
          JSON.stringify(result.normalization),
          JSON.stringify({
            protocol_version: 2,
            device_id: device.id,
            sequence: batch.sequence,
            batch_id: batch.batch_id,
          }),
          now,
          now
        );
      return result;
    })
    .immediate();
}

/** Native aggregate polls often resend unchanged historical days. Keep the
 * authorized record ID and metric receipt intact unless its data changes. */
function applyNativeDailySnapshot(
  sqlite: Database.Database,
  userId: string,
  integrationId: string,
  input: unknown,
  counts: NativeBatchResult['normalization']
) {
  const parsed = dailyTotalsSchema.safeParse(input);
  if (!parsed.success) {
    counts.invalid_records++;
    return;
  }
  const entry = parsed.data,
    now = new Date().toISOString();
  const map = [
    ['steps', 'steps', 'steps', 1],
    ['distance_meters', 'distance', 'mi', 1 / METERS_PER_MILE],
    ['active_calories', 'active_calories', 'kcal', 1],
    ['total_calories', 'total_calories', 'kcal', 1],
  ] as const;
  for (const [field, key, unit, factor] of map) {
    const prior = sqlite
      .prepare(
        'SELECT id,value,unit,metadata FROM vitals WHERE user_id=? AND dependent_id IS NULL AND native_record_id IS NULL AND source=? AND metric_key=? AND recorded_at=?'
      )
      .get(userId, DAILY_TOTALS_SOURCE, key, `${entry.date}T00:00:00Z`) as
      | { id: string; value: number; unit: string; metadata: string }
      | undefined;
    const value = entry[field];
    if (value === undefined) {
      if (prior)
        counts.vitals_deleted += sqlite
          .prepare('DELETE FROM vitals WHERE id=? AND user_id=?')
          .run(prior.id, userId).changes;
      continue;
    }
    const canonical = value * factor;
    const metadata = JSON.stringify({
      health_connect_date: entry.date,
      integration_id: integrationId,
      native_protocol: 2,
      aggregation: 'health_connect',
    });
    if (prior && prior.value === canonical && prior.unit === unit && prior.metadata === metadata)
      continue;
    if (prior)
      sqlite
        .prepare(
          'UPDATE vitals SET value=?,unit=?,last_received_at=?,metadata=? WHERE id=? AND user_id=?'
        )
        .run(canonical, unit, now, metadata, prior.id, userId);
    else
      sqlite
        .prepare(
          `INSERT INTO vitals(id,user_id,metric_key,value,unit,source,recorded_at,last_received_at,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          crypto.randomUUID(),
          userId,
          key,
          canonical,
          unit,
          DAILY_TOTALS_SOURCE,
          `${entry.date}T00:00:00Z`,
          now,
          metadata,
          now
        );
    counts.vitals_upserted++;
  }
}

function rebuildTouched(
  sqlite: Database.Database,
  userId: string,
  integration: HealthConnectIntegrationRow,
  touched: Iterable<{ type: string; pkg: string; date: string }>,
  result: NativeBatchResult,
  batch: Pick<NativeBatch, 'batch_id' | 'app_version'>
) {
  for (const { type, pkg, date } of touched) {
    if (
      integration.status !== 'active' ||
      !integration.enabledTypes.includes(type) ||
      !integration.allowedSources[type]?.includes(pkg)
    ) {
      result.normalization.skipped_unapproved++;
      continue;
    }
    if (type === 'nutrition') {
      const window = calendarDayWindow(date);
      const raw = sqlite
        .prepare(
          `SELECT payload_json FROM health_connect_raw_records WHERE user_id=? AND record_type='nutrition' AND source_package=? AND deleted_at IS NULL AND recorded_start_at>=? AND recorded_start_at<=?`
        )
        .all(userId, pkg, window.startAt, window.endAt) as { payload_json: string }[];
      result.normalization.invalid_records += raw.filter((row) => {
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        return (
          payload.native_protocol === 2 &&
          !nativeNutritionDataSchema.safeParse(payload.native_data).success
        );
      }).length;
      const report = rebuildNutritionDays(getDb(), {
        userId,
        integrationId: integration.id,
        allowedPackages: [pkg],
        strategy: integration.nutritionStrategy,
        dates: [date],
        ingestId: batch.batch_id,
        appVersion: batch.app_version,
        trigger: 'native',
      });
      result.normalization.nutrition_days_upserted += report.rowsUpserted;
      result.normalization.nutrition_days_deleted += report.rowsDeleted;
      continue;
    }
    const keys = NATIVE_METRIC_KEYS[type];
    if (!keys) continue;
    const source = nativeSource(pkg);
    const intraday = type === 'blood_pressure' || type === 'blood_glucose';
    const window = calendarDayWindow(date);
    const timeColumn = type === 'sleep' ? 'recorded_end_at' : 'recorded_start_at';
    const rows = sqlite
      .prepare(
        `SELECT * FROM health_connect_raw_records WHERE user_id=? AND record_type=? AND source_package=? AND deleted_at IS NULL AND ${timeColumn}>=? AND ${timeColumn}<=?`
      )
      .all(userId, type, pkg, window.startAt, window.endAt) as RawRow[];
    const records = rows
      .map(rowRecord)
      .filter((r): r is NativeRecord => !!r && nativeRecordDay(r) === date);
    const computed = collapseNativeDay(records);
    result.normalization.invalid_records += computed.invalid;
    // Native discrete rows have UUID identity. Daily rows retain their old
    // day/source tuple, as required by all existing charts and exports.
    const existing = sqlite
      .prepare(
        `SELECT id,metric_key,value,unit,recorded_at,metadata,native_record_id FROM vitals WHERE user_id=? AND dependent_id IS NULL AND source=? AND ${intraday ? "native_record_id IS NOT NULL AND json_extract(metadata,'$.calendar_day')=?" : 'native_record_id IS NULL AND substr(recorded_at,1,10)=?'} AND metric_key IN (${keys.map(() => '?').join(',')})`
      )
      .all(userId, source, date, ...keys) as Array<{
      id: string;
      metric_key: string;
      value: number;
      unit: string | null;
      recorded_at: string;
      metadata: string;
      native_record_id: string | null;
    }>;
    const identity = (metric: string, nativeId: string | null) =>
      JSON.stringify([metric, nativeId]);
    const current = new Map(existing.map((v) => [identity(v.metric_key, v.native_record_id), v]));
    const now = new Date().toISOString();
    for (const value of computed.values) {
      const key = identity(value.metricKey, value.nativeRecordId),
        prior = current.get(key);
      current.delete(key);
      const metadata = { ...value.metadata, calendar_day: date, integration_id: integration.id };
      const metadataJson = JSON.stringify(metadata);
      if (
        prior &&
        prior.value === value.value &&
        prior.unit === value.unit &&
        prior.recorded_at === value.recordedAt &&
        prior.metadata === metadataJson
      )
        continue;
      if (prior)
        sqlite
          .prepare(
            'UPDATE vitals SET value=?,unit=?,recorded_at=?,last_received_at=?,metadata=? WHERE id=? AND user_id=?'
          )
          .run(value.value, value.unit, value.recordedAt, now, metadataJson, prior.id, userId);
      else
        sqlite
          .prepare(
            `INSERT INTO vitals(id,user_id,metric_key,value,unit,source,recorded_at,last_received_at,metadata,dependent_id,created_at,native_record_id) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?)`
          )
          .run(
            crypto.randomUUID(),
            userId,
            value.metricKey,
            value.value,
            value.unit,
            source,
            value.recordedAt,
            now,
            metadataJson,
            now,
            value.nativeRecordId
          );
      result.normalization.vitals_upserted++;
    }
    for (const removed of current.values())
      result.normalization.vitals_deleted += sqlite
        .prepare('DELETE FROM vitals WHERE id=? AND user_id=?')
        .run(removed.id, userId).changes;
  }
}

/** Owner settings actions can approve records already inventoried, without
 * requiring another device write to make retained native data visible. */
export function reprocessNativeProjections(
  userId: string,
  integrationId: string
): NativeBatchResult['normalization'] {
  const sqlite = getSqlite();
  return sqlite
    .transaction(() => {
      const integration = findIntegrationRow(getDb(), userId);
      if (!integration || integration.id !== integrationId)
        throw new NativeSyncError(404, 'not_found', 'Integration not found.');
      const touched = new Map<string, { type: string; pkg: string; date: string }>();
      const rows = sqlite
        .prepare(
          `SELECT * FROM health_connect_raw_records WHERE user_id=? AND json_extract(payload_json,'$.native_protocol')=2`
        )
        .all(userId) as RawRow[];
      const result: NativeBatchResult = {
        protocol_version: 2,
        batch_id: crypto.randomUUID(),
        sequence: 0,
        status: 'accepted',
        received_at: new Date().toISOString(),
        records: { inserted: 0, updated: 0, deleted: 0, unchanged: 0, stale: 0 },
        normalization: {
          vitals_upserted: 0,
          vitals_deleted: 0,
          nutrition_days_upserted: 0,
          nutrition_days_deleted: 0,
          skipped_unapproved: 0,
          invalid_records: 0,
        },
      };
      for (const row of rows) {
        if (row.record_type === 'daily_totals') {
          if (integration.status !== 'active' || !integration.enabledTypes.includes('daily_totals'))
            continue;
          const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
          applyNativeDailySnapshot(sqlite, userId, integrationId, payload, result.normalization);
          continue;
        }
        const record = rowRecord(row);
        if (!record) continue;
        const date = nativeRecordDay(record);
        touched.set(JSON.stringify([row.record_type, row.source_package, date]), {
          type: row.record_type,
          pkg: row.source_package,
          date,
        });
      }
      rebuildTouched(sqlite, userId, integration, touched.values(), result, {
        batch_id: result.batch_id,
        app_version: 'settings-reprocess',
      });
      const normalized =
        result.normalization.vitals_upserted +
          result.normalization.vitals_deleted +
          result.normalization.nutrition_days_upserted +
          result.normalization.nutrition_days_deleted >
        0;
      if (normalized)
        sqlite
          .prepare(
            'UPDATE health_connect_integrations SET last_normalized_at=?,updated_at=? WHERE id=? AND user_id=?'
          )
          .run(result.received_at, result.received_at, integrationId, userId);
      return result.normalization;
    })
    .immediate();
}
