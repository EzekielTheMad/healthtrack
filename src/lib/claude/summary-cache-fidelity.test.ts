// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  setupRepoDb,
  insertUser,
  seedAiConfiguration,
  OWNER,
  type RepoTestDb,
} from '@/lib/repos/repo-test-harness';
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('./health-summary', () => ({ generateHealthSummary: generate }));
let ctx: RepoTestDb;
beforeEach(async () => {
  ctx = await setupRepoDb('hf-summary-cache-');
  insertUser(ctx.sqlite, OWNER);
  seedAiConfiguration(ctx.sqlite, OWNER);
  generate.mockReset().mockResolvedValue({ summary: 'Synthetic summary', highlights: [] });
});
afterEach(() => ctx.restore());
it('includes typed-only medication history in overview input and does not treat it as an empty account', async () => {
  const clinical = await import('@/lib/fidelity/clinical');
  const fact = {
    kind: 'medication',
    name: 'Fictional typed regimen',
    status: 'unconfirmed',
    prescribed_directions: 'Recorded label',
    patient_reported_use: 'Different reported use',
    provenance: { basis: 'patient_reported' },
  };
  const preview = await clinical.stageClinicalIntake(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    { external_id: 'typed-only', items: [{ item_key: 'one', action: 'add', fact }] }
  );
  await clinical.approveClinicalIntake(OWNER, preview.id, {
    digest: preview.digest,
    version: preview.version,
  });
  const { generateAndCacheSummary } = await import('./summary-cache');
  const result = await generateAndCacheSummary(OWNER);
  expect(generate).toHaveBeenCalledOnce();
  expect(generate.mock.calls[0][0].fidelityContext).toContain('Different reported use');
  expect(result.summary.contextMetadata?.fingerprint).toBeTruthy();
});
it('does not cache or return an answer when clinical facts change during generation', async () => {
  const meds = await import('@/lib/repos/medications');
  const med = await meds.createMedication(
    OWNER,
    { ownerId: OWNER, dependentId: null },
    { name: 'Fictional', dosage: '1 mg' }
  );
  generate.mockImplementationOnce(async () => {
    await meds.updateMedication(OWNER, med.id, { dosage: '2 mg' });
    return { summary: 'Stale synthetic answer', highlights: [] };
  });
  const { generateAndCacheSummary } = await import('./summary-cache');
  await expect(generateAndCacheSummary(OWNER)).rejects.toThrow('Health records changed');
  const { getLatestCachedSummary } = await import('@/lib/repos/daily-summaries');
  expect(await getLatestCachedSummary(OWNER)).toBeNull();
});
