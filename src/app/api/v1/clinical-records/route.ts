import { NextRequest } from 'next/server';
import {
  CLINICAL_KINDS,
  CLINICAL_KIND_SECTIONS,
  type ClinicalFact,
} from '@/lib/fidelity/contracts';
import { validateApiKey, hasScope, unauthorized, forbidden } from '@/lib/api-auth';
import { corsHeaders, clampLimit, fitnessErrorResponse } from '@/lib/api/v1-fitness';
import { listClinicalFacts } from '@/lib/fidelity/clinical';
const headers = corsHeaders('GET, OPTIONS');
export async function OPTIONS() {
  return new Response(null, { headers });
}
export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request.headers.get('authorization'));
  if (!auth) return unauthorized();
  const requested = request.nextUrl.searchParams.get('kind');
  if (requested && !CLINICAL_KINDS.includes(requested as ClinicalFact['kind']))
    return Response.json(
      { error: `kind must be one of: ${CLINICAL_KINDS.join(', ')}` },
      { status: 400, headers }
    );
  if (
    request.nextUrl.searchParams.has('dependent_id') ||
    request.nextUrl.searchParams.has('owner_id')
  )
    return Response.json(
      { error: 'PAT clinical reads are self-scoped.' },
      { status: 400, headers }
    );
  const kinds = CLINICAL_KINDS.filter(
    (kind) =>
      (!requested || requested === kind) && hasScope(auth, `read:${CLINICAL_KIND_SECTIONS[kind]}`)
  );
  if (!kinds.length)
    return forbidden(
      requested
        ? `read:${CLINICAL_KIND_SECTIONS[requested as ClinicalFact['kind']]}`
        : 'read:clinical domain'
    );
  try {
    const limit = clampLimit(request.nextUrl.searchParams.get('limit'), 200, 1000);
    const records = (
      await Promise.all(
        kinds.map((kind) =>
          listClinicalFacts(
            auth.userId,
            { ownerId: auth.userId, dependentId: null },
            { kind, limit }
          )
        )
      )
    )
      .flat()
      .sort(
        (a, b) =>
          (b.received_at ?? '').localeCompare(a.received_at ?? '') || a.id.localeCompare(b.id)
      )
      .slice(0, limit);
    return Response.json(
      {
        format: 'typed',
        records,
        coverage: {
          included_kinds: kinds,
          unavailable_kinds: CLINICAL_KINDS.filter(
            (kind) => !hasScope(auth, `read:${CLINICAL_KIND_SECTIONS[kind]}`)
          ),
          limit,
          may_be_limited: records.length >= limit,
          legacy_receipt: 'unknown',
          warning:
            'Includes typed outcomes and explicit legacy overlays; conflicting legacy versions remain visible. No original-file access is granted by a clinical read.',
        },
      },
      { headers }
    );
  } catch (error) {
    return fitnessErrorResponse(error, headers, '[clinical records]');
  }
}
