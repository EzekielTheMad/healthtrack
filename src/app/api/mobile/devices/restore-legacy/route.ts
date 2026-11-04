import { requireUser } from '@/lib/auth/session';
import {
  mobileErrorResponse,
  PRIVATE_HEADERS,
  requireMobileOrigin,
  restoreLegacyDelivery,
} from '@/lib/mobile/devices';

export async function POST(request: Request) {
  try {
    requireMobileOrigin(request);
    restoreLegacyDelivery((await requireUser()).id);
    return Response.json({ status: 'legacy_restored' }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
