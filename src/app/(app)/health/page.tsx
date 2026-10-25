import Link from 'next/link';
const sections = [
  [
    'Records',
    [
      ['Medications', '/medications'],
      ['Conditions', '/conditions'],
      ['Allergies', '/allergies'],
      ['Vaccines', '/vaccines'],
      ['Procedures', '/procedures'],
    ],
  ],
  [
    'Measurements & results',
    [
      ['Vitals', '/vitals'],
      ['Body measurements', '/vitals?view=measurements'],
      ['Compare metrics', '/vitals?view=compare'],
      ['Lab results & trends', '/labs'],
    ],
  ],
  [
    'At your appointment',
    [
      ['Doctor Essentials', '/mobile/doctor'],
      ['Appointments', '/appointments'],
      ['Notes', '/notes'],
    ],
  ],
] as const;
export default function HealthPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Health</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Your records, measurements, and appointment essentials.
      </p>
      {sections.map(([heading, links]) => (
        <section key={heading} className="space-y-3">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {links.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="flex min-h-14 items-center justify-between rounded-xl border px-4 py-3 text-sm"
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-card)' }}
              >
                {label}
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
