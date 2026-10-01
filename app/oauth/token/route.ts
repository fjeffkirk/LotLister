import { NextRequest, NextResponse } from 'next/server';
import { exchangeAuthCode, exchangeRefreshToken } from '../../../lib/mcp/store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const grant = String(form?.get('grant_type') ?? '');
  const clientId = String(form?.get('client_id') ?? '');
  try {
    if (grant === 'authorization_code') {
      const issued = await exchangeAuthCode({
        code: String(form?.get('code') ?? ''),
        clientId,
        redirectUri: String(form?.get('redirect_uri') ?? ''),
        codeVerifier: String(form?.get('code_verifier') ?? ''),
      });
      return NextResponse.json({
        access_token: issued.accessToken,
        refresh_token: issued.refreshToken,
        token_type: 'Bearer',
        expires_in: issued.expiresIn,
        scope: issued.scopes,
      });
    }
    if (grant === 'refresh_token') {
      const issued = await exchangeRefreshToken({
        refreshToken: String(form?.get('refresh_token') ?? ''),
        clientId,
      });
      return NextResponse.json({
        access_token: issued.accessToken,
        refresh_token: issued.refreshToken,
        token_type: 'Bearer',
        expires_in: issued.expiresIn,
        scope: issued.scopes,
      });
    }
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      error: 'invalid_grant',
      error_description: error instanceof Error ? error.message : 'Token request failed',
    }, { status: 400 });
  }
}
