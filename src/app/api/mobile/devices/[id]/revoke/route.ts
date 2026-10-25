import { requireUser } from '@/lib/auth/session';
import {
  mobileErrorResponse,
  PRIVATE_HEADERS,
  requireMobileOrigin,
  revokeMobileDevice,
} from '@/lib/mobile/devices';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMobileOrigin(request);
    revokeMobileDevice((await requireUser()).id, (await params).id);
    return Response.json({ status: 'revoked' }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
