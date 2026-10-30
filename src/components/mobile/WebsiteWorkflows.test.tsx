// @vitest-environment-options {"url":"https://synthetic.invalid"}
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import LabsPage from '@/app/(app)/labs/page';
import SettingsPage from '@/app/(app)/settings/page';
import DoctorEssentialsPage from '@/app/(app)/mobile/doctor/page';
import DeviceManager from './DeviceManager';
import { AndroidModeProvider } from './AndroidMode';

const state = vi.hoisted(() => ({
  dependentId: null as string | null,
  dependentName: null as string | null,
  delegateOwnerId: null as string | null,
  ai: true,
}));
vi.mock('@/components/shared/ActiveProfileProvider', () => ({ useActiveProfile: () => state }));
vi.mock('@/lib/auth/client', () => ({
  useSession: () => ({ data: { user: { id: 'owner', role: 'admin' } }, isPending: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { ai: state.ai } }),
}));
vi.mock('@/hooks/useLabResults', () => ({
  useLabResults: () => ({
    labVisits: [],
    loading: false,
    error: null,
    saveLabVisit: vi.fn(),
    updateLabVisit: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock('@/components/labs/LabImport', () => ({
  default: () => (
    <section aria-label="Lab upload">
      <label>
        Choose report
        <input type="file" />
      </label>
    </section>
  ),
}));
vi.mock('@/components/labs/LabValidationReview', () => ({
  default: () => <p>Review lab extraction</p>,
}));
vi.mock('@/components/labs/VisitCard', () => ({ default: () => <p>Lab visit</p> }));
vi.mock('@/components/labs/TrendCard', () => ({ default: () => <p>Lab trend</p> }));
vi.mock('@/components/settings/SettingsGroups', () => ({
  default: ({ panels }: { panels: Record<string, ReactNode> }) =>
    panels[new URLSearchParams(window.location.search).get('tab') ?? 'advanced'],
}));
vi.mock('@/components/settings/ProfileForm', () => ({ ProfileForm: () => <p>Profile form</p> }));
vi.mock('@/components/settings/ProviderManagement', () => ({
  ProviderManagement: () => <p>Provider management</p>,
}));
vi.mock('@/components/settings/DataExportSection', () => ({
  default: () => <button>Export health data</button>,
}));
vi.mock('@/components/export/PdfExportSection', () => ({
  default: () => <button>Download Health Summary (PDF)</button>,
}));
vi.mock('@/components/settings/HealthShareManager', () => ({
  default: () => <p>Health sharing controls</p>,
}));
vi.mock('@/components/settings/DependentManager', () => ({
  default: () => <p>Dependent management</p>,
}));
vi.mock('@/components/settings/MedicalHistoryImport', () => ({
  default: () => <button>Import medical history</button>,
}));
vi.mock('@/components/settings/DelegateManager', () => ({
  default: () => <p>Delegate controls</p>,
}));
vi.mock('@/components/settings/InviteManager', () => ({ default: () => <p>Invite controls</p> }));
vi.mock('@/components/settings/IntegrationOverview', () => ({
  default: () => <p>Integration overview</p>,
}));
vi.mock('@/components/settings/BuildIdentity', () => ({ default: () => <p>Build identity</p> }));

beforeEach(() => {
  state.dependentId = null;
  state.dependentName = null;
  state.delegateOwnerId = null;
  state.ai = true;
  sessionStorage.clear();
  window.history.replaceState(null, '', '/dashboard?app=android');
});
afterEach(() => vi.unstubAllGlobals());

function android(children: ReactNode) {
  return render(<AndroidModeProvider>{children}</AndroidModeProvider>);
}

describe('ordinary website workflows in Android', () => {
  it('lets an Android user open and cancel the same lab upload flow, including the empty-state action', () => {
    android(<LabsPage />);
    const uploads = screen.getAllByRole('button', { name: 'Upload Lab PDF' });
    expect(uploads).toHaveLength(2);
    fireEvent.click(uploads[1]);
    expect(screen.getByRole('region', { name: 'Lab upload' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose report')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(screen.getByText('No lab results yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /in browser/i })).not.toBeInTheDocument();
  });

  it('retains existing capability and delegated-write restrictions for uploads', () => {
    state.delegateOwnerId = 'another-owner';
    const page = android(<LabsPage />);
    expect(screen.queryByRole('button', { name: 'Upload Lab PDF' })).not.toBeInTheDocument();
    page.unmount();
    state.delegateOwnerId = null;
    state.ai = false;
    android(<LabsPage />);
    expect(screen.queryByRole('button', { name: 'Upload Lab PDF' })).not.toBeInTheDocument();
  });

  it('renders normal API access in place without a second browsing context', async () => {
    window.history.replaceState(null, '', '/settings?tab=advanced&app=android');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    android(<SettingsPage />);
    fireEvent.click(screen.getByText('API access'));
    expect(await screen.findByRole('button', { name: '+ Generate New Key' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /in browser/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Continue in your browser/)).not.toBeInTheDocument();
  });

  it('keeps import and export controls available on the ordinary Data & reports page', () => {
    window.history.replaceState(null, '', '/settings?tab=data&app=android');
    android(<SettingsPage />);
    fireEvent.click(screen.getByText('Import Medical History'));
    fireEvent.click(screen.getByText('Data Export'));
    expect(screen.getByRole('button', { name: 'Import medical history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export health data' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /in browser/i })).not.toBeInTheDocument();
  });

  it('keeps online summaries independent of optional native offline setup', () => {
    state.dependentId = 'child';
    state.dependentName = 'Synthetic child';
    android(<DoctorEssentialsPage />);
    expect(
      screen.getByRole('button', { name: 'Download Health Summary (PDF)' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/online summary above is available without phone setup/)
    ).toBeInTheDocument();
    const intent = new URL(
      screen.getByRole('link', { name: 'Open saved Doctor Essentials' }).getAttribute('href')!
    );
    const returning = new URL(intent.searchParams.get('return_to')!, window.location.origin);
    expect(returning.pathname).toBe('/mobile/doctor');
    expect(returning.searchParams.get('dependent_id')).toBe('child');
    expect(intent.searchParams.get('return_origin')).toBe(window.location.origin);
  });

  it('provides an explicit setup entry without pairing merely by opening Phone & sync', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ devices: [], legacy_delivery_active: true }),
    });
    vi.stubGlobal('fetch', fetcher);
    android(<DeviceManager />);
    expect(
      await screen.findByText(/You can keep using your records without pairing/)
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up or manage phone sync' })).toHaveAttribute(
      'href',
      expect.stringContaining('intent://sync?')
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/mobile/devices');
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('method', 'POST');
  });
});
