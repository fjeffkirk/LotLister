import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import {
  ETSY_OAUTH_STATE_COOKIE,
  ETSY_OAUTH_VERIFIER_COOKIE,
  exchangeEtsyCode,
  getEtsyCredentials,
  saveEtsyConnection,
} from '../../../../lib/etsy';

export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);
  const fail = (message: string) =>
    NextResponse.redirect(`${base}/settings?etsy=error&message=${encodeURIComponent(message)}`);

  const userEmail = await getUserEmail();
  if (!userEmail) return fail('Sign in before connecting Etsy');

  const etsyError = request.nextUrl.searchParams.get('error_description') || request.nextUrl.searchParams.get('error');
  if (etsyError) return fail(etsyError);

  const state = request.nextUrl.searchParams.get('state');
  const code = request.nextUrl.searchParams.get('code');
  const expected = request.cookies.get(ETSY_OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(ETSY_OAUTH_VERIFIER_COOKIE)?.value;
  if (!state || !expected || state !== expected || !code || !verifier) {
    return fail('Etsy sign-in expired. Connect the shop again.');
  }

  const creds = getEtsyCredentials();
  if (!creds) return fail('Etsy is not configured on the server');

  try {
    const token = await exchangeEtsyCode(creds, `${base}/api/etsy/callback`, code, verifier);
    await saveEtsyConnection(userEmail, token);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Could not connect Etsy');
  }

  const response = NextResponse.redirect(`${base}/settings?etsy=connected#etsy`);
  response.cookies.delete(ETSY_OAUTH_STATE_COOKIE);
  response.cookies.delete(ETSY_OAUTH_VERIFIER_COOKIE);
  return response;
}
