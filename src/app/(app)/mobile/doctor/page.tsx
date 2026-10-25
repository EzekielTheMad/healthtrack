'use client';
import PdfExportSection from '@/components/export/PdfExportSection';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import { nativeActionHref, useAndroidMode } from '@/components/mobile/AndroidMode';
export default function DoctorEssentialsPage() {
  const android = useAndroidMode();
  const { dependentName, delegateOwnerId } = useActiveProfile();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Doctor Essentials</h1>
      <p>
        Medication history, conditions, allergies, recent results, and provider contacts for{' '}
        {dependentName ?? 'your record'}.
      </p>
      {delegateOwnerId ? (
        <p role="alert">
          Doctor summaries are available for your account and your dependents. Switch person to
          continue.
        </p>
      ) : (
        <>
          <PdfExportSection />
          {android && (
            <section
              className="rounded-xl border p-4 space-y-3"
              style={{ borderColor: 'var(--border-card)' }}
            >
              <h2 className="font-semibold">Saved on this phone</h2>
              <p className="text-sm">
                Open the Android app’s Doctor Essentials screen to choose a person, refresh an
                encrypted offline copy, or share a saved PDF. Phone access requires device
                authentication.
              </p>
              <a
                href={nativeActionHref('doctor')}
                className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm"
                style={{ borderColor: 'var(--border-card)' }}
              >
                Open saved Doctor Essentials
              </a>
            </section>
          )}
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            PDFs reflect the selected person when generated. Saved phone copies show capture and
            observation dates; browser records require a connection.
          </p>
        </>
      )}
    </div>
  );
}
