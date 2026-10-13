import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { YOUTUBE_CORE_SCOPES, YOUTUBE_SCOPES, googleCredentials } from './config';
import { redactSecrets } from './policy';
import { YoutubeUserError } from './types';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export interface OAuthStatePayload {
  nonce: string;
  accountId: string;
  exp: number;
}

export function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.YOUTUBE_TOKEN_ENCRYPTION_KEY?.trim() ?? '';
  if (!raw) {
    throw new YoutubeUserError('not_configured', 'Set YOUTUBE_TOKEN_ENCRYPTION_KEY on the server before connecting YouTube.');
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw) || /^[A-Za-z0-9+/]{42}==$/.test(raw)) {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  }
  if (raw.length >= 32) return createHash('sha256').update(raw).digest();
  throw new YoutubeUserError(
    'not_configured',
    'YOUTUBE_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 or hex value, or a passphrase of at least 32 characters. Generate one with: openssl rand -base64 32',
  );
}

export function encryptString(plain: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptString(payload: string, key: Buffer = encryptionKey()): string {
  const [version, ivPart, tagPart, dataPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) {
    throw new YoutubeUserError('token_unreadable', 'The stored YouTube token could not be read. Reconnect the channel.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new YoutubeUserError('token_unreadable', 'The stored YouTube token could not be decrypted. Reconnect the channel. If the encryption key changed, the old token cannot be recovered.');
  }
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function sealState(payload: OAuthStatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function openState(token: string, secret: string, nowSeconds: number): OAuthStatePayload | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<OAuthStatePayload>;
    if (!payload.nonce || !payload.accountId || typeof payload.exp !== 'number') return null;
    if (payload.exp <= nowSeconds) return null;
    return { nonce: payload.nonce, accountId: payload.accountId, exp: payload.exp };
  } catch {
    return null;
  }
}

export function noncesMatch(cookieNonce: string | undefined, payloadNonce: string): boolean {
  if (!cookieNonce) return false;
  const left = Buffer.from(cookieNonce);
  const right = Buffer.from(payloadNonce);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function assertCallbackBinding(input: {
  sealed: string | null;
  cookieNonce: string | undefined;
  currentAccountId: string | null;
  secret: string;
  nowSeconds: number;
}): OAuthStatePayload {
  if (!input.currentAccountId) {
    throw new YoutubeUserError('not_signed_in', 'Sign in to LotLister before connecting YouTube.');
  }
  if (!input.sealed) throw new YoutubeUserError('oauth_state', 'YouTube did not return the sign-in state. Start the connection again from LotLister settings.');
  const payload = openState(input.sealed, input.secret, input.nowSeconds);
  if (!payload || !noncesMatch(input.cookieNonce, payload.nonce)) {
    throw new YoutubeUserError('oauth_state', 'YouTube sign-in expired or did not match this browser. Connect the channel again.');
  }
  if (payload.accountId !== input.currentAccountId) {
    throw new YoutubeUserError('oauth_state', 'This YouTube connection was started by a different LotLister account. Connect again while signed in to the account that should own the channel.');
  }
  return payload;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

async function postForm(url: string, body: URLSearchParams): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    throw new YoutubeUserError('upstream_redirect', 'Google returned a redirect during token exchange. The request was stopped.');
  }
  return { status: response.status, text: await response.text() };
}

function readToken(status: number, text: string, requireRefresh: boolean): GoogleTokenResponse {
  if (status < 200 || status >= 300) {
    let reason = '';
    let description = '';
    try {
      const parsed = JSON.parse(text) as { error?: string; error_description?: string };
      reason = parsed.error || '';
      description = parsed.error_description || '';
    } catch {
      description = text.slice(0, 160);
    }
    if (reason === 'invalid_grant' || reason === 'invalid_rapt') {
      throw new YoutubeUserError('reconnect_required', 'The Google refresh token expired or was revoked. Reconnect this YouTube channel in LotLister settings.');
    }
    if (reason === 'invalid_client') {
      throw new YoutubeUserError('not_configured', 'Google rejected the OAuth client. Check GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.');
    }
    throw new YoutubeUserError('oauth_failed', redactSecrets(description || reason || `Google token request failed (${status}).`));
  }
  const parsed = JSON.parse(text) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!parsed.access_token) throw new YoutubeUserError('oauth_failed', 'Google did not return an access token.');
  if (requireRefresh && !parsed.refresh_token) {
    throw new YoutubeUserError(
      'refresh_token_missing',
      'Google did not return a refresh token. Remove LotLister at https://myaccount.google.com/permissions and connect again. Offline access is required so uploads can run after you leave the page.',
    );
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresIn: parsed.expires_in ?? 3600,
    scope: parsed.scope ?? '',
  };
}

export async function exchangeAuthCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = googleCredentials();
  const result = await postForm(TOKEN_URL, new URLSearchParams({
    code: input.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: input.codeVerifier,
  }));
  return readToken(result.status, result.text, true);
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = googleCredentials();
  const result = await postForm(TOKEN_URL, new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  }));
  return readToken(result.status, result.text, false);
}

export async function revokeToken(token: string): Promise<boolean> {
  try {
    const result = await postForm(REVOKE_URL, new URLSearchParams({ token }));
    return result.status === 200;
  } catch {
    return false;
  }
}

export function assertGrantedScopes(scope: string): void {
  if (!scope.trim()) return;
  const granted = new Set(scope.split(/\s+/));
  const missing = YOUTUBE_CORE_SCOPES.filter((item) => !granted.has(item));
  if (missing.length > 0) {
    throw new YoutubeUserError(
      'reconnect_required',
      'Google did not grant every YouTube permission this integration needs. Reconnect and accept the upload, video-edit, and read-only YouTube permissions.',
    );
  }
}

export const YOUTUBE_STATE_COOKIE = 'youtube_oauth_state';
export const YOUTUBE_VERIFIER_COOKIE = 'youtube_oauth_verifier';
