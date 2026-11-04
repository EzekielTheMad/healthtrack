import {
  createMobilePairing,
  mobileErrorResponse,
  mobileJson,
  PRIVATE_HEADERS,
} from '@/lib/mobile/devices';

export async function POST(request: Request) {
  try {
    return Response.json(createMobilePairing(await mobileJson(request), request), {
      status: 201,
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
