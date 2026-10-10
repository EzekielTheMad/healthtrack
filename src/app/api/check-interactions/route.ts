import { NextRequest } from 'next/server';
import { z } from 'zod';
import { NotFoundError } from '@/lib/authz';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';
import { rowToSnake } from '@/lib/api/snake';
import { checkMedicationInteractions } from '@/lib/claude/check-interactions';
import { listMedications } from '@/lib/repos/medications';
import {
  reconcileInteractionAlerts,
  recordInteractionCheck,
  interactionSignature,
  type DetectedInteraction,
} from '@/lib/repos/interaction-alerts';
import type { Medication } from '@/lib/types';
import { AI_INTERACTION_DISCLAIMER } from '@/lib/ai-disclaimer';

const DISCLAIMER = AI_INTERACTION_DISCLAIMER;
const idSchema = z.string().trim().min(1);
const bodySchema = z
  .object({
    // Omitted scope is retained for old clients, but means SELF only.
    dependent_id: idSchema
      .refine((id) => id !== 'all')
      .nullable()
      .optional(),
    delegate_owner_id: idSchema.nullable().optional(),
    owner_id: idSchema.nullable().optional(),
    trigger_id: idSchema.optional(),
    medication_ids: z.array(idSchema).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();

    // Gated after auth so unauthenticated callers can't probe instance config.
    if (!getCapabilities().ai) {
      return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
    }

    // Cap the AI interaction check per user.
    if (!checkRateLimit(`check-interactions:${user.id}`, { max: 20, windowMs: HOUR_MS })) {
      return apiError(
        429,
        'rate_limited',
        'Too many interaction checks this hour. Please try again later.'
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError(
        400,
        'invalid_context',
        'Select one valid profile for the interaction check.'
      );
    }
    const body = parsed.data;
    // Alerts and checks are owner-only. Never fall back to the actor's own
    // medications when a delegate requests another person's record.
    if (body.delegate_owner_id || (body.owner_id && body.owner_id !== user.id)) {
      return apiError(
        403,
        'unsupported_context',
        'Interaction checks are unavailable in delegate mode.'
      );
    }
    const scope = { ownerId: user.id, dependentId: body.dependent_id ?? null };
    const rows = await listMedications(user.id, scope, { active: true });
    const medications = rows.map(rowToSnake) as unknown as Medication[];
    const ids = new Set(medications.map((med) => med.id));
    if (
      (body.trigger_id && !ids.has(body.trigger_id)) ||
      body.medication_ids?.some((id) => !ids.has(id))
    ) {
      return apiError(
        400,
        'invalid_context',
        'Medication references must belong to the selected profile and be active.'
      );
    }

    const result = await checkMedicationInteractions(medications, scope);

    // Append disclaimer to each alert
    const alertsWithDisclaimer = result.alerts.map((a) => ({
      ...a,
      alert_text: a.alert_text + DISCLAIMER,
    }));

    // Bind every alert to a medication in this exact profile. The model helper
    // rejects unknown names; there is no arbitrary cross-profile FK fallback.
    const byName = new Map(medications.map((med) => [med.name, med.id]));
    const triggerFor = (names: string[]): string => {
      const matched = names
        .map((name) => byName.get(name))
        .filter((id): id is string => Boolean(id));
      if (body.trigger_id && matched.includes(body.trigger_id)) return body.trigger_id;
      if (!matched[0]) throw new Error('Interaction has no matching medication');
      return matched[0];
    };

    const detected: DetectedInteraction[] = alertsWithDisclaimer.map((a) => ({
      signature: interactionSignature(a.medication_names),
      triggerMedicationId: triggerFor(a.medication_names),
      alertText: a.alert_text,
      severity: a.severity,
      medicationSnapshot: { medication_names: a.medication_names },
    }));

    // Reconcile stored alerts for the checked profile: preserves snoozes on unchanged
    // interactions, inserts new ones, deletes interactions that no longer
    // exist. Runs even when clear (detected = []) to clear stale alerts.
    await reconcileInteractionAlerts(user.id, scope.dependentId, detected);
    await recordInteractionCheck(user.id, scope.dependentId, result.has_interactions);

    return Response.json({
      ...result,
      dependent_id: scope.dependentId,
      alerts: alertsWithDisclaimer,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return apiError(401, 'unauthorized', 'Authentication required');
    }
    if (err instanceof NotFoundError) return apiError(404, 'not_found', 'Not found');
    // Model/provider failures can contain health data. Do not echo or log them.
    return apiError(500, 'internal_error', 'Failed to check interactions. Please try again.');
  }
}
