import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { TiktokUserError } from './policy';

const API = 'https://business-api.tiktok.com/open_api/v1.3';

export function tiktokCredentials(env: NodeJS.ProcessEnv = process.env): { appId: string; secret: string } {
  const appId = env.TIKTOK_APP_ID?.trim() ?? '';
  const secret = env.TIKTOK_APP_SECRET?.trim() ?? '';
  if (!appId || !secret) {
    throw new TiktokUserError('not_configured', 'Set TIKTOK_APP_ID and TIKTOK_APP_SECRET on the server.');
  }
  return { appId, secret };
}

export function missingTiktokEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.TIKTOK_APP_ID?.trim()) missing.push('TIKTOK_APP_ID');
  if (!env.TIKTOK_APP_SECRET?.trim()) missing.push('TIKTOK_APP_SECRET');
  if (!env.TIKTOK_TOKEN_ENCRYPTION_KEY?.trim()) missing.push('TIKTOK_TOKEN_ENCRYPTION_KEY');
  return missing;
}

export function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.TIKTOK_TOKEN_ENCRYPTION_KEY?.trim() ?? '';
  if (!raw) throw new TiktokUserError('not_configured', 'Set TIKTOK_TOKEN_ENCRYPTION_KEY before connecting TikTok.');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) return decoded;
  if (raw.length >= 32) return createHash('sha256').update(raw).digest();
  throw new TiktokUserError('not_configured', 'TIKTOK_TOKEN_ENCRYPTION_KEY must be 32 bytes in base64 or hex, or a passphrase of at least 32 characters.');
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
    throw new TiktokUserError('token_unreadable', 'The stored TikTok token could not be read. Connect the advertiser again.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new TiktokUserError('token_unreadable', 'The stored TikTok token could not be decrypted. Connect the advertiser again.');
  }
}

export function sealState(payload: { nonce: string; accountId: string; exp: number }, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function openState(token: string, secret: string, nowSeconds: number): { nonce: string; accountId: string; exp: number } | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { nonce?: string; accountId?: string; exp?: number };
    if (!payload.nonce || !payload.accountId || typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
    return { nonce: payload.nonce, accountId: payload.accountId, exp: payload.exp };
  } catch {
    return null;
  }
}

export const TIKTOK_STATE_COOKIE = 'tiktok_oauth_state';

/** Advertiser authorization URL. The redirect must be registered on the TikTok app. */
export function buildAuthorizeUrl(input: { appId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({ app_id: input.appId, redirect_uri: input.redirectUri, state: input.state });
  return `https://business-api.tiktok.com/portal/auth?${params.toString()}`;
}

export interface TiktokTokenResult {
  accessToken: string;
  scope: string;
  advertiserIds: string[];
}

export async function exchangeAuthCode(authCode: string, env: NodeJS.ProcessEnv = process.env): Promise<TiktokTokenResult> {
  const { appId, secret } = tiktokCredentials(env);
  const response = await fetch(`${API}/oauth2/access_token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, secret, auth_code: authCode }),
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    throw new TiktokUserError('upstream_redirect', 'TikTok returned a redirect during token exchange. The request was stopped.');
  }
  const body = await response.json() as { code?: number; message?: string; data?: { access_token?: string; scope?: number[] | string; advertiser_ids?: Array<string | number> } };
  if (!response.ok || body.code !== 0 || !body.data?.access_token) {
    throw new TiktokUserError('oauth_failed', 'TikTok did not return an access token. Start the advertiser authorization again.');
  }
  const scope = Array.isArray(body.data.scope) ? body.data.scope.join(',') : String(body.data.scope ?? '');
  return {
    accessToken: body.data.access_token,
    scope,
    advertiserIds: (body.data.advertiser_ids ?? []).map(String),
  };
}
