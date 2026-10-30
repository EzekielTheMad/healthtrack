import {
  requireMobileDevice,
  revokeMobileDevice,
  mobileErrorResponse,
  PRIVATE_HEADERS,
} from '@/lib/mobile/devices';

export async function POST(request: Request) {
  try {
    const device = await requireMobileDevice(request);
    revokeMobileDevice(device.userId, device.id);
    return Response.json({ status: 'revoked' }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
