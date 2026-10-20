import { NextRequest } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import { tiktokError, tiktokJson } from '../../../../lib/tiktok/http';
import { settingsView } from '../../../../lib/tiktok/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const accountId = await getUserEmail();
  if (!accountId) return tiktokErrorObject();
  try {
    return tiktokJson(await settingsView(accountId, getPublicBaseUrl(request.nextUrl.origin)));
  } catch (error) {
    return tiktokError(error);
  }
}

function tiktokErrorObject() {
  return new Response(JSON.stringify({ success: false, error: 'Not signed in' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
