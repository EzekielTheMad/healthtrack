import {
  redeemMobilePairing,
  mobileErrorResponse,
  mobileJson,
  PRIVATE_HEADERS,
} from '@/lib/mobile/devices';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = redeemMobilePairing((await params).id, await mobileJson(request));
    return Response.json(result, {
      status: 'status' in result ? 202 : 200,
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
