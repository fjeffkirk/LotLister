import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { buildEbayAuthorizeUrl, EBAY_OAUTH_STATE_COOKIE, getEbayCredentials, getPublicBaseUrl } from '../../../../lib/ebay';

export async function GET(request: NextRequest) {
  const userEmail = await getUserEmail();
  const base = getPublicBaseUrl(request.nextUrl.origin);
  if (!userEmail) {
    return NextResponse.redirect(`${base}/settings?ebay=error&message=${encodeURIComponent('Set your email before connecting eBay')}`);
  }

  const creds = await getEbayCredentials();
  if (!creds) {
    return NextResponse.redirect(
      `${base}/settings?ebay=error&message=${encodeURIComponent('eBay is not configured on the server yet')}`
    );
  }

  const state = randomBytes(24).toString('hex');
  const response = NextResponse.redirect(buildEbayAuthorizeUrl(creds, state));
  response.cookies.set(EBAY_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return response;
}
