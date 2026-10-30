import { requireUser } from '@/lib/auth/session';
import { getMobilePairing, mobileErrorResponse, PRIVATE_HEADERS } from '@/lib/mobile/devices';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(getMobilePairing((await params).id, await requireUser()), {
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
