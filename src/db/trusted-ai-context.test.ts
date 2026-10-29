// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { setupRepoDb, insertUser, OWNER, type RepoTestDb } from '@/lib/repos/repo-test-harness';
let ctx: RepoTestDb;
beforeEach(async () => {
  ctx = await setupRepoDb('healthtrack-trusted-ai-');
  insertUser(ctx.sqlite, OWNER);
});
afterEach(() => ctx.restore());
it('preserves legacy alerts/checks/dismissals but never treats them as current', async () => {
  const { createMedication } = await import('@/lib/repos/medications');
  const med = await createMedication(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    { name: 'Fictional medication', active: true }
  );
  ctx.sqlite
    .prepare(
      "INSERT INTO interaction_alerts(id,user_id,trigger_medication_id,alert_text,severity,medication_snapshot,checked_at) VALUES('legacy-alert',?,?, 'Fictional legacy pooled text','warning','{}','2026-01-01T00:00:00Z')"
    )
    .run(OWNER, med.id);
  ctx.sqlite
    .prepare(
      "INSERT INTO interaction_checks(id,user_id,has_interactions,checked_at) VALUES('legacy-check',?,0,'2026-01-01T00:00:00Z')"
    )
    .run(OWNER);
  ctx.sqlite
    .prepare(
      "INSERT INTO ai_lab_warning_dismissals(id,user_id,warning_key,lab_visit_date,created_at,updated_at) VALUES('legacy-dismiss',?,'marker','2026-01-01','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')"
    )
    .run(OWNER);
  const repo = await import('@/lib/repos/interaction-alerts');
  const warnings = await import('@/lib/repos/lab-warning-dismissals');
  expect(
    await repo.listActiveInteractionAlerts(OWNER, { ownerId: OWNER, dependentId: null })
  ).toEqual([]);
  expect(await repo.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: null })).toBeNull();
  expect(await warnings.listLabWarningDismissals(OWNER)).toEqual([]);
  await repo.recordInteractionCheck(OWNER, null, true);
  expect(
    (await repo.getInteractionCheck(OWNER, { ownerId: OWNER, dependentId: null }))?.hasInteractions
  ).toBe(true);
  expect(
    ctx.sqlite
      .prepare('SELECT context_version FROM interaction_checks WHERE id=?')
      .get('legacy-check')
  ).toEqual({ context_version: 0 });
  expect(ctx.sqlite.prepare('SELECT count(*) n FROM interaction_checks').get()).toEqual({ n: 2 });
  expect(
    ctx.sqlite.prepare('SELECT alert_text FROM interaction_alerts WHERE id=?').get('legacy-alert')
  ).toEqual({ alert_text: 'Fictional legacy pooled text' });
});
