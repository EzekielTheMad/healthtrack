import { and, eq, gt, isNull, max } from 'drizzle-orm';
import { db } from '@/db';
import { healthConnectIngestRuns, nutritionDaily, vitals } from '@/db/schema';
import { getCapabilities } from '@/lib/capabilities';
import { getConnectedSource } from './connected-sources';
import { getIntegration } from './health-connect';
import type { IntegrationHealth } from '@/lib/integrations/status';
import { getOuraSchedulerStatus, ouraSyncIntervalMs } from '@/lib/oura/scheduler';
import { getHealthTrackTimeZone } from '@/lib/oura/timezone';

const BRIDGE_LABELS = new Map([
  ['renpho', 'Renpho'],
  ['myair', 'myAir / CPAP'],
]);

/** Operational metadata for the signed-in account only. No values, tokens, or provider bodies. */
export async function listIntegrationHealth(
  actorId: string,
  now = Date.now()
): Promise<IntegrationHealth[]> {
  const capabilities = getCapabilities();
  const [oura, hc, receipts, nutrition] = await Promise.all([
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
      label: 'Health Connect / nutrition',
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
      lastReceivedAt: hc?.lastReceivedAt ?? null,
      lastRecordedImportAt: lastImport[0]?.receivedAt ?? null,
      latestNutritionDate: nutrition[0]?.latestNutritionDate ?? null,
      latestMeasurementAt:
        receipts.find((row) => row.source === 'health_connect_daily')?.latestMeasurementAt ?? null,
      lastNormalizedAt: hc?.lastNormalizedAt ?? null,
      errorCode: hc?.lastError ? 'delivery_error' : null,
      nextRetryAt: null,
      canSyncNow: false,
    });
  }
  for (const receipt of receipts) {
    if (['oura', 'health_connect_daily', 'manual'].includes(receipt.source)) continue;
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
  const timeZone = getHealthTrackTimeZone();
  return out.map((item) => ({ ...item, timeZone }));
}
