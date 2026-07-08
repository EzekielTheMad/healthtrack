/**
 * Smoke checks for the major HTTP surfaces.
 *
 * Usage:
 *   1. Set TEST_USER_EMAIL and TEST_USER_PASSWORD in your environment for a
 *      pre-existing user account (or the script will skip auth-only checks).
 *   2. Start the dev server: `npm run dev`
 *   3. Run: `npx tsx scripts/smoke.ts`
 *
 * Exit code 0 if all checks pass, 1 if any fail.
 *
 * What it covers:
 *   - Marketing pages render (/, /privacy, /terms, /login)
 *   - Auth-gated routes redirect when unauthenticated
 *   - /api/v1 root returns the API index
 *   - /api/share/public rejects malformed tokens with 400
 *   - /api/share/public rate limits after 30 requests
 *   - /api/oura/start redirects to /login when unauthenticated
 *   - /api/admin/breach-notify rejects missing/wrong auth
 *
 * Does NOT cover (use manual click-through):
 *   - Full sign-up email confirmation flow
 *   - PDF upload + parse
 *   - Oura OAuth round-trip (requires real Oura account)
 *   - End-to-end share flow (recipient inbox)
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

type Check = {
  name: string;
  run: () => Promise<{ ok: boolean; detail?: string }>;
};

const checks: Check[] = [
  {
    name: 'GET / renders',
    async run() {
      const res = await fetch(`${BASE}/`, { redirect: 'manual' });
      return {
        ok: res.status === 200,
        detail: `status=${res.status}`,
      };
    },
  },
  {
    name: 'GET /privacy renders',
    async run() {
      const res = await fetch(`${BASE}/privacy`, { redirect: 'manual' });
      return { ok: res.status === 200, detail: `status=${res.status}` };
    },
  },
  {
    name: 'GET /terms renders',
    async run() {
      const res = await fetch(`${BASE}/terms`, { redirect: 'manual' });
      return { ok: res.status === 200, detail: `status=${res.status}` };
    },
  },
  {
    name: 'GET /login renders',
    async run() {
      const res = await fetch(`${BASE}/login`, { redirect: 'manual' });
      return { ok: res.status === 200, detail: `status=${res.status}` };
    },
  },
  {
    name: 'GET /dashboard redirects when unauthenticated',
    async run() {
      const res = await fetch(`${BASE}/dashboard`, { redirect: 'manual' });
      const location = res.headers.get('location') ?? '';
      return {
        ok: (res.status === 307 || res.status === 308) && location.includes('/login'),
        detail: `status=${res.status} location=${location}`,
      };
    },
  },
  {
    name: 'GET /api/v1 returns API index JSON',
    async run() {
      const res = await fetch(`${BASE}/api/v1`);
      if (!res.ok) return { ok: false, detail: `status=${res.status}` };
      const body = await res.json();
      return {
        ok: typeof body.api === 'string' && Array.isArray(body.endpoints),
        detail: `keys=${Object.keys(body).join(',')}`,
      };
    },
  },
  {
    name: 'GET /api/v1/medications without auth returns 401',
    async run() {
      const res = await fetch(`${BASE}/api/v1/medications`);
      return { ok: res.status === 401, detail: `status=${res.status}` };
    },
  },
  {
    name: 'GET /api/share/public without token returns 400',
    async run() {
      const res = await fetch(`${BASE}/api/share/public`);
      return { ok: res.status === 400, detail: `status=${res.status}` };
    },
  },
  {
    name: 'GET /api/share/public with malformed token returns 400',
    async run() {
      const res = await fetch(`${BASE}/api/share/public?token=not-a-uuid`);
      return { ok: res.status === 400, detail: `status=${res.status}` };
    },
  },
  {
    name: 'GET /api/share/public with valid-shape token returns 404',
    async run() {
      // Random UUID that won't exist in the DB
      const res = await fetch(
        `${BASE}/api/share/public?token=00000000-0000-4000-8000-000000000000`,
      );
      return { ok: res.status === 404, detail: `status=${res.status}` };
    },
  },
  {
    name: 'GET /api/share/public rate-limits after 30 hits',
    async run() {
      const requests: Promise<Response>[] = [];
      for (let i = 0; i < 35; i++) {
        requests.push(
          fetch(`${BASE}/api/share/public?token=00000000-0000-4000-8000-000000000000`),
        );
      }
      const results = await Promise.all(requests);
      const rateLimited = results.some((r) => r.status === 429);
      return {
        ok: rateLimited,
        detail: `statuses=${results.map((r) => r.status).join(',')}`,
      };
    },
  },
  {
    name: 'GET /api/oura/start unauthenticated redirects to /login',
    async run() {
      const res = await fetch(`${BASE}/api/oura/start`, { redirect: 'manual' });
      const location = res.headers.get('location') ?? '';
      return {
        ok: (res.status === 307 || res.status === 308) && location.includes('/login'),
        detail: `status=${res.status} location=${location}`,
      };
    },
  },
  {
    name: 'POST /api/admin/breach-notify without auth returns 401',
    async run() {
      const res = await fetch(`${BASE}/api/admin/breach-notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 't', description: 'd' }),
      });
      return { ok: res.status === 401, detail: `status=${res.status}` };
    },
  },
  {
    name: 'POST /api/admin/breach-notify with wrong auth returns 401',
    async run() {
      const res = await fetch(`${BASE}/api/admin/breach-notify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer not-the-real-key',
        },
        body: JSON.stringify({ title: 't', description: 'd' }),
      });
      return { ok: res.status === 401, detail: `status=${res.status}` };
    },
  },
  {
    name: 'POST /api/health-query without auth returns 401',
    async run() {
      const res = await fetch(`${BASE}/api/health-query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
      });
      return { ok: res.status === 401, detail: `status=${res.status}` };
    },
  },
  {
    name: 'POST /api/share without auth returns 401',
    async run() {
      const res = await fetch(`${BASE}/api/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shared_with_email: 'x@example.com',
          access_level: 'read',
          shared_sections: ['medications'],
        }),
      });
      return { ok: res.status === 401, detail: `status=${res.status}` };
    },
  },
];

async function main() {
  console.log(`Running ${checks.length} smoke checks against ${BASE}\n`);

  let passed = 0;
  let failed = 0;
  for (const check of checks) {
    try {
      const { ok, detail } = await check.run();
      if (ok) {
        passed++;
        console.log(`  PASS  ${check.name}`);
      } else {
        failed++;
        console.log(`  FAIL  ${check.name} — ${detail ?? '(no detail)'}`);
      }
    } catch (err) {
      failed++;
      console.log(
        `  ERR   ${check.name} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
