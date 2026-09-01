'use client';

import { useMemo, useState } from 'react';
import {
  useHealthConnect,
  type InventoryEntry,
  type IngestRun,
  type NutritionStrategy,
  type RebuildReport,
} from '@/hooks/useHealthConnect';
import Skeleton from '@/components/shared/Skeleton';

// ---------------------------------------------------------------------------
// Health Connect integration — setup instructions, source inventory, exact
// package approval, delivery log.
//
// The flow the UI enforces (PRD §6.5): create → inventory → review what the
// phone actually sends → approve EXACT packages → activate. There is no
// wildcard approval control anywhere on this screen.
// ---------------------------------------------------------------------------

/** Types this release can normalize. Anything else stays raw-only. */
const NORMALIZABLE = [
  {
    type: 'daily_totals',
    label: 'Daily activity totals',
    detail:
      'Steps, distance, active and total calories → vitals (source health_connect_daily). Health Connect’s aggregate API already deduplicates phone and watch, so each sync replaces the day.',
    needsPackage: false,
  },
  {
    type: 'nutrition',
    label: 'Nutrition (MacroFactor)',
    detail:
      'Calories and macros → one canonical row per Phoenix date. Approve only the exact package that owns your food log; approving it rebuilds the days already retained.',
    needsPackage: true,
  },
] as const;

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} hr ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--bg-primary)',
  borderColor: 'var(--border-card)',
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    active: { bg: 'rgba(129, 178, 154, 0.15)', color: 'var(--color-sage)' },
    inventory: { bg: 'rgba(251, 191, 36, 0.15)', color: 'var(--color-warning)' },
    paused: { bg: 'rgba(156, 163, 175, 0.15)', color: 'var(--color-text-muted)' },
    error: { bg: 'rgba(248, 113, 113, 0.15)', color: 'var(--color-terracotta)' },
  };
  const s = styles[status] ?? styles.paused;
  return (
    <span
      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}

function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="rounded-lg border p-4 space-y-3"
      style={{ backgroundColor: 'rgba(129, 178, 154, 0.08)', borderColor: 'rgba(129, 178, 154, 0.4)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--color-sage)' }}>
        HMAC signing secret
      </p>
      <div
        className="rounded-lg border p-3 flex items-center gap-2"
        style={cardStyle}
      >
        <code className="flex-1 text-xs break-all font-mono" style={{ color: 'var(--color-text-primary)' }}>
          {secret}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(secret).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="shrink-0 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer"
          style={{
            backgroundColor: 'rgba(129, 178, 154, 0.1)',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--border-card)',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div
        className="rounded-lg px-3 py-2 text-xs"
        style={{
          backgroundColor: 'rgba(251, 191, 36, 0.1)',
          border: '1px solid rgba(251, 191, 36, 0.3)',
          color: 'var(--color-warning)',
        }}
      >
        Paste this into the companion app under Webhook Headers → signing secret. It is shown
        once and cannot be recovered — rotating issues a new one and invalidates this
        immediately.
      </div>
      <button
        type="button"
        onClick={onDone}
        className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
        style={{
          backgroundColor: 'var(--bg-card)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--border-card)',
        }}
      >
        Done
      </button>
    </div>
  );
}

function PhoneInstructions() {
  const url =
    typeof window === 'undefined'
      ? 'https://your-instance/api/v1/integrations/health-connect/webhook'
      : `${window.location.origin}/api/v1/integrations/health-connect/webhook`;
  return (
    <div className="rounded-lg border p-4 space-y-2" style={cardStyle}>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
        Configure the Life Dashboard companion app
      </p>
      <dl className="text-xs space-y-1" style={{ color: 'var(--color-text-muted)' }}>
        <div className="flex gap-2 flex-wrap">
          <dt className="w-32 shrink-0">Webhook URL</dt>
          <dd className="font-mono break-all" style={{ color: 'var(--color-text-primary)' }}>{url}</dd>
        </div>
        <div className="flex gap-2 flex-wrap">
          <dt className="w-32 shrink-0">Header name</dt>
          <dd className="font-mono">Authorization</dd>
        </div>
        <div className="flex gap-2 flex-wrap">
          <dt className="w-32 shrink-0">Header value</dt>
          <dd className="font-mono">Bearer &lt;your write:health_connect token&gt;</dd>
        </div>
        <div className="flex gap-2 flex-wrap">
          <dt className="w-32 shrink-0">Signing secret</dt>
          <dd>shown once at creation / rotation</dd>
        </div>
        <div className="flex gap-2 flex-wrap">
          <dt className="w-32 shrink-0">Daily totals</dt>
          <dd>enabled</dd>
        </div>
        <div className="flex gap-2 flex-wrap">
          <dt className="w-32 shrink-0">MQTT</dt>
          <dd>disabled</dd>
        </div>
      </dl>
      <p className="text-xs pt-1" style={{ color: 'var(--color-text-muted)' }}>
        Create the token in <strong>API Access</strong> above with only the{' '}
        <code>write:health_connect</code> scope — it grants nothing else. Then use{' '}
        <strong>Send Test Ping</strong> on the phone; the delivery appears in the log below.
      </p>
    </div>
  );
}

function InventoryTable({
  entries,
  approved,
  onToggle,
}: {
  entries: InventoryEntry[];
  approved: Record<string, string[]>;
  onToggle: (recordType: string, sourcePackage: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Nothing received yet. Send a sync (or a test ping) from the phone, then refresh.
      </p>
    );
  }
  const normalizable = new Set<string>(
    NORMALIZABLE.filter((n) => n.needsPackage).map((n) => n.type),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left border-collapse">
        <thead>
          <tr style={{ color: 'var(--color-text-primary)' }}>
            <th className="py-2 pr-3">Record type</th>
            <th className="py-2 pr-3">Source package</th>
            <th className="py-2 pr-3">Records</th>
            <th className="py-2 pr-3">Range</th>
            <th className="py-2 pr-3">Fields seen</th>
            <th className="py-2">Approve</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const key = `${e.recordType}:${e.sourcePackage}`;
            const canApprove = normalizable.has(e.recordType);
            const isApproved = (approved[e.recordType] ?? []).includes(e.sourcePackage);
            return (
              <tr key={key} style={{ borderTop: '1px solid var(--border-card)' }}>
                <td className="py-2 pr-3 font-mono" style={{ color: 'var(--color-text-primary)' }}>
                  {e.recordType}
                </td>
                <td className="py-2 pr-3 font-mono break-all" style={{ color: 'var(--color-text-muted)' }}>
                  {e.sourcePackage}
                  {e.identityKind === 'derived' && (
                    <span
                      className="ml-1 px-1 rounded"
                      title="No Health Connect record id — deduplication is content-derived and weaker"
                      style={{ color: 'var(--color-warning)' }}
                    >
                      weak id
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3" style={{ color: 'var(--color-text-muted)' }}>{e.count}</td>
                <td className="py-2 pr-3" style={{ color: 'var(--color-text-muted)' }}>
                  {e.oldest?.slice(0, 10) ?? '—'} → {e.newest?.slice(0, 10) ?? '—'}
                </td>
                <td className="py-2 pr-3 font-mono" style={{ color: 'var(--color-text-muted)' }}>
                  {e.populatedFields.join(', ') || '—'}
                </td>
                <td className="py-2">
                  {canApprove ? (
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isApproved}
                        onChange={() => onToggle(e.recordType, e.sourcePackage)}
                        style={{ accentColor: 'var(--color-sage)' }}
                      />
                      <span style={{ color: 'var(--color-text-muted)' }}>normalize</span>
                    </label>
                  ) : (
                    <span
                      style={{ color: 'var(--color-text-muted)' }}
                      title="Raw-only in this release — owned by a direct bridge, or not yet modelled"
                    >
                      raw-only
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RebuildSummary({ report }: { report: RebuildReport }) {
  const failed = report.errors.length > 0;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs space-y-1"
      style={
        failed
          ? {
              backgroundColor: 'rgba(248, 113, 113, 0.1)',
              borderColor: 'rgba(248, 113, 113, 0.3)',
            }
          : cardStyle
      }
    >
      <p style={{ color: failed ? 'var(--color-terracotta)' : 'var(--color-sage)' }}>
        {failed
          ? 'Rebuild reported a problem'
          : `${report.dates_rebuilt.length} day(s) rebuilt · ${report.rows_upserted} row(s) written`}
      </p>
      <p style={{ color: 'var(--color-text-muted)' }}>
        {report.records_considered} record(s) considered · {report.records_skipped} skipped ·{' '}
        {report.rows_deleted} row(s) removed
      </p>
      {report.dates_rebuilt.length > 0 && (
        <p className="font-mono break-all" style={{ color: 'var(--color-text-muted)' }}>
          {report.dates_rebuilt.slice(0, 12).join(', ')}
          {report.dates_rebuilt.length > 12 ? ` +${report.dates_rebuilt.length - 12} more` : ''}
        </p>
      )}
      {failed && (
        <p style={{ color: 'var(--color-terracotta)' }}>{report.errors.slice(0, 3).join('; ')}</p>
      )}
    </div>
  );
}

function RunLog({ runs }: { runs: IngestRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        No deliveries yet.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {runs.map((r) => {
        const summary = r.normalization_summary_json ?? {};
        const errors = summary.errors ?? [];
        return (
          <div key={r.id} className="rounded-lg border px-3 py-2 text-xs" style={cardStyle}>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={r.status} />
              <span style={{ color: 'var(--color-text-muted)' }}>{formatWhen(r.received_at)}</span>
              {r.app_version && (
                <span style={{ color: 'var(--color-text-muted)' }}>v{r.app_version}</span>
              )}
              {r.is_backfill && (
                <span style={{ color: 'var(--color-warning)' }}>
                  backfill {r.window_start?.slice(0, 10)} → {r.window_end?.slice(0, 10)}
                </span>
              )}
            </div>
            <div className="mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {r.received_count} received · {r.inserted_count} new · {r.updated_count} updated ·{' '}
              {r.duplicate_count} duplicate · {r.rejected_count} rejected ·{' '}
              {summary.vitals_upserted ?? 0} vitals · {summary.nutrition_days_upserted ?? 0}{' '}
              nutrition days · {summary.skipped_unapproved ?? 0} skipped
            </div>
            {errors.length > 0 && (
              <div className="mt-1" style={{ color: 'var(--color-terracotta)' }}>
                {errors.slice(0, 3).join('; ')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function HealthConnectManager() {
  const {
    integration,
    inventory,
    runs,
    lastBackfill,
    rebuild,
    loading,
    error,
    refresh,
    create,
    update,
    rotate,
    remove,
    reprocessNutrition,
  } = useHealthConnect();
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const approved = integration?.allowedSources ?? {};
  const enabled = useMemo(
    () => new Set(integration?.enabledTypes ?? []),
    [integration?.enabledTypes],
  );

  if (loading) return <Skeleton variant="card" className="h-[160px]" />;

  const banner = error && (
    <div
      className="rounded-lg border px-4 py-3 text-sm"
      style={{
        backgroundColor: 'rgba(248, 113, 113, 0.1)',
        borderColor: 'rgba(248, 113, 113, 0.3)',
        color: 'var(--color-terracotta)',
      }}
    >
      {error}
    </div>
  );

  if (!integration) {
    return (
      <div className="space-y-4">
        {banner}
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Receive Health Connect data from the Life Dashboard Android companion app. The
          integration starts in <strong>inventory</strong> mode: everything your phone sends is
          stored and catalogued, but nothing is written to your vitals or nutrition until you
          approve the exact apps you trust.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const s = await create();
            if (s) setSecret(s);
            setBusy(false);
          }}
          className="w-full px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer border border-dashed disabled:opacity-50"
          style={{ borderColor: 'var(--border-card)', color: 'var(--color-sage)' }}
        >
          + Create Health Connect integration
        </button>
        {secret && <SecretReveal secret={secret} onDone={() => setSecret(null)} />}
      </div>
    );
  }

  const toggleApproval = async (recordType: string, sourcePackage: string) => {
    const current = approved[recordType] ?? [];
    const next = current.includes(sourcePackage)
      ? current.filter((p) => p !== sourcePackage)
      : [...current, sourcePackage];
    setBusy(true);
    await update({ allowed_sources: { ...approved, [recordType]: next } });
    setBusy(false);
  };

  const toggleType = async (type: string) => {
    const next = enabled.has(type)
      ? [...enabled].filter((t) => t !== type)
      : [...enabled, type];
    setBusy(true);
    await update({ enabled_types: next });
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {banner}

      {/* Status */}
      <div className="rounded-lg border p-4 space-y-2" style={cardStyle}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {integration.name}
          </span>
          <StatusBadge status={integration.status} />
          <button
            type="button"
            onClick={refresh}
            className="ml-auto text-xs px-2 py-1 rounded cursor-pointer"
            style={{ color: 'var(--color-sage)', border: '1px solid var(--border-card)' }}
          >
            Refresh
          </button>
        </div>
        <div
          className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <span>Last payload: {formatWhen(integration.lastReceivedAt)}</span>
          <span>Last normalization: {formatWhen(integration.lastNormalizedAt)}</span>
          <span>App version: {integration.lastAppVersion ?? '—'}</span>
          <span>
            Last backfill:{' '}
            {lastBackfill?.start
              ? `${lastBackfill.start.slice(0, 10)} → ${lastBackfill.end?.slice(0, 10) ?? '—'}`
              : '—'}
          </span>
        </div>
        {integration.lastError && (
          <p className="text-xs" style={{ color: 'var(--color-terracotta)' }}>
            {integration.lastError}
          </p>
        )}
      </div>

      <PhoneInstructions />

      {/* Normalization approvals */}
      <div className="rounded-lg border p-4 space-y-3" style={cardStyle}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          Canonical writes
        </p>
        {NORMALIZABLE.map((n) => {
          const packages = approved[n.type] ?? [];
          const blocked = n.needsPackage && packages.length === 0;
          return (
            <label key={n.type} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled.has(n.type)}
                disabled={busy || blocked}
                onChange={() => toggleType(n.type)}
                className="mt-1"
                style={{ accentColor: 'var(--color-sage)' }}
              />
              <span>
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {n.label}
                </span>
                <span className="block text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {n.detail}
                </span>
                {blocked && (
                  <span className="block text-xs" style={{ color: 'var(--color-warning)' }}>
                    Approve an exact source package in the inventory below first.
                  </span>
                )}
                {packages.length > 0 && (
                  <span className="block text-xs font-mono" style={{ color: 'var(--color-sage)' }}>
                    approved: {packages.join(', ')}
                  </span>
                )}
              </span>
            </label>
          );
        })}

        {enabled.has('nutrition') && (
          <div className="pt-1">
            <label className="text-xs block mb-1" style={{ color: 'var(--color-text-primary)' }}>
              Nutrition record shape
            </label>
            <select
              value={integration.nutritionStrategy}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                await update({
                  nutrition_strategy: e.target.value as NutritionStrategy,
                });
                setBusy(false);
              }}
              className="rounded-lg border px-2 py-1 text-xs"
              style={{ ...cardStyle, color: 'var(--color-text-primary)' }}
            >
              <option value="sum_items">Sum food/meal records for the day</option>
              <option value="latest_summary">Use only the newest daily-summary record</option>
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              Check the inventory: if the app sends one record per day, either option is
              equivalent. Pick the summary option only if it sends a daily summary{' '}
              <em>alongside</em> individual items — summing both would double count.
            </p>

            <div className="pt-3 space-y-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await reprocessNutrition();
                  setBusy(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40"
                style={{
                  backgroundColor: 'rgba(129, 178, 154, 0.15)',
                  color: 'var(--color-sage)',
                }}
              >
                Reprocess retained nutrition
              </button>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Recomputes every Phoenix day from the food records already stored here — no
                new sync from the phone needed. Safe to run twice: the result is a pure
                function of what is retained, so it cannot inflate a day.
              </p>
              {rebuild && <RebuildSummary report={rebuild} />}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2 flex-wrap">
          {integration.status !== 'active' && (
            <button
              type="button"
              disabled={busy || enabled.size === 0}
              onClick={async () => {
                setBusy(true);
                await update({ status: 'active' });
                setBusy(false);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-40"
              style={{ backgroundColor: 'rgba(129, 178, 154, 0.15)', color: 'var(--color-sage)' }}
            >
              Activate normalization
            </button>
          )}
          {integration.status === 'active' && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await update({ status: 'paused' });
                setBusy(false);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ color: 'var(--color-text-muted)', border: '1px solid var(--border-card)' }}
            >
              Pause deliveries
            </button>
          )}
          {integration.status === 'paused' && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await update({ status: 'inventory' });
                setBusy(false);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
              style={{ color: 'var(--color-text-muted)', border: '1px solid var(--border-card)' }}
            >
              Resume in inventory mode
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  'Rotate the signing secret? The phone stops delivering until you paste the new secret into the companion app.',
                )
              )
                return;
              setBusy(true);
              const s = await rotate();
              if (s) setSecret(s);
              setBusy(false);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ color: 'var(--color-warning)', border: '1px solid rgba(251,191,36,0.3)' }}
          >
            Rotate secret
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Delete this integration? Your vitals and nutrition history are kept.'))
                return;
              const deleteRaw = window.confirm(
                'Also delete the stored raw Health Connect records?\n\nOK = delete raw records too.\nCancel = keep them.',
              );
              setBusy(true);
              await remove(deleteRaw);
              setBusy(false);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
            style={{ color: 'var(--color-terracotta)', border: '1px solid rgba(248,113,113,0.3)' }}
          >
            Delete integration
          </button>
        </div>
      </div>

      {secret && <SecretReveal secret={secret} onDone={() => setSecret(null)} />}

      {/* Inventory */}
      <div className="rounded-lg border p-4 space-y-3" style={cardStyle}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          Source inventory
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          What your phone has actually delivered, by record type and Android package. Approval is
          exact — a package is never matched by prefix or substring.
        </p>
        <InventoryTable entries={inventory} approved={approved} onToggle={toggleApproval} />
      </div>

      {/* Delivery log */}
      <div className="rounded-lg border p-4 space-y-3" style={cardStyle}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          Recent deliveries
        </p>
        <RunLog runs={runs} />
      </div>
    </div>
  );
}
