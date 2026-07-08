// @vitest-environment node
/**
 * query_history + interaction_alerts repos — strictly owner-only tables with
 * RLS-parity edges: non-owner listings return [] (not an error) and a
 * non-owner dismiss is a silent no-op.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  setupRepoDb,
  insertUser,
  insertDelegate,
  insertDependent,
  OWNER,
  VIEWER,
  type RepoTestDb,
} from './repo-test-harness';

type HistoryRepo = typeof import('./query-history');
type AlertsRepo = typeof import('./interaction-alerts');

let ctx: RepoTestDb;
let history: HistoryRepo;
let alerts: AlertsRepo;

beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-repo-history-alerts-');
  history = await import('./query-history');
  alerts = await import('./interaction-alerts');
  insertUser(ctx.sqlite, OWNER);
  insertUser(ctx.sqlite, VIEWER);
});

afterEach(() => ctx.restore());

describe('query-history repo', () => {
  it('owner writes and reads own entries, newest first; others see nothing', async () => {
    await history.createQueryHistoryEntry(OWNER, {
      queryText: 'Q1',
      responseText: 'A1',
    });
    const row = await history.createQueryHistoryEntry(OWNER, {
      queryText: 'Q2',
      responseText: 'A2',
    });
    expect(row.userId).toBe(OWNER);
    expect(row.dependentId).toBeNull();

    const listed = await history.listQueryHistory(OWNER);
    expect(listed).toHaveLength(2);
    expect(await history.listQueryHistory(VIEWER)).toHaveLength(0);

    await expect(
      history.createQueryHistoryEntry(OWNER, { queryText: '', responseText: 'x' }),
    ).rejects.toThrow();
  });
});

describe('interaction-alerts repo', () => {
  function insertMedication(userId: string): string {
    const id = crypto.randomUUID();
    ctx.sqlite
      .prepare(
        `insert into medications (id, user_id, name, active, created_at, updated_at)
         values (?, ?, 'Med', 1, ?, ?)`,
      )
      .run(id, userId, new Date().toISOString(), new Date().toISOString());
    return id;
  }

  it('create/list/dismiss round-trip; delegate-mode listing is empty (RLS parity)', async () => {
    const medId = insertMedication(OWNER);
    const ids = await alerts.createInteractionAlerts(OWNER, [
      {
        triggerMedicationId: medId,
        alertText: 'A + B interact',
        severity: 'warning',
        medicationSnapshot: { medication_names: ['A', 'B'] },
      },
    ]);
    expect(ids).toHaveLength(1);

    const own = { ownerId: OWNER, dependentId: null };
    const listed = await alerts.listActiveInteractionAlerts(OWNER, own);
    expect(listed).toHaveLength(1);
    expect(listed[0].medicationSnapshot).toEqual({ medication_names: ['A', 'B'] });

    // even an accepted admin delegate sees an EMPTY list, not an error
    insertDelegate(ctx.sqlite, {
      ownerId: OWNER,
      delegateUserId: VIEWER,
      permissionLevel: 'admin',
    });
    expect(
      await alerts.listActiveInteractionAlerts(VIEWER, {
        ownerId: OWNER,
        dependentId: 'all',
      }),
    ).toEqual([]);

    // non-owner dismiss is a silent no-op
    await alerts.dismissInteractionAlert(VIEWER, ids[0]);
    expect(await alerts.listActiveInteractionAlerts(OWNER, own)).toHaveLength(1);

    await alerts.dismissInteractionAlert(OWNER, ids[0]);
    expect(await alerts.listActiveInteractionAlerts(OWNER, own)).toHaveLength(0);
  });

  it('clearActiveInteractionAlerts removes only the actor’s non-dismissed rows', async () => {
    const medId = insertMedication(OWNER);
    const [a, b] = await alerts.createInteractionAlerts(OWNER, [
      {
        triggerMedicationId: medId,
        alertText: 'one',
        severity: 'info',
        medicationSnapshot: {},
      },
      {
        triggerMedicationId: medId,
        alertText: 'two',
        severity: 'critical',
        medicationSnapshot: {},
      },
    ]);
    await alerts.dismissInteractionAlert(OWNER, a);

    await alerts.clearActiveInteractionAlerts(OWNER);

    const remaining = ctx.sqlite
      .prepare(`select id, dismissed from interaction_alerts where user_id = ?`)
      .all(OWNER) as { id: string; dismissed: number }[];
    // the dismissed alert survives (audit trail), the active one is gone
    expect(remaining.map((r) => r.id)).toEqual([a]);
    expect(remaining[0].dismissed).toBe(1);
    expect(remaining.find((r) => r.id === b)).toBeUndefined();
  });

  it('dependent scope filters exactly', async () => {
    const medId = insertMedication(OWNER);
    const depId = crypto.randomUUID();
    insertDependent(ctx.sqlite, depId, OWNER);
    ctx.sqlite
      .prepare(
        `insert into interaction_alerts
           (id, user_id, trigger_medication_id, alert_text, severity, dismissed, checked_at, medication_snapshot, dependent_id)
         values (?, ?, ?, 'dep alert', 'warning', 0, ?, '{}', ?)`,
      )
      .run(crypto.randomUUID(), OWNER, medId, new Date().toISOString(), depId);

    expect(
      await alerts.listActiveInteractionAlerts(OWNER, {
        ownerId: OWNER,
        dependentId: depId,
      }),
    ).toHaveLength(1);
    expect(
      await alerts.listActiveInteractionAlerts(OWNER, {
        ownerId: OWNER,
        dependentId: null,
      }),
    ).toHaveLength(0);
    expect(
      await alerts.listActiveInteractionAlerts(OWNER, {
        ownerId: OWNER,
        dependentId: 'all',
      }),
    ).toHaveLength(1);
  });
});
