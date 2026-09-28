import { createHash, createHmac, timingSafeEqual } from 'crypto';

export const SESSION_COOKIE = 'lotlister_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SessionPayload {
  /** Account key: the immutable eBay user id. */
  sub: string;
  /** eBay username, for display. */
  username: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

/** SESSION_SECRET if set, otherwise derived from the eBay Cert ID so no extra secret has to be configured. */
export function getSessionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.SESSION_SECRET?.trim();
  if (explicit) return explicit;
  const certId = env.EBAY_CERT_ID?.trim();
  if (!certId) return null;
  return createHash('sha256').update(`lotlister-session:${certId}`).digest('hex');
}

function hmac(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

export function verifySession(
  token: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): SessionPayload | null {
  if (!token) return null;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;

  const expected = Buffer.from(hmac(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
    return { sub: payload.sub, username: String(payload.username ?? ''), exp: payload.exp };
  } catch {
    return null;
  }
}

export function createSessionToken(sub: string, username: string, secret: string): string {
  return signSession(
    { sub, username, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS },
    secret
  );
}

/** EBAY_ALLOWED_USERS is a comma-separated list of eBay usernames (or user ids). Empty means nobody. */
export function isEbayUserAllowed(
  identity: { username: string | null; userId: string | null },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const allowed = (env.EBAY_ALLOWED_USERS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;
  return [identity.username, identity.userId].some(
    (value) => Boolean(value) && allowed.includes(String(value).toLowerCase())
  );
}
