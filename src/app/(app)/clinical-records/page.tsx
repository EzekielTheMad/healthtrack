import { Suspense } from 'react';
import ClinicalIntakeWorkspace from '@/components/clinical-intake/ClinicalIntakeWorkspace';
export default function Page() {
  return (
    <Suspense fallback={<p>Loading clinical history…</p>}>
      <ClinicalIntakeWorkspace />
    </Suspense>
  );
}
