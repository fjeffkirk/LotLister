import { NextRequest, NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import {
  EBAY_OAUTH_STATE_COOKIE,
  exchangeEbayAuthCode,
  fetchEbayIdentity,
  getEbayCredentials,
  getPublicBaseUrl,
  saveEbayConnection,
} from '../../../../lib/ebay';
import {
  createSessionToken,
  getSessionSecret,
  isEbayUserAllowed,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '../../../../lib/session';

function redirectTo(base: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(EBAY_OAUTH_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

function signInError(base: string, message: string) {
  return redirectTo(base, '/lots', { signin: 'error', message: message.slice(0, 300) });
}

// GET /api/ebay/callback - eBay redirects here after "Sign in with eBay"
export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);

  const ebayError = request.nextUrl.searchParams.get('error_description') || request.nextUrl.searchParams.get('error');
  if (ebayError) {
    return signInError(base, ebayError);
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expected = request.cookies.get(EBAY_OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected) {
    return signInError(base, 'eBay sign-in could not be verified. Try again.');
  }

  const creds = await getEbayCredentials();
  const secret = getSessionSecret();
  if (!creds || !secret) {
    return signInError(base, 'eBay is not configured on the server');
  }

  try {
    const token = await exchangeEbayAuthCode(creds, code);
    const identity = await fetchEbayIdentity(token.access_token);
    if (!identity.userId || !identity.username) {
      return signInError(base, 'eBay did not return your account details. Try again.');
    }
    if (!isEbayUserAllowed(identity)) {
      return signInError(base, `The eBay account ${identity.username} is not allowed to use LotLister.`);
    }

    await saveEbayConnection(identity.userId, token, identity);
    await prisma.user.upsert({
      where: { email: identity.userId },
      update: {},
      create: { email: identity.userId },
    });

    const response = redirectTo(base, '/lots');
    response.cookies.set(SESSION_COOKIE, createSessionToken(identity.userId, identity.username, secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'eBay sign-in failed';
    return signInError(base, message);
  }
}
