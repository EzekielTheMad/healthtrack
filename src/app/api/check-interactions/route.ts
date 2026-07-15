import { NextRequest } from 'next/server';
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

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();

    // Gated after auth so unauthenticated callers can't probe instance config.
    if (!getCapabilities().ai) {
      return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
    }

    // Cap the AI interaction check per user.
    if (!checkRateLimit(`check-interactions:${user.id}`, { max: 20, windowMs: HOUR_MS })) {
      return apiError(429, 'rate_limited', 'Too many interaction checks this hour. Please try again later.');
    }

    const body = await request.json();
    const { trigger_id } = body as {
      medication_ids?: string[];
      trigger_id?: string;
    };

    // All of the user's active medications, across own + dependent scopes —
    // parity with the old query, which filtered on user_id/active only.
    // (The old route also re-fetched `medication_ids` not present in this
    // set, but that second query used the same user_id+active filter and so
    // could never return additional rows — dead code, dropped.)
    const rows = await listMedications(
      user.id,
      { ownerId: user.id, dependentId: 'all' },
      { active: true },
    );
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
    const byName = new Map(
      medications.map((m) => [m.name.trim().toLowerCase(), m.id]),
    );
    const triggerFor = (names: string[]): string => {
      for (const n of names) {
        const id = byName.get(n.trim().toLowerCase());
        if (id) return id;
      }
      return trigger_id ?? medications[0]!.id;
    };

    const detected: DetectedInteraction[] = alertsWithDisclaimer.map((a) => ({
      signature: interactionSignature(a.medication_names),
      triggerMedicationId: triggerFor(a.medication_names),
      alertText: a.alert_text,
      severity: a.severity,
      medicationSnapshot: { medication_names: a.medication_names },
    }));

    // Reconcile stored alerts (owner scope): preserves snoozes on unchanged
    // interactions, inserts new ones, deletes interactions that no longer
    // exist. Runs even when clear (detected = []) to clear stale alerts.
    await reconcileInteractionAlerts(user.id, null, detected);
    await recordInteractionCheck(user.id, null, result.has_interactions);

    return Response.json({
      ...result,
      alerts: alertsWithDisclaimer,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return apiError(401, 'unauthorized', 'Authentication required');
    }
    // Message surfaced on purpose — the client shows AI-check failures verbatim
    const message = err instanceof Error ? err.message : 'Failed to check interactions';
    return apiError(500, 'internal_error', message);
  }
}
