'use client';

import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';

const colors = {
  sage: '#81B29A',
  terracotta: '#E07A5F',
  bark: '#3D405B',
  cream: '#F4F1DE',
  warning: '#FBBF24',
  white: '#FFFFFF',
  lightGray: '#F0F0F0',
  gray: '#888888',
};

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: colors.bark,
    backgroundColor: colors.white,
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
  },
  // Header
  header: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottom: `2px solid ${colors.sage}`,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: colors.bark,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 11,
    color: colors.sage,
    marginBottom: 12,
  },
  headerMeta: {
    flexDirection: 'row',
    gap: 24,
  },
  headerMetaItem: {
    flexDirection: 'row',
    gap: 4,
  },
  headerMetaLabel: {
    fontSize: 9,
    color: colors.gray,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  headerMetaValue: {
    fontSize: 9,
    color: colors.bark,
  },
  // Section
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    backgroundColor: colors.sage,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 0,
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: colors.white,
  },
  // Table
  table: {
    border: `1px solid ${colors.lightGray}`,
    borderRadius: 4,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: colors.lightGray,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: colors.gray,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderTop: `1px solid ${colors.lightGray}`,
  },
  tableRowAlt: {
    backgroundColor: '#FAFAFA',
  },
  tableCell: {
    fontSize: 9,
    color: colors.bark,
  },
  // Flags / badges
  badge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  badgeNormal: {
    backgroundColor: '#D1FAE5',
    color: '#065F46',
  },
  badgeWarning: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
  },
  badgeDanger: {
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
  },
  // Empty state
  emptyText: {
    fontSize: 9,
    color: colors.gray,
    paddingVertical: 8,
    paddingHorizontal: 8,
    fontStyle: 'italic',
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: `1px solid ${colors.lightGray}`,
    paddingTop: 8,
  },
  footerText: {
    fontSize: 8,
    color: colors.gray,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function flagBadgeStyle(flag: string) {
  const f = flag?.toLowerCase();
  if (f === 'high' || f === 'critical' || f === 'low') return [styles.badge, styles.badgeDanger];
  if (f === 'moderate') return [styles.badge, styles.badgeWarning];
  return [styles.badge, styles.badgeNormal];
}

function severityBadgeStyle(severity: string) {
  const s = severity?.toLowerCase();
  if (s === 'severe' || s === 'life_threatening') return [styles.badge, styles.badgeDanger];
  if (s === 'moderate') return [styles.badge, styles.badgeWarning];
  return [styles.badge, styles.badgeNormal];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HealthSummaryPdfProps {
  profile: {
    display_name: string;
    date_of_birth?: string;
    biological_sex?: string;
    height_inches?: number;
    weight_lbs?: number;
  };
  sections: string[];
  medications?: Array<{ name: string; dosage?: string; frequency: string; active: boolean }>;
  conditions?: Array<{ name: string; status: string; diagnosed_date?: string }>;
  allergies?: Array<{ name: string; severity: string; reaction?: string }>;
  vitals?: Array<{ metric_key: string; value: number; unit?: string; recorded_at: string }>;
  labResults?: Array<{
    test_name: string;
    value: number;
    unit?: string;
    reference_range_low?: number;
    reference_range_high?: number;
    flag: string;
  }>;
  providers?: Array<{ name: string; provider_type: string; specialty?: string; phone?: string }>;
  vaccines?: Array<{ name: string; vaccine_date: string; dose_number?: number; series_doses?: number }>;
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.table}>{children}</View>
    </View>
  );
}

function MedicationsSection({ medications }: { medications: HealthSummaryPdfProps['medications'] }) {
  if (!medications?.length) {
    return (
      <SectionBlock title="Medications">
        <Text style={styles.emptyText}>No medications recorded.</Text>
      </SectionBlock>
    );
  }
  return (
    <SectionBlock title="Medications">
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Medication</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Dosage</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Frequency</Text>
        <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Status</Text>
      </View>
      {medications.map((med, i) => (
        <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
          <Text style={[styles.tableCell, { flex: 3 }]}>{med.name}</Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>{med.dosage ?? '—'}</Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>{med.frequency}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.badge, med.active ? styles.badgeNormal : styles.badgeWarning]}>
              {med.active ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
      ))}
    </SectionBlock>
  );
}

function ConditionsSection({ conditions }: { conditions: HealthSummaryPdfProps['conditions'] }) {
  if (!conditions?.length) {
    return (
      <SectionBlock title="Conditions">
        <Text style={styles.emptyText}>No conditions recorded.</Text>
      </SectionBlock>
    );
  }
  return (
    <SectionBlock title="Conditions">
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Condition</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Status</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Diagnosed</Text>
      </View>
      {conditions.map((c, i) => (
        <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
          <Text style={[styles.tableCell, { flex: 3 }]}>{c.name}</Text>
          <Text style={[styles.tableCell, { flex: 2, textTransform: 'capitalize' }]}>{c.status}</Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>{formatDate(c.diagnosed_date)}</Text>
        </View>
      ))}
    </SectionBlock>
  );
}

function AllergiesSection({ allergies }: { allergies: HealthSummaryPdfProps['allergies'] }) {
  if (!allergies?.length) {
    return (
      <SectionBlock title="Allergies">
        <Text style={styles.emptyText}>No allergies recorded.</Text>
      </SectionBlock>
    );
  }
  return (
    <SectionBlock title="Allergies">
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Allergen</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Severity</Text>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Reaction</Text>
      </View>
      {allergies.map((a, i) => (
        <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
          <Text style={[styles.tableCell, { flex: 3 }]}>{a.name}</Text>
          <View style={{ flex: 2 }}>
            <Text style={severityBadgeStyle(a.severity)}>
              {a.severity.replace('_', ' ')}
            </Text>
          </View>
          <Text style={[styles.tableCell, { flex: 3 }]}>{a.reaction ?? '—'}</Text>
        </View>
      ))}
    </SectionBlock>
  );
}

function VitalsSection({ vitals }: { vitals: HealthSummaryPdfProps['vitals'] }) {
  if (!vitals?.length) {
    return (
      <SectionBlock title="Vitals (Latest per metric)">
        <Text style={styles.emptyText}>No vitals recorded.</Text>
      </SectionBlock>
    );
  }
  return (
    <SectionBlock title="Vitals (Latest per metric)">
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Metric</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Value</Text>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Recorded</Text>
      </View>
      {vitals.map((v, i) => (
        <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
          <Text style={[styles.tableCell, { flex: 3 }]}>
            {v.metric_key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>
            {v.value} {v.unit ?? ''}
          </Text>
          <Text style={[styles.tableCell, { flex: 3 }]}>{formatDate(v.recorded_at)}</Text>
        </View>
      ))}
    </SectionBlock>
  );
}

function LabResultsSection({ labResults }: { labResults: HealthSummaryPdfProps['labResults'] }) {
  if (!labResults?.length) {
    return (
      <SectionBlock title="Lab Results (Latest per test)">
        <Text style={styles.emptyText}>No lab results recorded.</Text>
      </SectionBlock>
    );
  }
  return (
    <SectionBlock title="Lab Results (Latest per test)">
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Test</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Value</Text>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Reference Range</Text>
        <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Flag</Text>
      </View>
      {labResults.map((lab, i) => {
        const ref =
          lab.reference_range_low != null && lab.reference_range_high != null
            ? `${lab.reference_range_low}–${lab.reference_range_high}`
            : lab.reference_range_low != null
            ? `>${lab.reference_range_low}`
            : lab.reference_range_high != null
            ? `<${lab.reference_range_high}`
            : '—';
        return (
          <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
            <Text style={[styles.tableCell, { flex: 3 }]}>{lab.test_name}</Text>
            <Text style={[styles.tableCell, { flex: 2 }]}>
              {lab.value} {lab.unit ?? ''}
            </Text>
            <Text style={[styles.tableCell, { flex: 3 }]}>{ref}</Text>
            <View style={{ flex: 1.5 }}>
              <Text style={flagBadgeStyle(lab.flag ?? 'normal')}>
                {lab.flag ?? 'Normal'}
              </Text>
            </View>
          </View>
        );
      })}
    </SectionBlock>
  );
}

function ProvidersSection({ providers }: { providers: HealthSummaryPdfProps['providers'] }) {
  if (!providers?.length) {
    return (
      <SectionBlock title="Providers">
        <Text style={styles.emptyText}>No providers recorded.</Text>
      </SectionBlock>
    );
  }
  return (
    <SectionBlock title="Providers">
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Name</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Type</Text>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Specialty</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Phone</Text>
      </View>
      {providers.map((p, i) => (
        <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
          <Text style={[styles.tableCell, { flex: 3 }]}>{p.name}</Text>
          <Text style={[styles.tableCell, { flex: 2, textTransform: 'capitalize' }]}>
            {p.provider_type?.replace(/_/g, ' ') ?? '—'}
          </Text>
          <Text style={[styles.tableCell, { flex: 3 }]}>{p.specialty ?? '—'}</Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>{p.phone ?? '—'}</Text>
        </View>
      ))}
    </SectionBlock>
  );
}

function VaccinesSection({ vaccines }: { vaccines: HealthSummaryPdfProps['vaccines'] }) {
  if (!vaccines?.length) {
    return (
      <SectionBlock title="Vaccines">
        <Text style={styles.emptyText}>No vaccines recorded.</Text>
      </SectionBlock>
    );
  }
  return (
    <SectionBlock title="Vaccines">
      <View style={styles.tableHeader}>
        <Text style={[styles.tableHeaderCell, { flex: 3 }]}>Vaccine</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Date</Text>
        <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Dose</Text>
      </View>
      {vaccines.map((v, i) => (
        <View key={i} style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}>
          <Text style={[styles.tableCell, { flex: 3 }]}>{v.name}</Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>{formatDate(v.vaccine_date)}</Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>
            {v.dose_number != null && v.series_doses != null
              ? `${v.dose_number} of ${v.series_doses}`
              : v.dose_number != null
              ? `Dose ${v.dose_number}`
              : '—'}
          </Text>
        </View>
      ))}
    </SectionBlock>
  );
}

// ---------------------------------------------------------------------------
// Main document component
// ---------------------------------------------------------------------------

export default function HealthSummaryPdf({
  profile,
  sections,
  medications,
  conditions,
  allergies,
  vitals,
  labResults,
  providers,
  vaccines,
}: HealthSummaryPdfProps) {
  const generatedDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const has = (s: string) => sections.includes(s);

  return (
    <Document
      title="HealthTrack Health Summary"
      author={profile.display_name}
      subject="Health Summary"
    >
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>HealthTrack</Text>
          <Text style={styles.headerSubtitle}>Health Summary</Text>
          <View style={styles.headerMeta}>
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Patient: </Text>
              <Text style={styles.headerMetaValue}>{profile.display_name || 'Unknown'}</Text>
            </View>
            {profile.date_of_birth && (
              <View style={styles.headerMetaItem}>
                <Text style={styles.headerMetaLabel}>DOB: </Text>
                <Text style={styles.headerMetaValue}>{formatDate(profile.date_of_birth)}</Text>
              </View>
            )}
            {profile.biological_sex && (
              <View style={styles.headerMetaItem}>
                <Text style={styles.headerMetaLabel}>Sex: </Text>
                <Text style={[styles.headerMetaValue, { textTransform: 'capitalize' }]}>
                  {profile.biological_sex}
                </Text>
              </View>
            )}
            <View style={styles.headerMetaItem}>
              <Text style={styles.headerMetaLabel}>Generated: </Text>
              <Text style={styles.headerMetaValue}>{generatedDate}</Text>
            </View>
          </View>
        </View>

        {/* Sections */}
        {has('medications') && <MedicationsSection medications={medications} />}
        {has('conditions') && <ConditionsSection conditions={conditions} />}
        {has('allergies') && <AllergiesSection allergies={allergies} />}
        {has('vitals') && <VitalsSection vitals={vitals} />}
        {has('labs') && <LabResultsSection labResults={labResults} />}
        {has('providers') && <ProvidersSection providers={providers} />}
        {has('vaccines') && <VaccinesSection vaccines={vaccines} />}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            HealthTrack — Confidential Health Summary — {generatedDate}
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
