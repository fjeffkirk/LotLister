import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import {
  EBAY_OAUTH_STATE_COOKIE,
  exchangeEbayAuthCode,
  fetchEbayIdentity,
  getEbayCredentials,
  getPublicBaseUrl,
  saveEbayConnection,
} from '../../../../lib/ebay';

function settingsRedirect(base: string, params: Record<string, string>) {
  const url = new URL('/settings', base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(EBAY_OAUTH_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);
  const userEmail = await getUserEmail();
  if (!userEmail) {
    return settingsRedirect(base, { ebay: 'error', message: 'Set your email before connecting eBay' });
  }

  const ebayError = request.nextUrl.searchParams.get('error_description') || request.nextUrl.searchParams.get('error');
  if (ebayError) {
    return settingsRedirect(base, { ebay: 'error', message: ebayError.slice(0, 300) });
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expected = request.cookies.get(EBAY_OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected) {
    return settingsRedirect(base, { ebay: 'error', message: 'eBay sign-in could not be verified. Try connecting again.' });
  }

  const creds = await getEbayCredentials();
  if (!creds) {
    return settingsRedirect(base, { ebay: 'error', message: 'eBay is not configured on the server' });
  }

  try {
    const token = await exchangeEbayAuthCode(creds, code);
    const identity = await fetchEbayIdentity(token.access_token);
    await saveEbayConnection(userEmail, token, identity);
    return settingsRedirect(base, { ebay: 'connected' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'eBay connection failed';
    return settingsRedirect(base, { ebay: 'error', message: message.slice(0, 300) });
  }
}
