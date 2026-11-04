'use client';
import { useActiveProfile } from '@/components/shared/ActiveProfileProvider';
import PdfExportSection from '@/components/export/PdfExportSection';
export default function DoctorSummaryPage() {
  const { dependentName, delegateOwnerId } = useActiveProfile();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Doctor summary</h1>
      <p>
        Prepare a dated summary for {dependentName ?? 'your appointment'}. It includes medication
        history and latest lab draws. Download it before you leave.
      </p>
      {delegateOwnerId ? (
        <p>Switch to your own record or a dependent to generate a summary.</p>
      ) : (
        <PdfExportSection />
      )}
    </div>
  );
}
