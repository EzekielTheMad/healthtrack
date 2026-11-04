import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ConditionCard from '@/components/conditions/ConditionCard';
import AllergyCard from '@/components/allergies/AllergyCard';
import ProcedureCard from '@/components/procedures/ProcedureCard';
import VaccineCard from '@/components/vaccines/VaccineCard';

afterEach(cleanup);
const base = {
  id: 'synthetic-record',
  user_id: 'synthetic-owner',
  name: 'Synthetic record',
  notes: null,
  created_at: '2026-01-01T12:00:00Z',
  updated_at: '2026-01-01T12:00:00Z',
};
const actions = { onUpdate: vi.fn(), onDelete: vi.fn() };

describe('clinical date-only cards', () => {
  it.each([
    [
      'condition',
      <ConditionCard
        key="condition"
        condition={{
          ...base,
          status: 'active',
          diagnosed_date: '2026-01-01',
          provider_id: null,
          icd10_code: null,
        }}
        onUpdate={actions.onUpdate}
      />,
    ],
    [
      'allergy',
      <AllergyCard
        key="allergy"
        allergy={{
          ...base,
          severity: 'mild',
          reaction: null,
          diagnosed_date: '2026-01-01',
          rxcui: null,
        }}
        {...actions}
      />,
    ],
    [
      'procedure',
      <ProcedureCard
        key="procedure"
        procedure={{ ...base, procedure_date: '2026-01-01', provider_id: null, cpt_code: null }}
        {...actions}
      />,
    ],
    [
      'vaccine',
      <VaccineCard
        key="vaccine"
        vaccine={{
          ...base,
          vaccine_date: '2026-01-01',
          dose_number: null,
          series_doses: null,
          manufacturer: null,
          lot_number: null,
          provider_id: null,
          cvx_code: null,
        }}
        {...actions}
      />,
    ],
  ])('shows the printed calendar day for a %s', (_name, card) => {
    render(card);
    expect(screen.getByText(/Jan 1, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Dec 31, 2025/)).not.toBeInTheDocument();
  });
});
