import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import { TIKTOK_STATE_COOKIE, encryptionKey, openState } from '../../../../lib/tiktok/oauth';
import { publicError } from '../../../../lib/tiktok/http';
import { saveAuthorization } from '../../../../lib/tiktok/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);
  const fail = (message: string) => {
    const response = NextResponse.redirect(`${base}/tiktok?tiktok=error&message=${encodeURIComponent(message.slice(0, 180))}`);
    response.cookies.set(TIKTOK_STATE_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  };

  const upstream = request.nextUrl.searchParams.get('error_description') || request.nextUrl.searchParams.get('error');
  if (upstream) return fail(upstream);

  try {
    const accountId = await getUserEmail();
    const payload = openState(
      request.nextUrl.searchParams.get('state') ?? '',
      encryptionKey().toString('base64url'),
      Math.floor(Date.now() / 1000),
    );
    const cookie = request.cookies.get(TIKTOK_STATE_COOKIE)?.value;
    if (!accountId || !payload || payload.accountId !== accountId || payload.nonce !== cookie) {
      return fail('TikTok returned to a different sign-in. Connect the advertiser again.');
    }
    const authCode = request.nextUrl.searchParams.get('auth_code') || request.nextUrl.searchParams.get('code');
    if (!authCode) return fail('TikTok did not include an authorization code. Connect the advertiser again.');
    const saved = await saveAuthorization(accountId, authCode);
    const response = NextResponse.redirect(`${base}/tiktok?tiktok=connected&advertisers=${saved.advertiserCount}`);
    response.cookies.set(TIKTOK_STATE_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return fail(publicError(error));
  }
}
