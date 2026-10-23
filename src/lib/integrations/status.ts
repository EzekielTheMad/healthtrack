export interface IntegrationHealth {
  source: string;
  label: string;
  mode: 'pull' | 'push';
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastReceivedAt: string | null;
  latestMeasurementAt: string | null;
  lastNormalizedAt: string | null;
  errorCode: string | null;
  nextRetryAt: string | null;
  canSyncNow: boolean;
  nextScheduledAt?: string | null;
}
