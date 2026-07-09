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

export const metadata = {
  title: 'API Documentation — HealthTrack',
  description:
    'HealthTrack instance API: personal access tokens, vitals ingest endpoints, and the full metric registry.',
};

const ENDPOINTS: Array<{ method: string; path: string; scope: string; description: string }> = [
  { method: 'GET', path: '/api/v1', scope: '(none)', description: 'API index — endpoints and scopes' },
  { method: 'GET', path: '/api/v1/metrics', scope: '(none)', description: 'Metric registry as JSON (machine-readable)' },
  { method: 'GET', path: '/api/v1/openapi.json', scope: '(none)', description: 'OpenAPI 3.1 document' },
  { method: 'GET', path: '/api/v1/vitals', scope: 'read:vitals', description: 'List vitals (?metric=, ?days=, ?limit=)' },
  { method: 'POST', path: '/api/v1/vitals', scope: 'write:vitals', description: 'Upsert one vital record' },
  { method: 'POST', path: '/api/v1/vitals/batch', scope: 'write:vitals', description: 'Upsert up to 500 records in one transaction' },
  { method: 'GET', path: '/api/v1/medications', scope: 'read:medications', description: 'List medications (?include_inactive=)' },
  { method: 'GET', path: '/api/v1/conditions', scope: 'read:conditions', description: 'List medical conditions' },
  { method: 'GET', path: '/api/v1/allergies', scope: 'read:allergies', description: 'List allergies' },
  { method: 'GET', path: '/api/v1/labs', scope: 'read:labs', description: 'List lab results (?test=, ?days=)' },
  { method: 'GET', path: '/api/v1/procedures', scope: 'read:procedures', description: 'List procedures' },
  { method: 'GET', path: '/api/v1/vaccines', scope: 'read:vaccines', description: 'List vaccine records' },
  { method: 'GET', path: '/api/v1/providers', scope: 'read:providers', description: 'List healthcare providers' },
  { method: 'GET', path: '/api/v1/profile', scope: 'read:profile', description: 'User profile (DOB, height, weight, …)' },
  { method: 'GET', path: '/api/v1/summary', scope: 'read:all', description: 'Full health summary in one call' },
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

          {/* 4. Upsert semantics */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">4. Upsert semantics</h2>
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
                <code>unit</code> is optional; when provided it must equal the metric&apos;s
                canonical unit (no silent conversion — weight/kg is the only exception).
              </li>
              <li>
                Unknown <code>metric_key</code>s are rejected with 400: the registry is closed.
                Batch requests report per-record errors by index without aborting valid records.
              </li>
            </ul>
          </section>

          {/* 5. Metric registry */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">5. Metric registry</h2>
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

          {/* 6. Backfill */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">6. Backfilling history</h2>
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
