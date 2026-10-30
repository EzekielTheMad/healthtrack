'use client';

import { useIntegrationHealth } from '@/hooks/useIntegrationHealth';
import type { IntegrationHealth } from '@/lib/integrations/status';
import { integrationLabels } from '@/lib/integrations/presentation';
import { OuraConnectCard } from './OuraConnectCard';
import HealthConnectManager from './HealthConnectManager';
import { IntegrationTime } from './IntegrationTime';

const bridges = [
  { source: 'renpho', label: 'Renpho', detail: 'Weight, body composition and tape measurements' },
  { source: 'myair', label: 'myAir / APAP', detail: 'CPAP usage, AHI and mask leak' },
];

function BridgeCard({
  item,
  source,
  label,
  detail,
  unavailable,
}: {
  item?: IntegrationHealth;
  source: string;
  label: string;
  detail: string;
  unavailable?: boolean;
}) {
  return (
    <article
      id={source}
      className="min-w-0 rounded-xl border p-4 sm:p-5 space-y-3 scroll-mt-6"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
    >
      <div className="flex flex-wrap justify-between gap-2">
        <div className="min-w-0 max-w-full">
          <h3 className="break-all font-semibold" tabIndex={-1} data-settings-focus>
            {label}
          </h3>
          <p className="text-sm text-[var(--color-text-muted)]">{detail}</p>
        </div>
        <span className="text-sm">
          {unavailable
            ? 'Status unavailable'
            : item
              ? 'Upstream status unknown'
              : 'No measurements received'}
        </span>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-[var(--color-text-muted)]">Last accepted measurement delivery</dt>
          <dd>
            <IntegrationTime value={item?.lastReceivedAt} timeZone={item?.timeZone} />
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-text-muted)]">Latest measurement date</dt>
          <dd>{item?.latestMeasurementAt?.slice(0, 10) ?? 'Unknown'}</dd>
        </div>
      </dl>
      <details>
        <summary className="min-h-11 py-2 cursor-pointer text-sm font-medium">
          Setup and troubleshooting
        </summary>
        <div className="space-y-2 text-sm">
          <p>
            This feed is delivered by an external bridge. HealthTrack cannot check its login or
            upstream schedule.
          </p>
          <p>
            {source === 'renpho'
              ? 'Check the Renpho bridge on your server, its Renpho account authorization, and the bridge delivery log. For missing tape readings, confirm they appear in the Renpho app first.'
              : source === 'myair'
                ? 'Check the myAir bridge on your server, its account authorization, and the bridge delivery log. A missing night remains unknown until myAir provides it.'
                : 'Check the sending application or import and its delivery log.'}
          </p>
          <p>Refresh status checks only deliveries already received.</p>
          <p>
            Accepted delivery:{' '}
            <IntegrationTime value={item?.lastReceivedAt} timeZone={item?.timeZone} exact />
          </p>
          <a
            href="/settings?tab=advanced#api-access"
            className="inline-block min-h-11 py-2 underline"
          >
            Manage API access
          </a>
        </div>
      </details>
    </article>
  );
}

export default function IntegrationOverview() {
  const { integrations, loading, error, lastCheckedAt, refresh } = useIntegrationHealth();
  const hc = integrations.find((item) => item.source === 'health_connect');
  return (
    <section id="integration-health" className="space-y-4 scroll-mt-6">
      <div className="flex items-start flex-wrap justify-between gap-3">
        <div>
          <p tabIndex={-1} data-settings-focus className="text-sm text-[var(--color-text-muted)]">
            These connections belong to your signed-in account.
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 px-3 py-2 text-sm underline"
          onClick={() => void refresh(true)}
        >
          Refresh status
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {error}
        </p>
      )}
      {lastCheckedAt && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Last checked{' '}
          <IntegrationTime value={lastCheckedAt} timeZone={integrations[0]?.timeZone} />
          {error ? ' · status unavailable' : ''}
        </p>
      )}
      {loading ? (
        <p role="status">Loading integration status…</p>
      ) : (
        <>
          <OuraConnectCard />
          {hc && (
            <article
              id="health-connect"
              className="rounded-xl border p-4 sm:p-5 space-y-4 scroll-mt-6"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h3 tabIndex={-1} data-settings-focus className="font-semibold">
                    Health Connect
                  </h3>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Android activity, nutrition, sleep, and approved health measurements
                  </p>
                </div>
                <span className="text-sm">
                  {error ? 'Status unavailable' : (integrationLabels[hc.status] ?? hc.status)}
                </span>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-[var(--color-text-muted)]">Last accepted phone contact</dt>
                  <dd>
                    <IntegrationTime value={hc.lastReceivedAt} timeZone={hc.timeZone} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted)]">Latest recorded data import</dt>
                  <dd>
                    <IntegrationTime value={hc.lastRecordedImportAt} timeZone={hc.timeZone} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted)]">
                    Latest Health Connect measurement date
                  </dt>
                  <dd>
                    {hc.latestMeasurementDate ?? hc.latestMeasurementAt?.slice(0, 10) ?? 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-muted)]">Latest nutrition day</dt>
                  <dd>{hc.latestNutritionDate ?? 'Unknown'}</dd>
                </div>
              </dl>
              <p className="text-xs text-[var(--color-text-muted)]">
                A test ping confirms phone contact. A recorded import may contain inventory or
                repeated records; measurement dates show available data. Start new deliveries in the
                companion phone app.
              </p>
              <details
                open={hc.status === 'not_connected' || hc.status === 'inventory' || undefined}
              >
                <summary className="min-h-11 py-2 cursor-pointer text-sm font-medium">
                  {hc.status === 'not_connected'
                    ? 'Set up Health Connect'
                    : 'Manage Health Connect'}
                </summary>
                <div className="space-y-3 pt-2">
                  <p className="text-xs">
                    Last processed:{' '}
                    <IntegrationTime value={hc.lastNormalizedAt} timeZone={hc.timeZone} exact />.
                    Processing can also follow a settings change.
                  </p>
                  <HealthConnectManager embedded />
                </div>
              </details>
            </article>
          )}
          {bridges.map((bridge) => (
            <BridgeCard
              key={bridge.source}
              {...bridge}
              unavailable={Boolean(error)}
              item={integrations.find((item) => item.source === bridge.source)}
            />
          ))}
          {integrations
            .filter((item) => !['oura', 'health_connect', 'renpho', 'myair'].includes(item.source))
            .map((item) => (
              <BridgeCard
                key={item.source}
                item={item}
                unavailable={Boolean(error)}
                source={`source-${item.source}`}
                label={item.label}
                detail="External data source"
              />
            ))}
        </>
      )}
    </section>
  );
}
