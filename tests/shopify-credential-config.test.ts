import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveShopifyConfig, invalidateShopifyConfigCache } from '../lib/shopify/config';
import { encryptCredential, decryptCredential } from '../lib/credential-crypto.mjs';
const { findFirst, updateMany } = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }));
vi.mock('../lib/db', () => ({ prisma: { appSetting: { findFirst, updateMany } } }));
vi.mock('../lib/env', () => ({ env: { SHOPIFY_API_VERSION: '2026-10' } }));
const shop = 'fixture.myshopify.com';
describe('Shopify credential loading', () => {
  beforeEach(() => {
    vi.clearAllMocks(); invalidateShopifyConfigCache();
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', Buffer.alloc(32, 5).toString('hex'));
    updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it('upgrades a legacy token before using it and protects against concurrent reconnects', async () => {
    findFirst.mockResolvedValue({ id: 'settings', shopifyShopDomain: shop, shopifyAccessToken: 'legacy' });
    expect(await resolveShopifyConfig()).toEqual({ shop, token: 'legacy', version: '2026-10' });
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'settings', shopifyShopDomain: shop, shopifyAccessToken: 'legacy' });
    expect(decryptCredential(args.data.shopifyAccessToken, `shopify:${shop}:access`)).toBe('legacy');
  });
  it('decrypts encrypted tokens but does not rewrite them', async () => {
    findFirst.mockResolvedValue({ id: 'settings', shopifyShopDomain: shop,
      shopifyAccessToken: encryptCredential('test-token', `shopify:${shop}:access`) });
    expect((await resolveShopifyConfig())?.token).toBe('test-token');
    expect(updateMany).not.toHaveBeenCalled();
  });
  it('does not silently reuse a stale token after a corrupt encrypted value is read', async () => {
    vi.useFakeTimers();
    findFirst.mockResolvedValue({ id: 'settings', shopifyShopDomain: shop, shopifyAccessToken: encryptCredential('token', `shopify:${shop}:access`) });
    await resolveShopifyConfig();
    vi.advanceTimersByTime(11 * 60_000);
    findFirst.mockResolvedValue({ id: 'settings', shopifyShopDomain: shop, shopifyAccessToken: 'enc:v2:bad' });
    await expect(resolveShopifyConfig()).rejects.toThrow('could not be decrypted');
    findFirst.mockRejectedValue(new Error('offline'));
    expect(await resolveShopifyConfig()).toBeNull();
  });
});
