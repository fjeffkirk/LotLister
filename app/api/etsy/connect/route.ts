import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import {
  ETSY_OAUTH_STATE_COOKIE,
  ETSY_OAUTH_VERIFIER_COOKIE,
  buildEtsyAuthorizeUrl,
  createPkcePair,
  getEtsyCredentials,
  missingEtsyEnvVars,
} from '../../../../lib/etsy';

export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);
  const userEmail = await getUserEmail();
  if (!userEmail) {
    return NextResponse.redirect(`${base}/settings?etsy=error&message=${encodeURIComponent('Sign in before connecting Etsy')}`);
  }
  const creds = getEtsyCredentials();
  if (!creds) {
    return NextResponse.redirect(
      `${base}/settings?etsy=error&message=${encodeURIComponent(`Add ${missingEtsyEnvVars().join(' and ')} on the server`)}`
    );
  }
  const state = randomBytes(24).toString('hex');
  const pkce = createPkcePair();
  const redirectUri = `${base}/api/etsy/callback`;
  const response = NextResponse.redirect(buildEtsyAuthorizeUrl(creds, redirectUri, state, pkce.challenge));
  const cookie = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  };
  response.cookies.set(ETSY_OAUTH_STATE_COOKIE, state, cookie);
  response.cookies.set(ETSY_OAUTH_VERIFIER_COOKIE, pkce.verifier, cookie);
  return response;
}
