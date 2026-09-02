/**
 * /docs/api — public in-app API cookbook (no account auth; listed in
 * src/proxy.ts PUBLIC_EXACT). Documents API shape only — never user data —
 * so LLMs and bridge authors can read it straight off any instance.
 *
 * Server component: the metric table renders directly from the registry
 * import, so it can never drift from what the API accepts.
 */
import Link from 'next/link';
import { METRICS, CATEGORY_LABELS, CATEGORY_ORDER, type MetricDef } from '@/lib/metrics/registry';
import { AVAILABLE_SCOPES } from '@/lib/api-scopes';
import { UPSTREAM_SCHEMA_COMMIT } from '@/lib/integrations/health-connect/schema';

export const metadata = {
  title: 'API Documentation — HealthTrack',
  description:
    'HealthTrack instance API: personal access tokens, vitals ingest endpoints, and the full metric registry.',
};

const ENDPOINTS: Array<{ method: string; path: string; scope: string; description: string }> = [
  { method: 'GET', path: '/api/v1', scope: '(none)', description: 'API index — endpoints and scopes' },
  { method: 'GET', path: '/api/v1/metrics', scope: '(none)', description: 'Metric registry as JSON (machine-readable)' },
  { method: 'GET', path: '/api/v1/openapi.json', scope: '(none)', description: 'OpenAPI 3.1 document' },
  { method: 'GET', path: '/api/v1/vitals', scope: 'read:vitals', description: 'List vitals (?metric=, ?days=, ?from=, ?to=, ?limit=)' },
  { method: 'GET', path: '/api/v1/vitals/latest', scope: 'read:vitals', description: 'Latest reading per metric (?metrics=a,b,c)' },
  { method: 'POST', path: '/api/v1/vitals', scope: 'write:vitals', description: 'Upsert one vital record' },
  { method: 'POST', path: '/api/v1/vitals/batch', scope: 'write:vitals', description: 'Upsert up to 500 records in one transaction' },
  { method: 'GET', path: '/api/v1/workouts', scope: 'read:fitness', description: 'List workout sessions (?from=, ?to=, ?type=, ?label=, ?limit=)' },
  { method: 'POST', path: '/api/v1/workouts', scope: 'write:fitness', description: 'Create a session + entries (409 = already logged)' },
  { method: 'GET', path: '/api/v1/workouts/{id}', scope: 'read:fitness', description: 'One session with entries and derived stats' },
  { method: 'PATCH', path: '/api/v1/workouts/{id}', scope: 'write:fitness', description: 'Correct a session (entries = full replacement)' },
  { method: 'DELETE', path: '/api/v1/workouts/{id}', scope: 'write:fitness', description: 'Delete a session' },
  { method: 'GET', path: '/api/v1/exercises', scope: 'read:fitness', description: 'Exercise catalog (?review_status=unreviewed for drift cleanup)' },
  { method: 'POST', path: '/api/v1/exercises', scope: 'write:fitness', description: 'Create a catalog entry' },
  { method: 'PATCH', path: '/api/v1/exercises/{id}', scope: 'write:fitness', description: 'Rename / alias / confirm a catalog entry' },
  { method: 'GET', path: '/api/v1/exercises/{id}/history', scope: 'read:fitness', description: 'Recent entries for one exercise (?limit=)' },
  { method: 'GET', path: '/api/v1/checkins', scope: 'read:fitness', description: 'List weekly check-ins (?from=, ?to=)' },
  { method: 'GET', path: '/api/v1/checkins/{weekStart}', scope: 'read:fitness', description: "One week's check-in (Monday YYYY-MM-DD key)" },
  { method: 'PUT', path: '/api/v1/checkins/{weekStart}', scope: 'write:fitness', description: 'Upsert the manual check-in fields' },
  { method: 'GET', path: '/api/v1/weeks/{weekStart}', scope: 'read:fitness', description: 'Computed weekly rollup (sessions, body, recovery, goals, deltas)' },
  { method: 'GET', path: '/api/v1/goals', scope: 'read:fitness', description: 'List goals (?active=, ?kind=)' },
  { method: 'POST', path: '/api/v1/goals', scope: 'write:fitness', description: 'Create a metric or frequency goal' },
  { method: 'PATCH', path: '/api/v1/goals/{id}', scope: 'write:fitness', description: 'Edit a goal (kind immutable)' },
  { method: 'GET', path: '/api/v1/medications', scope: 'read:medications', description: 'List medications (?include_inactive=)' },
  { method: 'GET', path: '/api/v1/conditions', scope: 'read:conditions', description: 'List medical conditions' },
  { method: 'GET', path: '/api/v1/allergies', scope: 'read:allergies', description: 'List allergies' },
  { method: 'GET', path: '/api/v1/labs', scope: 'read:labs', description: 'List lab results (?test=, ?days=)' },
  { method: 'GET', path: '/api/v1/procedures', scope: 'read:procedures', description: 'List procedures' },
  { method: 'GET', path: '/api/v1/vaccines', scope: 'read:vaccines', description: 'List vaccine records' },
  { method: 'GET', path: '/api/v1/providers', scope: 'read:providers', description: 'List healthcare providers' },
  { method: 'GET', path: '/api/v1/profile', scope: 'read:profile', description: 'User profile (DOB, height, weight, …)' },
  { method: 'GET', path: '/api/v1/summary', scope: 'read:all', description: 'Full health summary in one call' },
  { method: 'GET', path: '/api/v1/nutrition/daily', scope: 'read:nutrition', description: 'Daily nutrition totals (?start_date=, ?end_date=, ?source_package=, ?limit=)' },
  { method: 'POST', path: '/api/v1/integrations/health-connect/webhook', scope: 'write:health_connect', description: 'Health Connect webhook receiver (HMAC-signed, phone relay)' },
  { method: 'GET', path: '/api/v1/integrations/health-connect/inventory', scope: 'read:health_connect', description: 'Retained source inventory (?integration_id=, ?record_type=, ?source_package=)' },
  { method: 'GET', path: '/api/v1/integrations/health-connect/records', scope: 'read:health_connect', description: 'Retained raw records — bounded (start_at/end_at required) & cursor-paginated' },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      className="rounded-lg border p-4 text-xs leading-relaxed overflow-x-auto"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border-card)',
        color: 'var(--color-text-primary)',
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

const thStyle = {
  borderBottom: '1px solid var(--border-card)',
  color: 'var(--color-text-primary)',
} as const;

const tdStyle = {
  borderBottom: '1px solid var(--border-card)',
  color: 'var(--color-text-muted)',
} as const;

function metricNotes(m: MetricDef): string {
  const notes: string[] = [];
  if (m.valueType === 'ordinal' && m.ordinalLabels) {
    notes.push(`labels: ${m.ordinalLabels.join(', ')}`);
  }
  if (m.min !== undefined || m.max !== undefined) {
    notes.push(`range ${m.min ?? '−∞'}–${m.max ?? '∞'}`);
  }
  if (m.intraday) {
    notes.push('intraday (full timestamps kept)');
  }
  return notes.join('; ');
}

export default function ApiDocsPage() {
  return (
    <div style={{ background: 'var(--bg-primary)', color: 'var(--color-text-primary)' }}>
      {/* ---------- Nav ---------- */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md"
        style={{
          background: 'rgba(255, 251, 247, 0.85)',
          borderBottom: '1px solid var(--border-card)',
        }}
      >
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span className="text-xl font-bold" style={{ color: 'var(--color-sage)' }}>
            Health
          </span>
          <span className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            Track
          </span>
        </Link>
        <Link
          href="/login"
          className="px-4 py-2 rounded-lg text-sm font-semibold no-underline transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--color-sage)',
            border: '1px solid #4ADE80',
          }}
        >
          Sign In
        </Link>
      </nav>

      {/* ---------- Content ---------- */}
      <main className="max-w-4xl mx-auto px-6 pt-32 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">API Documentation</h1>
        <p className="text-sm mb-12" style={{ color: 'var(--color-text-muted)' }}>
          Personal-access-token API for this HealthTrack instance. This page documents API
          shape only — it exposes no user data, which is why it is readable without an
          account. Machine-readable versions:{' '}
          <a href="/api/v1/openapi.json" style={{ color: 'var(--color-sage)' }}>
            /api/v1/openapi.json
          </a>{' '}
          and{' '}
          <a href="/api/v1/metrics" style={{ color: 'var(--color-sage)' }}>
            /api/v1/metrics
          </a>
          .
        </p>

        <div className="space-y-12">
          {/* 1. Tokens & scopes */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">1. Create a token</h2>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              Sign in, open <strong>Settings → API Keys</strong>, and create a personal access
              token with the scopes you need. The token (format <code>ohts_pat_…</code>) is
              shown once — store it securely. Every token resolves to exactly one user, and all
              reads and writes are hard-scoped to that user&apos;s own data.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr>
                    <th className="py-2 pr-4" style={thStyle}>Scope</th>
                    <th className="py-2" style={thStyle}>Grants</th>
                  </tr>
                </thead>
                <tbody>
                  {AVAILABLE_SCOPES.map((s) => (
                    <tr key={s.value}>
                      <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap" style={tdStyle}>
                        {s.value}
                      </td>
                      <td className="py-2" style={tdStyle}>{s.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 2. Authentication */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">2. Authentication</h2>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              Send the token as a bearer token on every request:
            </p>
            <CodeBlock>{`curl -H "Authorization: Bearer ohts_pat_..." \\
  https://your-instance/api/v1/vitals?metric=weight&days=30`}</CodeBlock>
          </section>

          {/* 3. Endpoints */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">3. Endpoints</h2>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              <code>read:all</code> satisfies every read scope; <code>write:all</code> satisfies
              every write scope. All payloads use snake_case field names.
            </p>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr>
                    <th className="py-2 pr-4" style={thStyle}>Method</th>
                    <th className="py-2 pr-4" style={thStyle}>Path</th>
                    <th className="py-2 pr-4" style={thStyle}>Scope</th>
                    <th className="py-2" style={thStyle}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ENDPOINTS.map((e) => (
                    <tr key={`${e.method} ${e.path}`}>
                      <td className="py-2 pr-4 font-mono text-xs" style={tdStyle}>{e.method}</td>
                      <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap" style={tdStyle}>
                        {e.path}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap" style={tdStyle}>
                        {e.scope}
                      </td>
                      <td className="py-2" style={tdStyle}>{e.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="text-lg font-semibold mb-2">Push a scale reading</h3>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Weight is stored in lbs; it is the one metric that also accepts{' '}
              <code>&quot;unit&quot;: &quot;kg&quot;</code> and converts for you.
            </p>
            <CodeBlock>{`curl -X POST https://your-instance/api/v1/vitals \\
  -H "Authorization: Bearer ohts_pat_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "metric_key": "weight",
    "value": 80.2,
    "unit": "kg",
    "recorded_at": "2026-07-09",
    "source": "renpho"
  }'
# 201 { "result": "inserted", "vital": { ... } }`}</CodeBlock>

            <h3 className="text-lg font-semibold mb-2 mt-6">CPAP morning push (batch)</h3>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              A bridge that runs after each night typically pushes several metrics for the same
              day in one batch:
            </p>
            <CodeBlock>{`curl -X POST https://your-instance/api/v1/vitals/batch \\
  -H "Authorization: Bearer ohts_pat_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "records": [
      { "metric_key": "ahi",        "value": 2.4, "recorded_at": "2026-07-09", "source": "myair" },
      { "metric_key": "cpap_usage", "value": 7.1, "recorded_at": "2026-07-09", "source": "myair" },
      { "metric_key": "mask_leak",  "value": 9.6, "recorded_at": "2026-07-09", "source": "myair" }
    ]
  }'
# 200 { "inserted": 3, "updated": 0, "errors": [] }`}</CodeBlock>

            <h3 className="text-lg font-semibold mb-2 mt-6">Ordinal metrics</h3>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Label-based metrics accept a <code>value_label</code> (or the 1-based integer{' '}
              <code>value</code>); the label is stored in <code>metadata.label</code>:
            </p>
            <CodeBlock>{`{ "metric_key": "resilience", "value_label": "solid", "recorded_at": "2026-07-09", "source": "oura" }`}</CodeBlock>
          </section>

          {/* 4. Fitness domain */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">4. Fitness: workouts, check-ins &amp; goals</h2>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              The fitness endpoints are API-first: an agent structures the owner&apos;s shorthand
              and writes a session with nested entries in one call. Exercise names resolve
              case-insensitively against the catalog (names + aliases); unknown names
              auto-create <code>unreviewed</code> catalog entries instead of bouncing the write.
              The original shorthand can be preserved verbatim in <code>raw_sets</code>.
            </p>
            <CodeBlock>{`curl -X POST https://your-instance/api/v1/workouts \\
  -H "Authorization: Bearer ohts_pat_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "strength",
    "label": "Day A",
    "started_at": "2026-07-09T17:30:00-07:00",
    "duration_min": 55,
    "energy": 4,
    "entries": [
      {
        "exercise_name": "Chest press",
        "raw_sets": "130x10 x3",
        "sets": [
          { "weight": 130, "reps": 10 },
          { "weight": 130, "reps": 10 },
          { "weight": 130, "reps": 10 }
        ]
      },
      {
        "exercise_name": "Plank",
        "raw_sets": "75s",
        "sets": [{ "seconds": 75 }]
      }
    ]
  }'
# 201 -> the created workout (entries carry derived working_weight / top_reps)
# 409 -> already logged at that started_at; body carries the EXISTING workout`}</CodeBlock>
            <ul className="list-disc list-inside space-y-2 mt-4" style={{ color: 'var(--color-text-muted)' }}>
              <li>
                Creating a second session at the same <code>started_at</code> returns{' '}
                <code>409</code> with the existing workout as the body — agents treat that as
                &quot;already logged&quot;, so re-running a logging job is safe.
              </li>
              <li>
                Weeks are Monday-anchored <code>YYYY-MM-DD</code> keys in the owner&apos;s
                timezone. <code>GET /api/v1/weeks/{'{weekStart}'}</code> computes the weekly
                rollup on the fly: sessions by type, weigh-in and body-composition averages,
                recovery averages, latest neck/waist, frequency-goal progress, the check-in
                row, and prior-week deltas. A non-Monday key is a 400.
              </li>
              <li>
                <code>PUT /api/v1/checkins/{'{weekStart}'}</code> replaces all manual fields;{' '}
                <code>neck_in</code>/<code>waist_in</code> are written through to vitals
                (metrics <code>neck</code>/<code>waist</code>, source <code>manual</code>) and
                read back by rollups like any other measurement.
              </li>
              <li>
                Goals: <code>{`{ "kind": "metric", "metric_key": "weight", "direction": "decrease", "target_value": 199 }`}</code>{' '}
                or <code>{`{ "kind": "frequency", "session_type": "strength", "per_week": 3 }`}</code>.
                At most one active goal per metric / session type (409 otherwise).
              </li>
            </ul>
          </section>

          {/* 5. Upsert semantics */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">5. Vitals upsert semantics</h2>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Writes are idempotent on <code>(metric_key, recorded_at, source)</code> per user.
              Re-posting the same tuple <em>updates</em> the existing row instead of duplicating
              it, so bridges can safely re-push a whole day (or a whole history).
            </p>
            <ul className="list-disc list-inside space-y-2" style={{ color: 'var(--color-text-muted)' }}>
              <li>
                <code>recorded_at</code> accepts an ISO date or datetime and is normalized to day
                granularity (<code>T00:00:00Z</code>) — except intraday-capable metrics
                (blood_glucose, bp_systolic, bp_diastolic), which keep full timestamps.
              </li>
              <li>
                <code>unit</code> is optional; omitting it declares the value already
                canonical. When provided it must be an accepted input unit for the metric —
                the canonical unit, or a registered alternate converted server-side (metrics
                stored in <code>lbs</code> accept <code>kg</code>; metrics stored in{' '}
                <code>in</code>, which is every body circumference, accept <code>cm</code>).
                Anything else is rejected rather than guessed at, and responses always echo
                the normalized value with the canonical unit.
              </li>
              <li>
                Body circumferences are provider-neutral: integrations map their own field
                names onto the canonical keys (<code>waist</code>, <code>abdomen</code>,{' '}
                <code>shoulder</code>, <code>left_bicep</code>, <code>right_calf</code>, …)
                before submitting. Unsided keys are an unspecified or caller-derived
                measurement; <code>left_*</code> and <code>right_*</code> are independent
                series that are never averaged, copied or derived from one another.
              </li>
              <li>
                Unknown <code>metric_key</code>s are rejected with 400: the registry is closed.
                Batch requests report per-record errors by index without aborting valid records.
              </li>
            </ul>
          </section>

          {/* 6. Health Connect */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">
              6. Health Connect ingestion (Android)
            </h2>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              The{' '}
              <a
                href="https://github.com/owen282000/life-dashboard-companion-app"
                style={{ color: 'var(--color-sage)' }}
              >
                Life Dashboard companion app
              </a>{' '}
              (v1.8.x) can POST Health Connect records straight to this instance. Create the
              integration in <strong>Settings → Health Connect</strong>; it hands you the webhook
              URL, a dedicated <code>write:health_connect</code> token, and an HMAC signing
              secret. Payloads are validated against the published relay schema, pinned at
              upstream commit <code>{UPSTREAM_SCHEMA_COMMIT.slice(0, 12)}</code>.
            </p>

            <h3 className="text-lg font-semibold mb-2 mt-6">Phone configuration</h3>
            <CodeBlock>{`Webhook URL:   https://your-instance/api/v1/integrations/health-connect/webhook
Header name:   Authorization
Header value:  Bearer ohts_pat_...      (scope: write:health_connect only)
HMAC secret:   <shown once when you create or rotate the integration>
Daily totals:  enabled
MQTT:          disabled`}</CodeBlock>

            <h3 className="text-lg font-semibold mb-2 mt-6">Signature</h3>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Every delivery must carry an <code>X-Signature</code> header computed over the{' '}
              <em>exact raw request bytes</em>. The receiver hashes the body before parsing any
              JSON and compares in constant time, so re-serialized JSON will not verify.
            </p>
            <CodeBlock>{`X-Signature: sha256=<hex of HMAC-SHA256(secret, exact raw request body)>`}</CodeBlock>

            <h3 className="text-lg font-semibold mb-2 mt-6">Inventory first</h3>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              A new integration starts in <strong>inventory</strong> status. It authenticates,
              verifies, validates and stores every accepted record losslessly — preserving the
              Health Connect record UUID and the Android package that wrote it — but writes{' '}
              <em>no</em> canonical data. Settings then shows which packages and record types
              your phone actually sends, and you approve exact packages for exact domains. There
              is no wildcard approval.
            </p>
            <ul className="list-disc list-inside space-y-2" style={{ color: 'var(--color-text-muted)' }}>
              <li>
                <strong>Daily totals</strong> → vitals <code>steps</code>, <code>distance</code>{' '}
                (meters converted to miles), <code>active_calories</code>,{' '}
                <code>total_calories</code>, with source <code>health_connect_daily</code>. These
                come from Health Connect&apos;s aggregate API, which already deduplicates phone
                and watch, so the newest snapshot <em>replaces</em> the day.
              </li>
              <li>
                <strong>Nutrition</strong> → <code>/api/v1/nutrition/daily</code>. One canonical
                row per America/Phoenix date and approved package; every sync recomputes the whole
                day from retained records and overwrites it. An incoming subtotal is never added
                to a stored total, so retries and edits cannot double count. A missing nutrient is
                null (unknown), never zero. Approving a source, switching the record-shape
                strategy or enabling the canonical write <em>rebuilds the days already
                retained</em> — no further sync from the phone is needed.
              </li>
              <li>
                Everything else stays <strong>raw-only</strong>. Oura sleep/HRV/resting heart
                rate, Renpho weight and body composition, and myAir metrics remain owned by their
                direct bridges, and a generic Health Connect exercise session is never turned into
                a completed strength workout.
              </li>
            </ul>

            <h3 className="text-lg font-semibold mb-2 mt-6">Reading retained data back</h3>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Two endpoints expose what was retained, both behind the dedicated{' '}
              <code>read:health_connect</code> scope. <code>read:all</code> satisfies it;{' '}
              <code>write:health_connect</code> deliberately does <strong>not</strong> — the token
              you paste into a phone delivers records, it does not read your history back out.
            </p>
            <CodeBlock>{`# What has this account actually received, and does it become canonical data?
curl -H "Authorization: Bearer $TOKEN" \\
  "$BASE/api/v1/integrations/health-connect/inventory"

# Retained raw records — bounded and cursor-paginated
curl -H "Authorization: Bearer $TOKEN" \\
  "$BASE/api/v1/integrations/health-connect/records?record_type=nutrition\\
&start_at=2026-08-01T00:00:00Z&end_at=2026-09-02T00:00:00Z&limit=50"`}</CodeBlock>
            <p className="leading-relaxed mt-3 mb-3" style={{ color: 'var(--color-text-muted)' }}>
              The records endpoint has no permissive defaults: <code>integration_id</code> or{' '}
              <code>record_type</code> is required, an explicit <code>start_at</code>/
              <code>end_at</code> range is required and may span at most 400 days, and pages cap
              at 200 records. A missing bound is a <code>400</code>, never a full dump. Responses
              never carry HMAC secrets, token hashes, encrypted credentials, request body
              digests, or another user&apos;s records.
            </p>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Raw records are <strong>diagnostic/source</strong> data — deduplicated, but not
              unit-normalized and not deconflicted against the direct bridges. For analytics,
              prefer the canonical domain endpoints: <code>/api/v1/nutrition/daily</code> for
              actual intake, <code>/api/v1/vitals</code> for approved daily metrics, and{' '}
              <code>/api/v1/workouts</code> for completed workouts. Use the raw endpoint for the
              types that are deliberately raw-only, and for debugging what a source really sent.
            </p>

            <h3 className="text-lg font-semibold mb-2 mt-6">The full relay contract</h3>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              All 35 record arrays the pinned schema can emit are understood at the ingestion
              boundary, along with <code>_diagnostics</code> and the backfill window metadata.
              Unknown top-level fields and unknown record fields are retained verbatim and never
              fail a delivery. Known record types are structurally validated; failures are counted
              and reported as <code>normalization.invalid_records</code> and{' '}
              <code>invalid_by_type</code> while still being retained, so one malformed
              heart-rate sample never discards the nutrition records delivered with it.
            </p>
            <h3 className="text-lg font-semibold mb-2 mt-6">Deduplication</h3>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Records dedupe on{' '}
              <code>(user, record_type, source_package, source_uuid)</code>, so a re-sent payload,
              an overlapping batch, or a backfill that covers days you already have produces no
              duplicates. The same UUID from a different package — or for a different record type
              — stays a separate record. Records the relay delivers without a UUID are retained
              under an explicitly weaker content-derived identity and labelled as such.
            </p>
          </section>

          {/* 7. Metric registry */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">7. Metric registry</h2>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              Every metric the write endpoints accept, with its canonical stored unit. Also
              available as JSON at{' '}
              <a href="/api/v1/metrics" style={{ color: 'var(--color-sage)' }}>
                /api/v1/metrics
              </a>
              .
            </p>
            {CATEGORY_ORDER.map((category) => {
              const metrics = METRICS.filter((m) => m.category === category);
              if (metrics.length === 0) return null;
              return (
                <div key={category} className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">{CATEGORY_LABELS[category]}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr>
                          <th className="py-2 pr-4" style={thStyle}>metric_key</th>
                          <th className="py-2 pr-4" style={thStyle}>Label</th>
                          <th className="py-2 pr-4" style={thStyle}>Unit</th>
                          <th className="py-2 pr-4" style={thStyle}>Type</th>
                          <th className="py-2" style={thStyle}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.map((m) => (
                          <tr key={m.key}>
                            <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap" style={tdStyle}>
                              {m.key}
                            </td>
                            <td className="py-2 pr-4" style={tdStyle}>{m.label}</td>
                            <td className="py-2 pr-4 whitespace-nowrap" style={tdStyle}>
                              {m.unit ?? '—'}
                            </td>
                            <td className="py-2 pr-4" style={tdStyle}>{m.valueType}</td>
                            <td className="py-2" style={tdStyle}>{metricNotes(m)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </section>

          {/* 8. Backfill */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">8. Backfilling history</h2>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              To seed an instance with historical data, prepare a JSON <em>array</em> of the
              same record objects the write endpoints take and push it in chunks of up to 500
              via <code>POST /api/v1/vitals/batch</code>. Because writes are idempotent, a
              backfill can be re-run safely.
            </p>
            <CodeBlock>{`[
  { "metric_key": "sleep_duration", "value": 7.4, "recorded_at": "2026-06-01", "source": "oura" },
  { "metric_key": "resilience", "value_label": "solid", "recorded_at": "2026-06-01", "source": "oura" },
  { "metric_key": "weight", "value": 80.2, "unit": "kg", "recorded_at": "2026-06-01", "source": "renpho" }
]`}</CodeBlock>
            <p className="leading-relaxed mt-3" style={{ color: 'var(--color-text-muted)' }}>
              The HealthTrack repository ships a reference importer
              (<code>scripts/import-devices-backfill.ts</code>, with a <code>--dry-run</code>{' '}
              validation mode) and the full file format in{' '}
              <a
                href="https://github.com/EzekielTheMad/healthtrack/blob/main/docs/backfill-format.md"
                style={{ color: 'var(--color-sage)' }}
              >
                docs/backfill-format.md
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      {/* ---------- Footer ---------- */}
      <footer
        className="px-6 py-8 text-center text-sm"
        style={{
          borderTop: '1px solid var(--border-card)',
          color: 'var(--color-text-muted)',
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="font-bold" style={{ color: 'var(--color-sage)' }}>
              Health
            </span>
            <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Track
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="no-underline hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Privacy Policy
            </Link>
            <Link href="/terms" className="no-underline hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Terms of Service
            </Link>
          </div>
          <p>&copy; 2026 HealthTrack. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
