import {
  requireMobileDevice,
  mobileState,
  mobileErrorResponse,
  PRIVATE_HEADERS,
} from '@/lib/mobile/devices';

export async function GET(request: Request) {
  try {
    return Response.json(mobileState(await requireMobileDevice(request)), {
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
