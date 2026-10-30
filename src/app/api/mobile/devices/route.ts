import { requireUser } from '@/lib/auth/session';
import { listMobileDevices, mobileErrorResponse, PRIVATE_HEADERS } from '@/lib/mobile/devices';

export async function GET() {
  try {
    return Response.json(listMobileDevices((await requireUser()).id), { headers: PRIVATE_HEADERS });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
