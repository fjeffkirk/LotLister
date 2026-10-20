import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getUserEmail } from '../../../../lib/auth';
import { getPublicBaseUrl } from '../../../../lib/ebay';
import {
  TIKTOK_STATE_COOKIE,
  buildAuthorizeUrl,
  encryptionKey,
  missingTiktokEnv,
  sealState,
  tiktokCredentials,
} from '../../../../lib/tiktok/oauth';
import { tiktokCallbackUrl } from '../../../../lib/tiktok/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const base = getPublicBaseUrl(request.nextUrl.origin);
  const fail = (message: string) => NextResponse.redirect(`${base}/tiktok?tiktok=error&message=${encodeURIComponent(message)}`);
  const accountId = await getUserEmail();
  if (!accountId) return fail('Sign in before connecting TikTok');
  const missing = missingTiktokEnv();
  if (missing.length > 0) return fail(`Add ${missing.join(', ')} on the server`);

  const nonce = randomBytes(24).toString('hex');
  const secret = encryptionKey().toString('base64url');
  const state = sealState({ nonce, accountId, exp: Math.floor(Date.now() / 1000) + 600 }, secret);
  const { appId } = tiktokCredentials();
  const response = NextResponse.redirect(buildAuthorizeUrl({
    appId,
    redirectUri: tiktokCallbackUrl(base),
    state,
  }));
  response.cookies.set(TIKTOK_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return response;
}
