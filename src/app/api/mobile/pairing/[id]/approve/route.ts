import { requireUser } from '@/lib/auth/session';
import {
  approveMobilePairing,
  mobileErrorResponse,
  mobileJson,
  PRIVATE_HEADERS,
  requireMobileOrigin,
} from '@/lib/mobile/devices';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMobileOrigin(request);
    const user = await requireUser();
    approveMobilePairing((await params).id, user.id, await mobileJson(request));
    return Response.json({ status: 'approved' }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
