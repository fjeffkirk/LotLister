import prisma from './prisma';
import { credentialKey, decryptCredential, encryptCredential, isEncryptedCredential } from './credential-crypto.mjs';

/** Decrypt tokens only on the server. Upgrade legacy rows with a compare-and-swap
 * so a concurrent OAuth reconnect/refresh cannot be overwritten by migration.
 */
export async function readMarketplaceTokens(
  provider: 'ebay' | 'etsy',
  row: { userEmail: string; accessToken: string; refreshToken: string },
): Promise<{ accessToken: string; refreshToken: string }> {
  const key = credentialKey();
  const accessContext = `${provider}:${row.userEmail}:access`;
  const refreshContext = `${provider}:${row.userEmail}:refresh`;
  const accessToken = decryptCredential(row.accessToken, accessContext, key);
  const refreshToken = decryptCredential(row.refreshToken, refreshContext, key);
  if (!isEncryptedCredential(row.accessToken) || !isEncryptedCredential(row.refreshToken)) {
    const args = {
      where: { userEmail: row.userEmail, accessToken: row.accessToken, refreshToken: row.refreshToken },
      data: {
        accessToken: encryptCredential(accessToken, accessContext, key),
        refreshToken: encryptCredential(refreshToken, refreshContext, key),
      },
    };
    if (provider === 'ebay') await prisma.ebayConnection.updateMany(args);
    else await prisma.etsyConnection.updateMany(args);
  }
  return { accessToken, refreshToken };
}

export function sealMarketplaceTokens(provider: 'ebay' | 'etsy', accountId: string, accessToken: string, refreshToken: string) {
  const key = credentialKey();
  return {
    accessToken: encryptCredential(accessToken, `${provider}:${accountId}:access`, key),
    refreshToken: encryptCredential(refreshToken, `${provider}:${accountId}:refresh`, key),
  };
}
