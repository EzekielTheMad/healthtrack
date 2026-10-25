import { and, eq, gt, isNull, max, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '@/db';
import { healthConnectIngestRuns, nutritionDaily, vitals } from '@/db/schema';
import { getCapabilities } from '@/lib/capabilities';
import { getConnectedSource } from './connected-sources';
import { getIntegration } from './health-connect';
import type { IntegrationHealth } from '@/lib/integrations/status';
import { getOuraSchedulerStatus, ouraSyncIntervalMs } from '@/lib/oura/scheduler';
import { getHealthTrackTimeZone } from '@/lib/oura/timezone';
import { getVitalDayKey, isValidDayKey } from '@/lib/dates';

const BRIDGE_LABELS = new Map([
  ['renpho', 'Renpho'],
  ['myair', 'myAir / CPAP'],
]);
const latestTimestamp = (values: readonly (string | null | undefined)[]) =>
  values.reduce<string | null>(
    (latest, value) =>
      value &&
      Number.isFinite(Date.parse(value)) &&
      (!latest || Date.parse(value) > Date.parse(latest))
        ? value
        : latest,
    null
  );

/** Operational metadata for the signed-in account only. No values, tokens, or provider bodies. */
export async function listIntegrationHealth(
  actorId: string,
  now = Date.now()
): Promise<IntegrationHealth[]> {
  const capabilities = getCapabilities();
  const timeZone = getHealthTrackTimeZone();
  const [oura, hc, receipts, nutrition, nativeGroups] = await Promise.all([
    getConnectedSource(actorId, 'oura'),
    getIntegration(actorId),
    db
      .select({
        source: vitals.source,
        lastReceivedAt: max(vitals.lastReceivedAt),
        latestMeasurementAt: max(vitals.recordedAt),
      })
      .from(vitals)
      .where(and(eq(vitals.userId, actorId), isNull(vitals.dependentId)))
      .groupBy(vitals.source),
    db
      .select({ latestNutritionDate: max(nutritionDaily.date) })
      .from(nutritionDaily)
      .where(eq(nutritionDaily.userId, actorId)),
    db
      .select({
        source: vitals.source,
        metricKey: vitals.metricKey,
        sourcePackage: sql<string>`json_extract(${vitals.metadata}, '$.source_package')`,
        lastReceivedAt: max(vitals.lastReceivedAt),
        latestMeasurementAt: max(vitals.recordedAt),
        latestMeasurementDate: sql<
          string | null
        >`max(json_extract(${vitals.metadata}, '$.calendar_day'))`,
      })
      .from(vitals)
      .where(
        and(
          eq(vitals.userId, actorId),
          isNull(vitals.dependentId),
          sql`json_extract(${vitals.metadata}, '$.health_connect') = 1`
        )
      )
      .groupBy(
        vitals.source,
        vitals.metricKey,
        sql`json_extract(${vitals.metadata}, '$.source_package')`
      ),
  ]);
  // Query the retained history, not the management screen's latest ten runs.
  // Exact retries reuse a run, so this is an import's first recorded receipt.
  const lastImport = hc
    ? await db
        .select({ receivedAt: max(healthConnectIngestRuns.receivedAt) })
        .from(healthConnectIngestRuns)
        .where(
          and(
            eq(healthConnectIngestRuns.userId, actorId),
            eq(healthConnectIngestRuns.integrationId, hc.id),
            eq(healthConnectIngestRuns.status, 'accepted'),
            gt(healthConnectIngestRuns.receivedCount, 0)
          )
        )
    : [];
  const out: IntegrationHealth[] = [];
  // Source strings remain an open legacy interface. Only verified native
  // provenance with the exact package hash may claim the Health Connect feed.
  const nativeReceipts = nativeGroups.filter(
    (row) =>
      typeof row.sourcePackage === 'string' &&
      /^[A-Za-z0-9_.]{1,255}$/.test(row.sourcePackage) &&
      row.source === `hc:${createHash('sha256').update(row.sourcePackage).digest('base64url')}`
  );
  const nativeSources = new Set(nativeReceipts.map((row) => row.source));
  const healthConnectReceipts = [
    ...receipts.filter((row) => row.source === 'health_connect_daily'),
    ...nativeReceipts,
  ];
  const nativeDays = nativeReceipts.map((row) =>
    row.latestMeasurementDate && isValidDayKey(row.latestMeasurementDate)
      ? row.latestMeasurementDate
      : row.latestMeasurementAt
        ? getVitalDayKey(row.latestMeasurementAt, row.metricKey, timeZone)
        : null
  );
  const legacyDay = receipts
    .find((row) => row.source === 'health_connect_daily')
    ?.latestMeasurementAt?.slice(0, 10);
  const healthConnectMeasurementDate = latestTimestamp([legacyDay, ...nativeDays]);
  const ouraData = receipts.find((row) => row.source === 'oura');
  {
    const blocked = !!(oura?.nextRetryAt && Date.parse(oura.nextRetryAt) > now);
    const running =
      oura?.lastOutcome === 'running' &&
      !!oura.lastAttemptAt &&
      now - Date.parse(oura.lastAttemptAt) < 5 * 60_000;
    const status = !capabilities.oura
      ? 'not_configured'
      : !oura
        ? 'not_connected'
        : oura.status === 'expired'
          ? 'reconnect_required'
          : oura.status !== 'active'
            ? oura.status
            : blocked
              ? 'backoff'
              : running
                ? 'syncing'
                : oura.lastOutcome === 'partial'
                  ? 'partial'
                  : oura.lastOutcome === 'failed' || oura.lastOutcome === 'running'
                    ? 'failed'
                    : oura.lastSuccessAt &&
                        getOuraSchedulerStatus().scheduled &&
                        now - Date.parse(oura.lastSuccessAt) > ouraSyncIntervalMs() * 2
                      ? 'stale'
                      : oura.lastSuccessAt
                        ? 'ok'
                        : 'never_verified';
    out.push({
      source: 'oura',
      label: 'Oura Ring',
      mode: 'pull',
      status,
      connectionStatus: oura?.status ?? null,
      lastAttemptAt: oura?.lastAttemptAt ?? null,
      lastSuccessAt: oura?.lastSuccessAt ?? null,
      lastReceivedAt: ouraData?.lastReceivedAt ?? null,
      latestMeasurementAt: ouraData?.latestMeasurementAt ?? null,
      lastNormalizedAt: null,
      errorCode: oura?.lastErrorCode ?? null,
      nextRetryAt: oura?.nextRetryAt ?? null,
      canSyncNow: !!oura && oura.status === 'active' && capabilities.oura && !blocked && !running,
      nextScheduledAt:
        oura?.status === 'active' && capabilities.oura ? getOuraSchedulerStatus().nextRunAt : null,
    });
  }
  {
    out.push({
      source: 'health_connect',
      label: 'Health Connect',
      mode: 'push',
      status: !hc
        ? 'not_connected'
        : hc.status === 'active'
          ? hc.lastError
            ? 'delivery_error'
            : hc.lastReceivedAt
              ? 'receiving'
              : 'waiting'
          : hc.status,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastReceivedAt: latestTimestamp([
        hc?.lastReceivedAt,
        ...healthConnectReceipts.map((row) => row.lastReceivedAt),
      ]),
      lastRecordedImportAt: lastImport[0]?.receivedAt ?? null,
      latestNutritionDate: nutrition[0]?.latestNutritionDate ?? null,
      latestMeasurementAt: latestTimestamp(
        healthConnectReceipts.map((row) => row.latestMeasurementAt)
      ),
      latestMeasurementDate: healthConnectMeasurementDate,
      lastNormalizedAt: hc?.lastNormalizedAt ?? null,
      errorCode: hc?.lastError ? 'delivery_error' : null,
      nextRetryAt: null,
      canSyncNow: false,
    });
  }
  for (const receipt of receipts) {
    if (
      ['oura', 'health_connect_daily', 'manual'].includes(receipt.source) ||
      nativeSources.has(receipt.source)
    )
      continue;
    out.push({
      source: receipt.source,
      label: BRIDGE_LABELS.get(receipt.source) ?? receipt.source,
      mode: 'push',
      status: 'upstream_unknown',
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastReceivedAt: receipt.lastReceivedAt,
      latestMeasurementAt: receipt.latestMeasurementAt,
      lastNormalizedAt: null,
      errorCode: null,
      nextRetryAt: null,
      canSyncNow: false,
    });
  }
  return out.map((item) => ({ ...item, timeZone }));
}
