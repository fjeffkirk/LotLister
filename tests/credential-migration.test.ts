import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateCredentials } from '../scripts/encrypt-marketplace-credentials.mjs';
import { decryptCredential, encryptCredential } from '../lib/credential-crypto.mjs';

describe('batch credential migration', () => {
  beforeEach(() => vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('hex')));
  afterEach(() => vi.unstubAllEnvs());
  function database() {
    const ebay = { userEmail: 'owner', accessToken: 'legacy-access', refreshToken: 'legacy-refresh' };
    const shop = { id: 'store', shopifyShopDomain: 'fixture.myshopify.com', shopifyAccessToken: 'legacy-shopify' };
    return {
      ebayConnection: { findMany: vi.fn().mockResolvedValue([ebay]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      etsyConnection: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      appSetting: { findMany: vi.fn().mockResolvedValue([shop]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
  }
  it('defaults to dry-run and excludes shared Shopify credentials', async () => {
    const db = database();
    expect(await migrateCredentials(db)).toMatchObject({ legacy: 2, updated: 0 });
    expect(db.ebayConnection.updateMany).not.toHaveBeenCalled();
    expect(db.appSetting.findMany).not.toHaveBeenCalled();
  });
  it('encrypts legacy records with CAS and validates already-encrypted records without rewriting', async () => {
    const db = database();
    const result = await migrateCredentials(db, { apply: true, includeShopify: true });
    expect(result).toMatchObject({ legacy: 3, updated: 3 });
    const written = db.appSetting.updateMany.mock.calls[0][0];
    expect(written.where).toEqual({ id: 'store', shopifyShopDomain: 'fixture.myshopify.com', shopifyAccessToken: 'legacy-shopify' });
    expect(decryptCredential(written.data.shopifyAccessToken, 'shopify:fixture.myshopify.com:access')).toBe('legacy-shopify');
    db.ebayConnection.findMany.mockResolvedValue([{ userEmail: 'owner',
      accessToken: encryptCredential('a', 'ebay:owner:access'), refreshToken: encryptCredential('r', 'ebay:owner:refresh') }]);
    db.ebayConnection.updateMany.mockClear();
    expect(await migrateCredentials(db, { apply: true })).toMatchObject({ encrypted: 2, legacy: 0, updated: 0 });
    expect(db.ebayConnection.updateMany).not.toHaveBeenCalled();
  });
  it('reports concurrent changes without overwriting them', async () => {
    const db = database();
    db.ebayConnection.updateMany.mockResolvedValue({ count: 0 });
    expect(await migrateCredentials(db, { apply: true })).toMatchObject({ updated: 0, concurrentlyChanged: 2 });
  });
  it('fails on the wrong key rather than treating ciphertext as plaintext', async () => {
    const db = database();
    db.ebayConnection.findMany.mockResolvedValue([{ userEmail: 'owner',
      accessToken: encryptCredential('a', 'ebay:owner:access', Buffer.alloc(32, 1)), refreshToken: 'legacy' }]);
    await expect(migrateCredentials(db, { apply: true })).rejects.toThrow('could not be decrypted');
    expect(db.ebayConnection.updateMany).not.toHaveBeenCalled();
  });
});
