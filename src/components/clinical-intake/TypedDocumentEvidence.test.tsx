import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { api, profile } = vi.hoisted(() => ({
  api: vi.fn(),
  profile: { dependentId: null as string | null },
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: api }));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => profile }));
import TypedDocumentEvidence from './TypedDocumentEvidence';
const evidence = {
  id: 'source',
  dependent_id: null,
  file_name: 'Fictional.pdf',
  status: 'incomplete',
  original_href: '/api/files/protected.pdf',
  clinical_batch_id: 'typed-review',
  warnings: ['One held row'],
  coverage: 'Limited extracted evidence; original retained',
  total_retained: 2,
  held: [
    {
      source_item_id: 'source-row',
      item_key: 'result-2',
      source_row: {
        test_name: 'Fictional held',
        raw_result: 'qualitative original',
        novel_field: 'not discarded',
      },
      issues: ['Unsupported extracted field'],
    },
  ],
};
beforeEach(() => {
  api.mockReset();
  profile.dependentId = null;
  api.mockResolvedValue(evidence);
});
it('shows held raw evidence and saved review links and seeds explicit structured resolution without accepting data', async () => {
  const resolve = vi.fn();
  render(<TypedDocumentEvidence id="source" onResolve={resolve} />);
  await screen.findByText('Source evidence · Fictional.pdf');
  expect(screen.getByRole('link', { name: 'Open saved typed batch and outcomes' })).toHaveAttribute(
    'href',
    '/clinical-intake?document_id=source&batch_id=typed-review'
  );
  expect(screen.getByText(/not discarded/)).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: 'Resolve this held row in structured entry' })
  );
  expect(resolve.mock.calls[0][0]).toMatchObject({
    test_name: 'Fictional held',
    outcome: { kind: 'text', text: '' },
    raw_result: 'qualitative original',
    collection_date: { precision: 'unknown', value: null },
    provenance: {
      sources: [
        { document_id: 'source', reference: 'Fictional.pdf · clinical-source-item:source-row' },
      ],
    },
  });
  expect(api).toHaveBeenCalledTimes(1);
});
it('hides source details when the selected person differs', async () => {
  profile.dependentId = 'child';
  render(<TypedDocumentEvidence id="source" onResolve={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('different selected person');
  expect(screen.queryByText(/not discarded/)).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
