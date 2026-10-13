import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import { youtubeCallbackUrl } from '../../../../lib/youtube/config';
import {
  YOUTUBE_STATE_COOKIE,
  YOUTUBE_VERIFIER_COOKIE,
  assertCallbackBinding,
  encryptionKey,
} from '../../../../lib/youtube/oauth';
import { exchangeYoutubeCode, finishOAuth, safeClientMessage } from '../../../../lib/youtube/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);
  const fail = (message: string) => {
    const response = NextResponse.redirect(`${base}/settings?youtube=error&message=${encodeURIComponent(message)}#youtube`);
    clearCookies(response);
    return response;
  };

  const googleError = request.nextUrl.searchParams.get('error_description') || request.nextUrl.searchParams.get('error');
  if (googleError) return fail(googleError.slice(0, 180));

  try {
    const secret = encryptionKey().toString('base64url');
    const payload = assertCallbackBinding({
      sealed: request.nextUrl.searchParams.get('state'),
      cookieNonce: request.cookies.get(YOUTUBE_STATE_COOKIE)?.value,
      currentAccountId: await getUserEmail(),
      secret,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const code = request.nextUrl.searchParams.get('code');
    const verifier = request.cookies.get(YOUTUBE_VERIFIER_COOKIE)?.value;
    if (!code || !verifier) return fail('YouTube sign-in did not include a code. Connect the channel again.');
    const token = await exchangeYoutubeCode({
      code,
      redirectUri: youtubeCallbackUrl(base),
      codeVerifier: verifier,
    });
    const connection = await finishOAuth(payload.accountId, token);
    const response = NextResponse.redirect(
      `${base}/settings?youtube=connected&channel=${encodeURIComponent(connection.channelTitle)}#youtube`,
    );
    clearCookies(response);
    return response;
  } catch (error) {
    return fail(safeClientMessage(error));
  }
}

function clearCookies(response: NextResponse) {
  response.cookies.set(YOUTUBE_STATE_COOKIE, '', { path: '/', maxAge: 0 });
  response.cookies.set(YOUTUBE_VERIFIER_COOKIE, '', { path: '/', maxAge: 0 });
}
