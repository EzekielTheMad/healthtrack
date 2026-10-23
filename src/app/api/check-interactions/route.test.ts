// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  setupRepoDb,
  insertUser,
  insertDependent,
  insertDelegate,
  OWNER,
  VIEWER,
  STRANGER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
import type { Medication } from '@/lib/types';

const { authState, checkAI } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
  checkAI: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => {
  class UnauthorizedError extends Error {
    readonly status = 401;
  }
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!authState.userId) throw new UnauthorizedError();
      return { id: authState.userId };
    },
  };
});
vi.mock('@/lib/claude/check-interactions', () => ({ checkMedicationInteractions: checkAI }));

let ctx: RepoTestDb;
let route: typeof import('./route');
let medications: typeof import('@/lib/repos/medications');
let alerts: typeof import('@/lib/repos/interaction-alerts');
let ownerMeds: Awaited<ReturnType<typeof medications.createMedication>>[];
let childMeds: typeof ownerMeds;
const child = 'synthetic-child';
const otherChild = 'foreign-child';

beforeEach(async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-no-network');
  ctx = await setupRepoDb('healthtrack-scoped-interactions-');
  [route, medications, alerts] = await Promise.all([
    import('./route'),
    import('@/lib/repos/medications'),
    import('@/lib/repos/interaction-alerts'),
  ]);
  for (const id of [OWNER, VIEWER, STRANGER]) insertUser(ctx.sqlite, id);
  insertDependent(ctx.sqlite, child, OWNER);
  insertDependent(ctx.sqlite, otherChild, STRANGER);
  ownerMeds = await Promise.all(
    ['Owner A', 'Owner B'].map((name) =>
      medications.createMedication(
        OWNER,
        { ownerId: OWNER, dependentId: null },
        { name, dosage: '5 mg', frequency: 'once_daily' }
      )
    )
  );
  childMeds = await Promise.all(
    ['Child A', 'Child B'].map((name) =>
      medications.createMedication(
        OWNER,
        { ownerId: OWNER, dependentId: child },
        { name, dosage: '1 mg', frequency: 'once_daily' }
      )
    )
  );
  authState.userId = OWNER;
  checkAI.mockReset().mockResolvedValue({ has_interactions: false, alerts: [] });
});
afterEach(() => {
  authState.userId = null;
  ctx.restore();
  vi.unstubAllEnvs();
});
function post(body: unknown) {
  return new NextRequest('http://localhost/api/check-interactions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
async function previousOwnerWarning() {
  await alerts.reconcileInteractionAlerts(OWNER, null, [
    {
      signature: 'owner a|owner b',
      triggerMedicationId: ownerMeds[0].id,
      alertText: 'Previous synthetic warning',
      severity: 'warning',
      medicationSnapshot: {},
    },
  ]);
  await alerts.recordInteractionCheck(OWNER, null, true);
}

describe('interaction checks isolate the selected patient', () => {
  it('defaults to owner medicines and never sends dependent medicines to AI', async () => {
    expect((await route.POST(post({}))).status).toBe(200);
    const sent = checkAI.mock.calls[0][0] as Medication[];
    expect(sent.map((row) => row.name).sort()).toEqual(['Owner A', 'Owner B']);
    expect(
      await alerts.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: child })
    ).toBeNull();
    expect(
      await alerts.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: null })
    ).toMatchObject({ hasInteractions: false });
  });

  it('writes child alerts/status only in the child scope and leaves owner warnings intact', async () => {
    await previousOwnerWarning();
    checkAI.mockResolvedValueOnce({
      has_interactions: true,
      alerts: [
        {
          medication_names: ['Child A', 'Child B'],
          alert_text: 'Synthetic child warning',
          severity: 'warning',
        },
      ],
    });
    const response = await route.POST(
      post({ dependent_id: child, trigger_id: childMeds[1].id, medication_ids: [childMeds[1].id] })
    );
    expect(response.status).toBe(200);
    expect((checkAI.mock.calls[0][0] as Medication[]).map((row) => row.name).sort()).toEqual([
      'Child A',
      'Child B',
    ]);
    const ownerWarnings = await alerts.listActiveInteractionAlerts(OWNER, {
      ownerId: OWNER,
      dependentId: null,
    });
    expect(ownerWarnings).toHaveLength(1);
    expect(ownerWarnings[0].alertText).toBe('Previous synthetic warning');
    const childWarnings = await alerts.listActiveInteractionAlerts(OWNER, {
      ownerId: OWNER,
      dependentId: child,
    });
    expect(childWarnings).toHaveLength(1);
    expect(childWarnings[0].dependentId).toBe(child);
    expect(childWarnings[0].triggerMedicationId).toBe(childMeds[1].id);
    expect(
      await alerts.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: child })
    ).toMatchObject({ hasInteractions: true });
  });

  it('rejects a foreign dependent, cross-patient trigger, and unfiltered scope before AI', async () => {
    for (const body of [
      { dependent_id: otherChild },
      { dependent_id: child, trigger_id: ownerMeds[0].id },
      { dependent_id: child, medication_ids: [ownerMeds[0].id] },
    ])
      expect((await route.POST(post(body))).status).toBe(404);
    expect((await route.POST(post({ dependent_id: 'all' }))).status).toBe(400);
    expect(checkAI).not.toHaveBeenCalled();
  });

  it('rejects delegated interaction writes even when medication editing is granted', async () => {
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'admin',
    });
    authState.userId = VIEWER;
    expect((await route.POST(post({ delegate_owner_id: OWNER }))).status).toBe(404);
    expect(checkAI).not.toHaveBeenCalled();
  });

  it('does not certify an outdated snapshot when medicine changes during generation', async () => {
    await previousOwnerWarning();
    checkAI.mockImplementationOnce(async () => {
      await medications.updateMedication(OWNER, ownerMeds[0].id, { dosage: '10 mg' });
      return { has_interactions: false, alerts: [] };
    });
    expect((await route.POST(post({}))).status).toBe(409);
    expect(
      await alerts.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: null })
    ).toBeNull();
    expect(
      await alerts.listActiveInteractionAlerts(OWNER, { ownerId: OWNER, dependentId: null })
    ).toHaveLength(1);
  });

  it('retains prior warnings with no current clean outcome when rechecking fails', async () => {
    await previousOwnerWarning();
    await medications.updateMedication(OWNER, ownerMeds[0].id, { frequency: 'twice_daily' });
    checkAI.mockRejectedValueOnce(new Error('Synthetic unavailable'));
    expect((await route.POST(post({}))).status).toBe(500);
    expect(
      await alerts.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: null })
    ).toBeNull();
    expect(
      await alerts.listActiveInteractionAlerts(OWNER, { ownerId: OWNER, dependentId: null })
    ).toHaveLength(1);
  });

  it('rolls back warning reconciliation if writing the outcome fails', async () => {
    await previousOwnerWarning();
    ctx.sqlite.exec(
      "CREATE TRIGGER reject_interaction_check BEFORE UPDATE ON interaction_checks BEGIN SELECT RAISE(ABORT, 'Synthetic write failure'); END;"
    );
    expect((await route.POST(post({}))).status).toBe(500);
    const retained = await alerts.listActiveInteractionAlerts(OWNER, {
      ownerId: OWNER,
      dependentId: null,
    });
    expect(retained).toHaveLength(1);
    expect(retained[0].alertText).toBe('Previous synthetic warning');
    expect(
      await alerts.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: null })
    ).toMatchObject({ hasInteractions: true });
  });

  it('still gates unauthenticated and unconfigured requests', async () => {
    authState.userId = null;
    expect((await route.POST(post({}))).status).toBe(401);
    authState.userId = OWNER;
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect((await route.POST(post({}))).status).toBe(501);
    expect(checkAI).not.toHaveBeenCalled();
  });
});
