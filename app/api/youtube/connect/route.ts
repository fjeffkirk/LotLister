import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import { googleCredentials, missingYoutubeEnv, youtubeCallbackUrl } from '../../../../lib/youtube/config';
import {
  YOUTUBE_STATE_COOKIE,
  YOUTUBE_VERIFIER_COOKIE,
  buildAuthorizeUrl,
  createPkcePair,
  encryptionKey,
  sealState,
} from '../../../../lib/youtube/oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);
  const fail = (message: string) =>
    NextResponse.redirect(`${base}/settings?youtube=error&message=${encodeURIComponent(message)}#youtube`);
  const accountId = await getUserEmail();
  if (!accountId) return fail('Sign in before connecting YouTube');
  if (missingYoutubeEnv().length > 0) return fail(`Add ${missingYoutubeEnv().join(', ')} on the server`);

  const nonce = randomBytes(24).toString('hex');
  const secret = encryptionKey().toString('base64url');
  const state = sealState({ nonce, accountId, exp: Math.floor(Date.now() / 1000) + 600 }, secret);
  const pkce = createPkcePair();
  const { clientId } = googleCredentials();
  const response = NextResponse.redirect(buildAuthorizeUrl({
    clientId,
    redirectUri: youtubeCallbackUrl(base),
    state,
    codeChallenge: pkce.challenge,
  }));
  const cookie = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  };
  response.cookies.set(YOUTUBE_STATE_COOKIE, nonce, cookie);
  response.cookies.set(YOUTUBE_VERIFIER_COOKIE, pkce.verifier, cookie);
  return response;
}
