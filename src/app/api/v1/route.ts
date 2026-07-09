import { AVAILABLE_SCOPES } from '@/lib/api-auth';

export const dynamic = 'force-static';

export async function GET() {
  const scopes = AVAILABLE_SCOPES.map((s) => ({
    value: s.value,
    label: s.label,
    description: s.description,
  }));

  return Response.json({
    api: 'HealthTracker API v1',
    version: '1.0.0',
    auth: 'Bearer token in Authorization header. Format: Bearer ohts_pat_...',
    docs: '/docs/api',
    openapi: '/api/v1/openapi.json',
    endpoints: [
      {
        path: '/api/v1/metrics',
        method: 'GET',
        scope: null,
        params: [],
        description: 'Metric registry as JSON (public, no auth)',
      },
      {
        path: '/api/v1/openapi.json',
        method: 'GET',
        scope: null,
        params: [],
        description: 'OpenAPI 3.1 document (public, no auth)',
      },
      {
        path: '/api/v1/medications',
        method: 'GET',
        scope: 'read:medications',
        params: ['include_inactive'],
        description: 'List medications (active only by default)',
      },
      {
        path: '/api/v1/conditions',
        method: 'GET',
        scope: 'read:conditions',
        params: [],
        description: 'List medical conditions',
      },
      {
        path: '/api/v1/allergies',
        method: 'GET',
        scope: 'read:allergies',
        params: [],
        description: 'List allergies',
      },
      {
        path: '/api/v1/vitals',
        method: 'GET',
        scope: 'read:vitals',
        params: ['metric', 'days', 'limit'],
        description: 'List vital signs',
      },
      {
        path: '/api/v1/vitals',
        method: 'POST',
        scope: 'write:vitals',
        params: [],
        description: 'Upsert one vital record (idempotent on metric/day/source)',
      },
      {
        path: '/api/v1/vitals/batch',
        method: 'POST',
        scope: 'write:vitals',
        params: [],
        description: 'Upsert up to 500 vital records in one transaction',
      },
      {
        path: '/api/v1/labs',
        method: 'GET',
        scope: 'read:labs',
        params: ['test', 'days'],
        description: 'List lab results',
      },
      {
        path: '/api/v1/procedures',
        method: 'GET',
        scope: 'read:procedures',
        params: [],
        description: 'List procedures',
      },
      {
        path: '/api/v1/vaccines',
        method: 'GET',
        scope: 'read:vaccines',
        params: [],
        description: 'List vaccine records',
      },
      {
        path: '/api/v1/providers',
        method: 'GET',
        scope: 'read:providers',
        params: [],
        description: 'List healthcare providers',
      },
      {
        path: '/api/v1/profile',
        method: 'GET',
        scope: 'read:profile',
        params: [],
        description: 'Get user profile (DOB, height, weight, etc.)',
      },
      {
        path: '/api/v1/summary',
        method: 'GET',
        scope: 'read:all',
        params: [],
        description: 'Full health summary — all data in one call',
      },
    ],
    scopes,
  });
}
