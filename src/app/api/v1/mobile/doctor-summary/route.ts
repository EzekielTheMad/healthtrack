import { mobileDoctorBundle } from '@/lib/mobile/doctor';
import { mobileErrorResponse, PRIVATE_HEADERS } from '@/lib/mobile/devices';

export async function GET(request: Request) {
  try {
    const bundle = await mobileDoctorBundle(request);
    return Response.json(bundle, {
      headers: { ...PRIVATE_HEADERS, ETag: `"${bundle.fingerprint}"` },
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
