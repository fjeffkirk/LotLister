import { describe, expect, it } from 'vitest';
import {
  createSessionToken,
  getSessionSecret,
  isEbayUserAllowed,
  signSession,
  verifySession,
} from '../lib/session';

const SECRET = 'test-secret';
const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe('session tokens', () => {
  it('round-trips a signed session', () => {
    const token = createSessionToken('ebay-user-id', 'seller_name', SECRET);
    expect(verifySession(token, SECRET)).toMatchObject({ sub: 'ebay-user-id', username: 'seller_name' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken('ebay-user-id', 'seller_name', SECRET);
    expect(verifySession(token, 'other-secret')).toBeNull();
  });

  it('rejects a token whose payload was edited', () => {
    const token = createSessionToken('ebay-user-id', 'seller_name', SECRET);
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'someone-else', username: 'x', exp: 9999999999 })).toString(
      'base64url'
    );
    expect(verifySession(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSession({ sub: 'u', username: 'n', exp: 1000 }, SECRET);
    expect(verifySession(token, SECRET, 1001)).toBeNull();
  });

  it('rejects garbage and the old plain email cookie', () => {
    for (const value of [undefined, '', 'me@example.com', 'a.b.c', 'abc.def']) {
      expect(verifySession(value, SECRET)).toBeNull();
    }
  });
});

describe('getSessionSecret', () => {
  it('prefers SESSION_SECRET and otherwise derives one from the Cert ID', () => {
    expect(getSessionSecret(env({ SESSION_SECRET: 'explicit', EBAY_CERT_ID: 'cert' }))).toBe('explicit');
    const derived = getSessionSecret(env({ EBAY_CERT_ID: 'cert' }));
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain('cert');
    expect(getSessionSecret(env({}))).toBeNull();
  });
});

describe('isEbayUserAllowed', () => {
  const allowList = env({ EBAY_ALLOWED_USERS: ' Seller_One , friend_two ' });

  it('allows listed usernames case-insensitively', () => {
    expect(isEbayUserAllowed({ username: 'seller_one', userId: 'x' }, allowList)).toBe(true);
    expect(isEbayUserAllowed({ username: 'FRIEND_TWO', userId: 'y' }, allowList)).toBe(true);
  });

  it('rejects anyone not listed', () => {
    expect(isEbayUserAllowed({ username: 'stranger', userId: 'z' }, allowList)).toBe(false);
    expect(isEbayUserAllowed({ username: null, userId: null }, allowList)).toBe(false);
  });

  it('lets nobody in when the list is empty or missing', () => {
    expect(isEbayUserAllowed({ username: 'seller_one', userId: 'x' }, env({}))).toBe(false);
    expect(isEbayUserAllowed({ username: 'seller_one', userId: 'x' }, env({ EBAY_ALLOWED_USERS: ' , ' }))).toBe(false);
  });
});
