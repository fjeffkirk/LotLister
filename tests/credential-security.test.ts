import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialKey, decryptCredential, encryptCredential } from '../lib/credential-crypto.mjs';
import { readMarketplaceTokens, sealMarketplaceTokens } from '../lib/credential-store';

const { ebayUpdate, etsyUpdate } = vi.hoisted(() => ({ ebayUpdate: vi.fn(), etsyUpdate: vi.fn() }));
vi.mock('../lib/prisma', () => ({ default: {
  ebayConnection: { updateMany: ebayUpdate }, etsyConnection: { updateMany: etsyUpdate },
} }));
const key = Buffer.alloc(32, 7);
const context = 'ebay:test-account:access';

describe('encrypted marketplace credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', key.toString('hex'));
    ebayUpdate.mockResolvedValue({ count: 1 });
    etsyUpdate.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses random authenticated encryption and round-trips long tokens', () => {
    const token = 'test-token-'.repeat(200);
    const first = encryptCredential(token, context, key);
    expect(first).not.toContain(token);
    expect(first).not.toEqual(encryptCredential(token, context, key));
    expect(decryptCredential(first, context, key)).toBe(token);
  });
  it('rejects tampering, a wrong key, a swapped account/provider, and unknown formats', () => {
    const sealed = encryptCredential('test-token', context, key);
    const parts = sealed.split(':');
    parts[3] = Buffer.alloc(16, 0).toString('base64url');
    for (const [value, binding, secret] of [
      [parts.join(':'), context, key], [sealed, context, Buffer.alloc(32, 8)],
      [sealed, 'ebay:other:access', key], [sealed, 'etsy:test-account:access', key],
      ['enc:v2:anything', context, key], [sealed + ':extra', context, key],
    ] as const) expect(() => decryptCredential(value, binding, secret)).toThrow('could not be decrypted');
  });
  it('requires a correctly configured key even when reading a legacy plaintext credential', () => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', '');
    expect(() => decryptCredential('legacy-token', context)).toThrow('Set CREDENTIAL_ENCRYPTION_KEY');
    expect(() => credentialKey({ NODE_ENV: 'test', CREDENTIAL_ENCRYPTION_KEY: 'short' })).toThrow();
    expect(credentialKey({ NODE_ENV: 'test', CREDENTIAL_ENCRYPTION_KEY: key.toString('base64') })).toEqual(key);
  });
  it.each(['ebay', 'etsy'] as const)('migrates %s plaintext using a race-safe conditional write', async (provider) => {
    const row = { userEmail: 'owner', accessToken: 'legacy-access', refreshToken: 'legacy-refresh' };
    expect(await readMarketplaceTokens(provider, row)).toEqual({ accessToken: row.accessToken, refreshToken: row.refreshToken });
    const write = (provider === 'ebay' ? ebayUpdate : etsyUpdate).mock.calls[0][0];
    expect(write.where).toEqual(row);
    expect(decryptCredential(write.data.accessToken, `${provider}:owner:access`)).toBe(row.accessToken);
    expect(decryptCredential(write.data.refreshToken, `${provider}:owner:refresh`)).toBe(row.refreshToken);
  });
  it('does not rewrite encrypted rows and never sends encrypted tokens to the provider', async () => {
    const sealed = sealMarketplaceTokens('ebay', 'owner', 'access', 'refresh');
    expect(await readMarketplaceTokens('ebay', { userEmail: 'owner', ...sealed })).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(ebayUpdate).not.toHaveBeenCalled();
  });
  it('fails closed when migration cannot persist', async () => {
    ebayUpdate.mockRejectedValue(new Error('database unavailable'));
    await expect(readMarketplaceTokens('ebay', { userEmail: 'owner', accessToken: 'legacy', refreshToken: 'legacy' })).rejects.toThrow();
  });
});
