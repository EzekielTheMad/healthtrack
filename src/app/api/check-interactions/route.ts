import { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { checkRateLimit, HOUR_MS } from '@/lib/api/rate-limit';
import { rowToSnake } from '@/lib/api/snake';
import { checkMedicationInteractions } from '@/lib/claude/check-interactions';
import { listMedications } from '@/lib/repos/medications';
import {
  commitInteractionCheck,
  interactionSignature,
  type DetectedInteraction,
} from '@/lib/repos/interaction-alerts';
import type { Medication } from '@/lib/types';
import { AI_INTERACTION_DISCLAIMER } from '@/lib/ai-disclaimer';
import { z } from 'zod';
import { NotFoundError } from '@/lib/authz';
import { errorResponse } from '@/lib/api/respond';

const DISCLAIMER = AI_INTERACTION_DISCLAIMER;
const bodySchema = z
  .object({
    medication_ids: z.array(z.string().min(1)).optional(),
    trigger_id: z.string().min(1).optional(),
    dependent_id: z.string().min(1).nullable().optional(),
    delegate_owner_id: z.string().min(1).nullable().optional(),
    owner_id: z.string().min(1).nullable().optional(),
  })
  .refine((body) => body.dependent_id !== 'all', 'Choose one patient.');

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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return apiError(400, 'invalid_body', 'Invalid JSON request body');
    }
    const body = bodySchema.parse(rawBody);
    const { trigger_id } = body;
    // Interaction outcomes have no delegate/share write policy. A delegate's
    // medication access cannot implicitly grant access to this separate domain.
    if (
      (body.delegate_owner_id && body.delegate_owner_id !== user.id) ||
      (body.owner_id && body.owner_id !== user.id)
    )
      throw new NotFoundError();
    const scope = { ownerId: user.id, dependentId: body.dependent_id ?? null };
    const rows = await listMedications(user.id, scope, { active: true });
    const selectedIds = new Set(rows.map((row) => row.id));
    if (
      [...(body.medication_ids ?? []), ...(trigger_id ? [trigger_id] : [])].some(
        (id) => !selectedIds.has(id)
      )
    )
      throw new NotFoundError();
    const medications = rows.map(rowToSnake) as unknown as Medication[];

    // Run the interaction check
    const result = await checkMedicationInteractions(medications);

    // Append disclaimer to each alert
    const alertsWithDisclaimer = result.alerts.map((a) => ({
      ...a,
      alert_text: a.alert_text + DISCLAIMER,
    }));

    // Map each detected interaction to a stable signature and a trigger med.
    // trigger_id is honored when it names one of the interacting meds; otherwise
    // we prefer a med that actually appears in the interaction, falling back to
    // any active med (the FK just needs a valid id — cascades on med delete).
    const byName = new Map(medications.map((m) => [m.name.trim().toLowerCase(), m.id]));
    const triggerFor = (names: string[]): string => {
      if (trigger_id && names.some((name) => byName.get(name.trim().toLowerCase()) === trigger_id))
        return trigger_id;
      for (const n of names) {
        const id = byName.get(n.trim().toLowerCase());
        if (id) return id;
      }
      return medications[0]!.id;
    };

    const detected: DetectedInteraction[] = alertsWithDisclaimer.map((a) => ({
      signature: interactionSignature(a.medication_names),
      triggerMedicationId: triggerFor(a.medication_names),
      alertText: a.alert_text,
      severity: a.severity,
      medicationSnapshot: { medication_names: a.medication_names },
    }));

    // Reconcile stored alerts for this exact patient: preserves snoozes on unchanged
    // interactions, inserts new ones, deletes interactions that no longer
    // exist. Runs even when clear (detected = []) to clear stale alerts.
    // Snapshot guard and writes share one synchronous transaction, so a late
    // result cannot replace the invalidation from a concurrent medication edit.
    if (
      !commitInteractionCheck(user.id, scope.dependentId, rows, detected, result.has_interactions)
    ) {
      return apiError(
        409,
        'medications_changed',
        'Medications changed while checking. Please check again.'
      );
    }

    return Response.json({
      ...result,
      alerts: alertsWithDisclaimer,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return apiError(401, 'unauthorized', 'Authentication required');
    }
    if (err instanceof NotFoundError || err instanceof z.ZodError) return errorResponse(err);
    // Message surfaced on purpose — the client shows AI-check failures verbatim
    const message = err instanceof Error ? err.message : 'Failed to check interactions';
    return apiError(500, 'internal_error', message);
  }
}
