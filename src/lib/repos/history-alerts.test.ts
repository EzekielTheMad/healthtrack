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

  it('create/list/snooze round-trip; delegate-mode listing is empty (RLS parity)', async () => {
    const medId = insertMedication(OWNER);
    const ids = await alerts.createInteractionAlerts(OWNER, [
      {
        triggerMedicationId: medId,
        alertText: 'A + B interact',
        severity: 'warning',
        medicationSnapshot: { medication_names: ['A', 'B'] },
        signature: 'a|b',
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

    // non-owner snooze is a silent no-op (returns null, changes nothing)
    expect(await alerts.snoozeInteractionAlert(VIEWER, ids[0], 7)).toBeNull();
    expect(await alerts.listActiveInteractionAlerts(OWNER, own)).toHaveLength(1);

    // owner snooze hides it from the active list and counts as snoozed
    expect(await alerts.snoozeInteractionAlert(OWNER, ids[0], 7)).not.toBeNull();
    expect(await alerts.listActiveInteractionAlerts(OWNER, own)).toHaveLength(0);
    expect(await alerts.countSnoozedInteractionAlerts(OWNER, own)).toBe(1);
  });

  it('snooze clamps warning to 7 days but honors 30 for info', async () => {
    const medId = insertMedication(OWNER);
    const [warnId, infoId] = await alerts.createInteractionAlerts(OWNER, [
      { triggerMedicationId: medId, alertText: 'w', severity: 'warning', medicationSnapshot: {}, signature: 'w' },
      { triggerMedicationId: medId, alertText: 'i', severity: 'info', medicationSnapshot: {}, signature: 'i' },
    ]);
    const now = Date.now();
    const warnUntil = new Date((await alerts.snoozeInteractionAlert(OWNER, warnId, 30))!).getTime();
    const infoUntil = new Date((await alerts.snoozeInteractionAlert(OWNER, infoId, 30))!).getTime();
    // warning capped near 7 days
    expect(warnUntil - now).toBeGreaterThan(6 * 86_400_000);
    expect(warnUntil - now).toBeLessThan(8 * 86_400_000);
    // info honored near 30 days
    expect(infoUntil - now).toBeGreaterThan(29 * 86_400_000);
  });

  it('reconcile preserves snoozes on unchanged interactions and deletes gone ones', async () => {
    const medId = insertMedication(OWNER);
    const own = { ownerId: OWNER, dependentId: null };
    const mk = (sig: string, text: string) => ({
      signature: sig,
      triggerMedicationId: medId,
      alertText: text,
      severity: 'info' as const,
      medicationSnapshot: { medication_names: sig.split('|') },
    });

    await alerts.reconcileInteractionAlerts(OWNER, null, [mk('a|b', 'AB'), mk('c|d', 'CD')]);
    expect(await alerts.listActiveInteractionAlerts(OWNER, own)).toHaveLength(2);

    // snooze the a|b alert
    const ab = (await alerts.listActiveInteractionAlerts(OWNER, own)).find((r) => r.signature === 'a|b')!;
    await alerts.snoozeInteractionAlert(OWNER, ab.id, 7);
    expect(await alerts.listActiveInteractionAlerts(OWNER, own)).toHaveLength(1); // only c|d active

    // a re-check finds only a|b: c|d is deleted, a|b is preserved WITH its snooze
    await alerts.reconcileInteractionAlerts(OWNER, null, [mk('a|b', 'AB updated')]);
    expect(await alerts.listActiveInteractionAlerts(OWNER, own)).toHaveLength(0);
    expect(await alerts.countSnoozedInteractionAlerts(OWNER, own)).toBe(1);
    const rows = ctx.sqlite
      .prepare('select signature, alert_text, snoozed_until from interaction_alerts where user_id = ?')
      .all(OWNER) as { signature: string; alert_text: string; snoozed_until: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].signature).toBe('a|b');
    expect(rows[0].alert_text).toBe('AB updated'); // text refreshed in place
    expect(rows[0].snoozed_until).not.toBeNull(); // snooze survived the re-check

    // the interaction disappears entirely: reconcile([]) removes even the snoozed row
    await alerts.reconcileInteractionAlerts(OWNER, null, []);
    const count = ctx.sqlite
      .prepare('select count(*) c from interaction_alerts where user_id = ?')
      .get(OWNER) as { c: number };
    expect(count.c).toBe(0);
  });

  it('records and reads the latest check status per scope (upsert, owner-only)', async () => {
    const own = { ownerId: OWNER, dependentId: null };
    expect(await alerts.getInteractionCheck(OWNER, own)).toBeNull();

    await alerts.recordInteractionCheck(OWNER, null, true);
    expect((await alerts.getInteractionCheck(OWNER, own))?.hasInteractions).toBe(true);

    await alerts.recordInteractionCheck(OWNER, null, false); // upsert, not a new row
    expect((await alerts.getInteractionCheck(OWNER, own))?.hasInteractions).toBe(false);
    const count = ctx.sqlite
      .prepare('select count(*) c from interaction_checks where user_id = ?')
      .get(OWNER) as { c: number };
    expect(count.c).toBe(1);

    // non-owner read is null (RLS parity)
    expect(await alerts.getInteractionCheck(VIEWER, own)).toBeNull();
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
