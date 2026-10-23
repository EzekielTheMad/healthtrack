// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessage } from './call';
import { parseLabPdf } from './parse-lab';
import { parseMedicalHistory } from './parse-medical-history';
import { labClaims, historyClaims } from '@/lib/import/claims';
vi.mock('./call', () => ({ createMessage: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: class SyntheticClient {} }));
const call = vi.mocked(createMessage);
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'synthetic-placeholder';
  call.mockReset();
});
afterEach(() => {
  if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved;
});
function response(value: unknown) {
  call.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(value) }] } as never);
}
describe('document extraction preserves date precision and file modality', () => {
  it('keeps result-specific dates and holds ambiguous dates on multi-draw reports', async () => {
    response({
      visit_date: '2026-01-02',
      provider_name: null,
      multiple_collection_dates: true,
      results: [
        {
          test_name: 'Synthetic',
          value: 5,
          unit: 'mg',
          visit_date: '2026-01-02',
          specimen_id: 'one',
          source_page: 1,
        },
        {
          test_name: 'Synthetic',
          value: 7,
          unit: 'mg',
          visit_date: '2026-02-03',
          specimen_id: 'two',
          source_page: 2,
        },
        { test_name: 'Ambiguous marker', value: 8, unit: 'mg' },
      ],
    });
    const parsed = await parseLabPdf(Buffer.from('%PDF-1.4 synthetic'));
    const claims = labClaims(parsed);
    expect(claims.map((claim) => claim.payload.visit_date)).toEqual([
      '2026-01-02',
      '2026-02-03',
      null,
    ]);
    expect(claims[0].payload._visit_key).not.toBe(claims[1].payload._visit_key);
    expect(claims[1].payload.source_page).toBe(2);
    expect(parsed.warnings?.length).toBeGreaterThan(0);
  });
  it('detects conflicting row and report dates even when the extraction omitted its multi-date flag', async () => {
    response({
      visit_date: '2026-01-02',
      provider_name: null,
      results: [
        { test_name: 'Synthetic', value: 5, unit: 'mg', visit_date: '2026-02-03' },
        { test_name: 'Undated marker', value: 7, unit: 'mg' },
      ],
    });
    const parsed = await parseLabPdf(Buffer.from('%PDF-1.4 synthetic'));
    expect(parsed.multiple_collection_dates).toBe(true);
    expect(labClaims(parsed)[1].payload.visit_date).toBeNull();
  });
  it('sends PNG/JPEG as image blocks and PDF as a document', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'application/pdf']) {
      const bytes =
        mime === 'application/pdf'
          ? Buffer.from('%PDF-1.4 synthetic')
          : mime === 'image/png'
            ? Buffer.from([0x89, 0x50, 0x4e, 0x47])
            : Buffer.from([0xff, 0xd8, 0xff]);
      response({ visit_date: null, provider_name: null, results: [] });
      await parseLabPdf(bytes);
      const body = call.mock.calls.at(-1)![1];
      const block = body.messages[0].content as { type: string; source: { media_type: string } }[];
      expect(block[0].type).toBe(mime === 'application/pdf' ? 'document' : 'image');
      expect(block[0].source.media_type).toBe(mime);
    }
  });
  it('does not invent a day for standalone or history lab dates and retains specimen/page evidence', async () => {
    response({
      visit_date: '2026-02',
      provider_name: null,
      results: [
        {
          test_name: 'Synthetic',
          value: 5,
          unit: 'mg',
          source_page: 2,
          specimen_id: 'printed-one',
          loinc_code: '718-7',
        },
      ],
    });
    const lab = await parseLabPdf(Buffer.from('%PDF-1.4 synthetic'));
    expect(lab.visit_date).toBe('2026-02');
    expect(lab.results[0].source_page).toBe(2);
    expect(labClaims(lab)[0].payload.loinc_code).toBe('718-7');
    expect(String(call.mock.calls.at(-1)![1].system)).toContain('Never infer or look up a code');
    response({
      medications: [{ name: 'Synthetic medication', start_date: '2024', source_page: 1 }],
      lab_visits: [
        {
          visit_date: null,
          results: [
            {
              test_name: 'Synthetic',
              value: 5,
              unit: 'mg',
              specimen_id: 'printed-two',
              loinc_code: '789-8',
              source_page: 3,
            },
          ],
        },
      ],
    });
    const history = await parseMedicalHistory(Buffer.from([0xff, 0xd8, 0xff]), 'application/pdf');
    expect(history.medications[0].start_date).toBe('2024');
    expect(history.medications[0].source_page).toBe(1);
    expect(history.lab_visits[0].visit_date).toBeNull();
    expect(history.lab_visits[0].results[0].specimen_id).toBe('printed-two');
    expect(
      historyClaims(history).find((claim) => claim.domain === 'lab_results')?.payload.loinc_code
    ).toBe('789-8');
    const prompt = String(call.mock.calls.at(-1)![1].system);
    expect(prompt).toContain('Never invent a day or month');
    expect(prompt).not.toContain('use January 1st');
    expect(prompt).toContain('Never infer or look up a code');
  });
});
