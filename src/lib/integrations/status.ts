export interface IntegrationHealth {
  source: string;
  label: string;
  mode: 'pull' | 'push';
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastReceivedAt: string | null;
  latestMeasurementAt: string | null;
  /** Clinical reporting date, separate from an intraday observation instant. */
  latestMeasurementDate?: string | null;
  lastNormalizedAt: string | null;
  errorCode: string | null;
  nextRetryAt: string | null;
  canSyncNow: boolean;
  nextScheduledAt?: string | null;
  /** OAuth authorization state, independent of the latest sync outcome. */
  connectionStatus?: string | null;
  /** First recorded receipt of the most recent non-empty, accepted phone import. */
  lastRecordedImportAt?: string | null;
  /** Latest available canonical nutrition day, not a delivery timestamp. */
  latestNutritionDate?: string | null;
  /** Instance reporting timezone for exact operational timestamps. */
  timeZone?: string;
}
