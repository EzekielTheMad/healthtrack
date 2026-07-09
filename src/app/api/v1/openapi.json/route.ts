/**
 * GET /api/v1/openapi.json — OpenAPI 3.1 description of the v1 PAT surface.
 *
 * Deliberately PUBLIC (no auth): it documents API shape only, never user
 * data, so LLMs and bridge authors can discover the API from any instance.
 * The document lives in src/lib/api/openapi.ts and is pinned against route
 * drift by route.test.ts next to this file.
 */
import { OPENAPI_DOCUMENT } from '@/lib/api/openapi';

export const dynamic = 'force-static';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders });
}

export async function GET() {
  return Response.json(OPENAPI_DOCUMENT, { headers: corsHeaders });
}
