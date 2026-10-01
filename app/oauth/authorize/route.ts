import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../lib/auth';
import { grantedScopes } from '../../../lib/mcp/oauth';
import { getMcpClient, issueAuthCode } from '../../../lib/mcp/store';

export const dynamic = 'force-dynamic';

const RETURN_COOKIE = 'lotlister_oauth_return';
const CONSENT_COOKIE = 'mcp_consent';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

function authorizeQuery(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return {
    clientId: params.get('client_id') ?? '',
    redirectUri: params.get('redirect_uri') ?? '',
    state: params.get('state') ?? '',
    codeChallenge: params.get('code_challenge') ?? '',
    method: params.get('code_challenge_method') ?? '',
    responseType: params.get('response_type') ?? '',
    scope: params.get('scope') ?? '',
  };
}

export async function GET(request: NextRequest) {
  const query = authorizeQuery(request);
  const user = await getCurrentUser();
  if (!user) {
    const back = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    const response = NextResponse.redirect(new URL('/api/ebay/connect', request.url));
    response.cookies.set(RETURN_COOKIE, back, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 });
    return response;
  }

  const consent = randomBytes(16).toString('hex');
  const hidden = Object.entries({
    client_id: query.clientId,
    redirect_uri: query.redirectUri,
    state: query.state,
    code_challenge: query.codeChallenge,
    code_challenge_method: query.method,
    response_type: query.responseType,
    scope: query.scope,
    consent,
  }).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect ChatGPT</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1017; color: #e8eaf0; font: 16px/1.5 system-ui, sans-serif; }
  main { width: min(440px, calc(100% - 32px)); padding: 28px; border: 1px solid rgba(255,255,255,.08); border-radius: 16px; background: #151923; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p, li { color: #b7becc; }
  button { margin-top: 16px; border: 0; border-radius: 10px; padding: 10px 16px; background: #3d6bff; color: white; font-weight: 600; cursor: pointer; }
</style></head>
<body><main>
  <h1>Let ChatGPT read LotLister</h1>
  <p>Signed in as ${escapeHtml(user.username)}. ChatGPT can:</p>
  <ul>
    <li>View lots, eBay listings, Etsy orders, and Shopify totals</li>
    <li>Create an unpublished Etsy draft from a card</li>
  </ul>
  <p>It cannot publish listings or delete anything.</p>
  <form method="post">${hidden}<button type="submit">Allow</button></form>
</main></body></html>`;

  const response = new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  response.cookies.set(CONSENT_COOKIE, consent, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600 });
  return response;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const consent = String(form.get('consent') ?? '');
  const expected = request.cookies.get(CONSENT_COOKIE)?.value;
  const user = await getCurrentUser();
  if (!user || !consent || consent !== expected) {
    return NextResponse.redirect(new URL('/oauth/authorize', request.url));
  }

  const clientId = String(form.get('client_id') ?? '');
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const state = String(form.get('state') ?? '');
  const codeChallenge = String(form.get('code_challenge') ?? '');
  const method = String(form.get('code_challenge_method') ?? '');
  const responseType = String(form.get('response_type') ?? '');
  if (responseType !== 'code' || method !== 'S256' || !codeChallenge || !state) {
    return new NextResponse('ChatGPT did not send a valid sign-in request', { status: 400 });
  }

  const client = await getMcpClient(clientId);
  if (!client || !client.redirectUris.includes(redirectUri)) {
    return new NextResponse('This ChatGPT connector is not registered', { status: 400 });
  }

  const scopes = grantedScopes(String(form.get('scope') ?? ''));
  const code = await issueAuthCode({ clientId, userEmail: user.accountId, redirectUri, codeChallenge, scopes });
  const back = new URL(redirectUri);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  const response = NextResponse.redirect(back);
  response.cookies.set(CONSENT_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
