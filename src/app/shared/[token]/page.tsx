'use client';

import { use, useEffect, useState } from 'react';
import type {
  Medication,
  LabResult,
  Vital,
  Condition,
  Allergy,
  Procedure,
  Vaccine,
  Provider,
  Appointment,
  Note,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const c = {
  bg: 'var(--bg-primary)',
  card: 'var(--bg-card)',
  border: 'var(--border-card)',
  text: 'var(--color-text-primary)',
  muted: 'var(--color-text-muted)',
  sage: 'var(--color-sage)',
  terra: 'var(--color-terracotta)',
  warn: 'var(--color-warning)',
  purple: 'var(--accent-purple)',
};

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------
interface ShareMeta {
  id: string;
  owner_id: string;
  owner_name: string;
  access_level: 'read' | 'read_write';
  shared_sections: string[];
  expires_at: string | null;
  created_at: string;
}

interface PublicShareResponse {
  share: ShareMeta;
  data: {
    medications?: Medication[];
    conditions?: Condition[];
    vitals?: Vital[];
    labs?: LabResult[];
    allergies?: Allergy[];
    procedures?: Procedure[];
    vaccines?: Vaccine[];
    providers?: Provider[];
    appointments?: Appointment[];
    notes?: Note[];
  };
}

// ---------------------------------------------------------------------------
// Reusable section wrapper
// ---------------------------------------------------------------------------
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ backgroundColor: c.card, borderColor: c.border }}
    >
      <h3
        className="text-xs font-semibold uppercase tracking-widest mb-4"
        style={{ color: c.muted }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Divider() {
  return <hr style={{ borderColor: c.border }} className="my-1" />;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------
function MedicationsView({ items }: { items: Medication[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No active medications on record.</p>;
  }
  return (
    <SectionCard title="Medications">
      <div className="space-y-3">
        {items.map((med) => (
          <div key={med.id} className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium" style={{ color: c.text }}>{med.name}</p>
              <p className="text-xs" style={{ color: c.muted }}>
                {[med.dosage, med.frequency?.replace(/_/g, ' ')].filter(Boolean).join(' — ')}
              </p>
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(129,178,154,0.15)', color: c.sage }}
            >
              Active
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ConditionsView({ items }: { items: Condition[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No conditions on record.</p>;
  }
  const statusColor = (s: string) => {
    if (s === 'active') return c.terra;
    if (s === 'managed') return c.sage;
    if (s === 'monitoring') return c.warn;
    return c.muted;
  };
  return (
    <SectionCard title="Conditions">
      <div className="space-y-3">
        {items.map((cond) => (
          <div key={cond.id} className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium" style={{ color: c.text }}>{cond.name}</p>
              {cond.diagnosed_date && (
                <p className="text-xs" style={{ color: c.muted }}>
                  Diagnosed: {new Date(cond.diagnosed_date).toLocaleDateString()}
                </p>
              )}
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full capitalize"
              style={{ backgroundColor: `${statusColor(cond.status)}22`, color: statusColor(cond.status) }}
            >
              {cond.status}
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function VitalsView({ items }: { items: Vital[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No vitals on record.</p>;
  }
  return (
    <SectionCard title="Recent Vitals">
      <div className="space-y-1">
        {items.map((v, i) => (
          <div key={v.id}>
            <div className="flex justify-between items-center py-2">
              <div>
                <p className="text-sm" style={{ color: c.text }}>
                  {v.metric_key.replace(/_/g, ' ')}
                </p>
                <p className="text-xs" style={{ color: c.muted }}>
                  {new Date(v.recorded_at).toLocaleDateString()}
                </p>
              </div>
              <span className="text-sm font-medium" style={{ color: c.sage }}>
                {v.value} {v.unit}
              </span>
            </div>
            {i < items.length - 1 && <Divider />}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function LabsView({ items }: { items: LabResult[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No lab results on record.</p>;
  }
  const flagColor = (flag: string | null) => {
    if (flag === 'high' || flag === 'critical') return c.terra;
    if (flag === 'low') return c.warn;
    return c.sage;
  };
  return (
    <SectionCard title="Lab Results">
      <div className="space-y-1">
        {items.map((r, i) => (
          <div key={r.id}>
            <div className="flex justify-between items-center py-2">
              <div>
                <p className="text-sm" style={{ color: c.text }}>{r.test_name}</p>
                {r.panel_name && (
                  <p className="text-xs" style={{ color: c.muted }}>{r.panel_name}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-medium" style={{ color: flagColor(r.flag) }}>
                  {r.value} {r.unit}
                </p>
                {r.reference_range_low != null && r.reference_range_high != null && (
                  <p className="text-xs" style={{ color: c.muted }}>
                    Ref: {r.reference_range_low}–{r.reference_range_high}
                  </p>
                )}
              </div>
            </div>
            {i < items.length - 1 && <Divider />}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function AllergiesView({ items }: { items: Allergy[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No allergies on record.</p>;
  }
  const sevColor = (s: string) => {
    if (s === 'life_threatening' || s === 'severe') return c.terra;
    if (s === 'moderate') return c.warn;
    return c.sage;
  };
  return (
    <SectionCard title="Allergies">
      <div className="space-y-3">
        {items.map((a) => (
          <div key={a.id} className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium" style={{ color: c.text }}>{a.name}</p>
              {a.reaction && (
                <p className="text-xs" style={{ color: c.muted }}>Reaction: {a.reaction}</p>
              )}
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full capitalize"
              style={{ backgroundColor: `${sevColor(a.severity)}22`, color: sevColor(a.severity) }}
            >
              {a.severity.replace(/_/g, ' ')}
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ProceduresView({ items }: { items: Procedure[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No procedures on record.</p>;
  }
  return (
    <SectionCard title="Procedures">
      <div className="space-y-3">
        {items.map((p) => (
          <div key={p.id} className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium" style={{ color: c.text }}>{p.name}</p>
              {p.cpt_code && (
                <p className="text-xs" style={{ color: c.muted }}>CPT: {p.cpt_code}</p>
              )}
            </div>
            <p className="text-xs" style={{ color: c.muted }}>
              {new Date(p.procedure_date).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function VaccinesView({ items }: { items: Vaccine[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No vaccines on record.</p>;
  }
  return (
    <SectionCard title="Vaccines">
      <div className="space-y-3">
        {items.map((v) => (
          <div key={v.id} className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium" style={{ color: c.text }}>{v.name}</p>
              {v.dose_number != null && v.series_doses != null && (
                <p className="text-xs" style={{ color: c.muted }}>
                  Dose {v.dose_number} of {v.series_doses}
                </p>
              )}
            </div>
            <p className="text-xs" style={{ color: c.muted }}>
              {new Date(v.vaccine_date).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ProvidersView({ items }: { items: Provider[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No providers on record.</p>;
  }
  return (
    <SectionCard title="Care Providers">
      <div className="space-y-3">
        {items.map((p) => (
          <div key={p.id}>
            <p className="text-sm font-medium" style={{ color: c.text }}>{p.name}</p>
            <p className="text-xs" style={{ color: c.muted }}>
              {[p.specialty, p.organization].filter(Boolean).join(' — ')}
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function AppointmentsView({ items }: { items: Appointment[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No appointments on record.</p>;
  }
  return (
    <SectionCard title="Appointments">
      <div className="space-y-3">
        {items.map((a) => (
          <div key={a.id} className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium" style={{ color: c.text }}>
                {a.reason ?? 'Appointment'}
              </p>
              {a.notes && (
                <p className="text-xs" style={{ color: c.muted }}>{a.notes}</p>
              )}
            </div>
            <p className="text-xs" style={{ color: c.muted }}>
              {new Date(a.appointment_date).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function NotesView({ items }: { items: Note[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: c.muted }}>No notes on record.</p>;
  }
  return (
    <SectionCard title="Notes">
      <div className="space-y-3">
        {items.map((n) => (
          <div key={n.id}>
            <div className="flex justify-between items-start mb-1">
              <span
                className="text-xs px-2 py-0.5 rounded-full capitalize"
                style={{ backgroundColor: 'rgba(129,178,154,0.15)', color: c.sage }}
              >
                {n.note_type}
              </span>
              <p className="text-xs" style={{ color: c.muted }}>
                {new Date(n.recorded_at).toLocaleDateString()}
              </p>
            </div>
            <p className="text-sm" style={{ color: c.text }}>{n.content}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Error card
// ---------------------------------------------------------------------------
function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: c.bg }}>
      <div
        className="w-full max-w-md rounded-2xl border p-8 text-center"
        style={{ backgroundColor: c.card, borderColor: c.border }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke={c.terra}
          strokeWidth="1.5"
          className="mx-auto mb-4"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h2 className="text-lg font-semibold mb-2" style={{ color: c.text, fontFamily: 'var(--font-display)' }}>
          {title}
        </h2>
        <p className="text-sm" style={{ color: c.muted }}>{message}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function LoadingState() {
  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: c.bg }}>
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-32 rounded-2xl" style={{ backgroundColor: c.border }} />
        <div className="h-48 rounded-2xl" style={{ backgroundColor: c.border }} />
        <div className="h-48 rounded-2xl" style={{ backgroundColor: c.border }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function PublicSharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [loading, setLoading] = useState(true);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<PublicShareResponse | null>(null);

  useEffect(() => {
    if (!token) return;

    fetch(`/api/share/public?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          if (res.status === 404) {
            setErrorTitle('Share Not Found');
            setErrorMsg('This share link is invalid or has been removed.');
          } else if (res.status === 410) {
            setErrorTitle('Share Expired');
            setErrorMsg('This share link has expired and is no longer accessible.');
          } else if (res.status === 403) {
            setErrorTitle('Not Available');
            setErrorMsg('This share has not been accepted yet. The recipient needs to accept it first.');
          } else {
            setErrorTitle('Unable to Load');
            setErrorMsg(json?.message ?? 'Something went wrong loading this share.');
          }
        } else {
          setPayload(json as PublicShareResponse);
        }
      })
      .catch(() => {
        setErrorTitle('Connection Error');
        setErrorMsg('Could not reach the server. Please check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <LoadingState />;

  if (errorTitle || !payload) {
    return <ErrorCard title={errorTitle ?? 'Error'} message={errorMsg ?? 'Unknown error'} />;
  }

  const { share, data } = payload;
  const sections = share.shared_sections;
  const isExpired = share.expires_at ? new Date(share.expires_at) < new Date() : false;

  return (
    <div className="min-h-screen py-8 px-4" style={{ backgroundColor: c.bg }}>
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Branding strip */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-semibold" style={{ color: c.terra, fontFamily: 'var(--font-display)' }}>
            HealthTrack
          </span>
          <span className="text-xs" style={{ color: c.muted }}>— Shared Health Record</span>
        </div>

        {/* Header card */}
        <div
          className="rounded-2xl border p-6"
          style={{ backgroundColor: c.card, borderColor: c.border }}
        >
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: c.muted }}>
            Health data shared by
          </p>
          <h1
            className="text-2xl font-bold mb-3"
            style={{ color: c.text, fontFamily: 'var(--font-display)' }}
          >
            {share.owner_name}
          </h1>

          <div className="flex flex-wrap gap-2">
            {/* Access level badge */}
            <span
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{
                backgroundColor: share.access_level === 'read_write'
                  ? 'rgba(167,139,250,0.15)'
                  : 'rgba(129,178,154,0.15)',
                color: share.access_level === 'read_write' ? c.purple : c.sage,
              }}
            >
              {share.access_level === 'read_write' ? 'Read & Write' : 'Read Only'}
            </span>

            {/* Expiration badge */}
            {share.expires_at && (
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{
                  backgroundColor: isExpired ? 'rgba(248,113,113,0.12)' : 'rgba(233,196,106,0.15)',
                  color: isExpired ? c.terra : c.warn,
                }}
              >
                {isExpired
                  ? 'Expired ' + new Date(share.expires_at).toLocaleDateString()
                  : 'Expires ' + new Date(share.expires_at).toLocaleDateString()}
              </span>
            )}

            {/* Sections count */}
            <span
              className="text-xs px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'rgba(129,178,154,0.1)', color: c.muted }}
            >
              {sections.length} section{sections.length !== 1 ? 's' : ''} shared
            </span>
          </div>
        </div>

        {/* Data sections */}
        {sections.includes('medications') && data.medications && (
          <MedicationsView items={data.medications} />
        )}
        {sections.includes('conditions') && data.conditions && (
          <ConditionsView items={data.conditions} />
        )}
        {sections.includes('vitals') && data.vitals && (
          <VitalsView items={data.vitals} />
        )}
        {sections.includes('labs') && data.labs && (
          <LabsView items={data.labs} />
        )}
        {sections.includes('allergies') && data.allergies && (
          <AllergiesView items={data.allergies} />
        )}
        {sections.includes('procedures') && data.procedures && (
          <ProceduresView items={data.procedures} />
        )}
        {sections.includes('vaccines') && data.vaccines && (
          <VaccinesView items={data.vaccines} />
        )}
        {sections.includes('providers') && data.providers && (
          <ProvidersView items={data.providers} />
        )}
        {sections.includes('appointments') && data.appointments && (
          <AppointmentsView items={data.appointments} />
        )}
        {sections.includes('notes') && data.notes && (
          <NotesView items={data.notes} />
        )}

        {/* Footer */}
        <p className="text-center text-xs pb-4" style={{ color: c.muted }}>
          This health record was shared via HealthTrack. Data is read-only and may not reflect real-time changes.
        </p>
      </div>
    </div>
  );
}
