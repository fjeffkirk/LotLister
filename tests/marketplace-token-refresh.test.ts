import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getValidEbayAccessToken } from '../lib/ebay';
import { getValidEtsyAccessToken } from '../lib/etsy';
import { decryptCredential, encryptCredential } from '../lib/credential-crypto.mjs';

const { ebay, etsy, providerFetch } = vi.hoisted(() => ({
  ebay: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
  etsy: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  providerFetch: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ default: { ebayConnection: ebay, etsyConnection: etsy } }));

describe('marketplace token refresh through encrypted storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('hex'));
    for (const name of ['EBAY_APP_ID', 'EBAY_DEV_ID', 'EBAY_CERT_ID', 'EBAY_RU_NAME', 'ETSY_KEYSTRING', 'ETSY_SHARED_SECRET']) {
      vi.stubEnv(name, 'test-fixture');
    }
    vi.stubGlobal('fetch', providerFetch);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each(['ebay', 'etsy'] as const)('refreshes %s using the decrypted credential and persists only ciphertext', async (provider) => {
    const row = {
      userEmail: 'owner', shopId: 'fixture-shop', etsyUserId: '123', ebayUserId: 'owner', ebayUsername: 'fixture-owner',
      accessExpiresAt: new Date(0),
      accessToken: encryptCredential('expired-token', `${provider}:owner:access`),
      refreshToken: encryptCredential('original-refresh', `${provider}:owner:refresh`),
    };
    (provider === 'ebay' ? ebay : etsy).findUnique.mockResolvedValue(row);
    providerFetch.mockResolvedValue(new Response(JSON.stringify({ access_token: '123.fresh-token', expires_in: 3600 }), { status: 200 }));

    const result = provider === 'ebay' ? await getValidEbayAccessToken('owner') : await getValidEtsyAccessToken('owner');
    expect(typeof result === 'string' ? result : result.accessToken).toBe('123.fresh-token');
    expect(providerFetch).toHaveBeenCalledOnce();
    const request = providerFetch.mock.calls[0][1];
    expect(request.body.get('refresh_token')).toBe('original-refresh');
    const write = provider === 'ebay' ? ebay.upsert.mock.calls[0][0].update : etsy.update.mock.calls[0][0].data;
    expect(write.accessToken).toMatch(/^enc:v1:/);
    expect(write.refreshToken).toMatch(/^enc:v1:/);
    expect(decryptCredential(write.accessToken, `${provider}:owner:access`)).toBe('123.fresh-token');
    expect(decryptCredential(write.refreshToken, `${provider}:owner:refresh`)).toBe('original-refresh');
  });

  it.each(['ebay', 'etsy'] as const)('blocks %s provider requests if its stored token fails authentication', async (provider) => {
    (provider === 'ebay' ? ebay : etsy).findUnique.mockResolvedValue({
      userEmail: 'owner', shopId: 'fixture-shop', accessExpiresAt: new Date(0),
      accessToken: encryptCredential('token', `${provider}:different-owner:access`),
      refreshToken: encryptCredential('refresh', `${provider}:owner:refresh`),
    });
    await expect(provider === 'ebay' ? getValidEbayAccessToken('owner') : getValidEtsyAccessToken('owner')).rejects.toThrow('could not be decrypted');
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
