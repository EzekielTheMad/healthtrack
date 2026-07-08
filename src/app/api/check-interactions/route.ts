import { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { AI_NOT_CONFIGURED, getCapabilities } from '@/lib/capabilities';
import { rowToSnake } from '@/lib/api/snake';
import { checkMedicationInteractions } from '@/lib/claude/check-interactions';
import { listMedications } from '@/lib/repos/medications';
import {
  clearActiveInteractionAlerts,
  createInteractionAlerts,
} from '@/lib/repos/interaction-alerts';
import type { Medication } from '@/lib/types';

const DISCLAIMER = ' (This is an AI-generated alert, not a substitute for pharmacist review.)';

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();

    // Gated after auth so unauthenticated callers can't probe instance config.
    if (!getCapabilities().ai) {
      return apiError(501, AI_NOT_CONFIGURED, AI_NOT_CONFIGURED);
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

    // Determine trigger medication id
    const triggerId = trigger_id ?? medications[0]?.id ?? null;

    let savedAlertIds: string[] = [];

    if (result.has_interactions && triggerId) {
      // Clear old non-dismissed alerts for this user to avoid stale duplicates
      await clearActiveInteractionAlerts(user.id);

      savedAlertIds = await createInteractionAlerts(
        user.id,
        alertsWithDisclaimer.map((a) => ({
          triggerMedicationId: triggerId,
          alertText: a.alert_text,
          severity: a.severity,
          medicationSnapshot: {
            medication_names: a.medication_names,
          },
        })),
      );
    }

    return Response.json({
      ...result,
      alerts: alertsWithDisclaimer,
      saved_alert_ids: savedAlertIds,
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
