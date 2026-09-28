import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { buildEbayAuthorizeUrl, EBAY_OAUTH_STATE_COOKIE, getEbayCredentials, getPublicBaseUrl } from '../../../../lib/ebay';

// GET /api/ebay/connect - Start "Sign in with eBay"
export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);

  const creds = await getEbayCredentials();
  if (!creds) {
    return NextResponse.redirect(
      `${base}/lots?signin=error&message=${encodeURIComponent('eBay is not configured on the server yet')}`
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
