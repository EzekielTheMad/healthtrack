import { renderToBuffer } from '@react-pdf/renderer';
import HealthSummaryPdf from '@/components/export/HealthSummaryPdf';
import { mobileDoctorBundle } from '@/lib/mobile/doctor';
import {
  MobileDeviceError,
  mobileErrorResponse,
  PRIVATE_HEADERS,
  requireMobileDevice,
} from '@/lib/mobile/devices';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const bundle = await mobileDoctorBundle(request);
    if (new URL(request.url).searchParams.get('fingerprint') !== bundle.fingerprint)
      throw new MobileDeviceError(
        409,
        'summary_changed',
        'Refresh the summary before downloading its PDF.'
      );
    const pdf = await renderToBuffer(HealthSummaryPdf(bundle.summary));
    const current = await requireMobileDevice(request, 'read:doctor_summary');
    if (
      current.grantRevision !== bundle.grant_revision ||
      !current.allowedSubjects.includes(bundle.subject.id)
    )
      throw new MobileDeviceError(409, 'grant_changed');
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="doctor-essentials.pdf"',
        ETag: `"${bundle.fingerprint}"`,
      },
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
