import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { credentialKey, decryptCredential, encryptCredential, isEncryptedCredential } from '../lib/credential-crypto.mjs';

/** Idempotent, paginated migration. Dry-run validates the key/ciphertexts and only
 * reports counts. Conditional writes preserve concurrent refreshes/reconnections.
 * Never prints account IDs, tokens, database URLs, or encryption keys.
 */
export async function migrateCredentials(db, { apply = false, includeShopify = false } = {}) {
  const key = credentialKey();
  const counts = { legacy: 0, encrypted: 0, updated: 0, concurrentlyChanged: 0 };
  for (const [provider, model, idField] of [
    ['ebay', db.ebayConnection, 'userEmail'], ['etsy', db.etsyConnection, 'userEmail'],
    ...(includeShopify ? [['shopify', db.appSetting, 'id']] : []),
  ]) {
    let cursor;
    for (;;) {
      const rows = await model.findMany({
        take: 100, orderBy: { [idField]: 'asc' },
        ...(cursor ? { cursor: { [idField]: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) {
        const fields = provider === 'shopify' ? ['shopifyAccessToken'] : ['accessToken', 'refreshToken'];
        const data = {};
        const where = { [idField]: row[idField] };
        for (const field of fields) {
          const value = row[field];
          if (!value) continue;
          const shop = String(row.shopifyShopDomain ?? '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '');
          if (provider === 'shopify' && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/.test(shop)) {
            throw new Error('A Shopify token has no valid canonical shop domain. Correct it before migration.');
          }
          const context = provider === 'shopify' ? `shopify:${shop}:access`
            : `${provider}:${row.userEmail}:${field === 'accessToken' ? 'access' : 'refresh'}`;
          const plain = decryptCredential(value, context, key);
          where[field] = value;
          if (isEncryptedCredential(value)) { counts.encrypted++; continue; }
          counts.legacy++;
          data[field] = encryptCredential(plain, context, key);
        }
        if (provider === 'shopify') where.shopifyShopDomain = row.shopifyShopDomain;
        if (apply && Object.keys(data).length) {
          const result = await model.updateMany({ where, data });
          if (result.count) counts.updated += Object.keys(data).length;
          else counts.concurrentlyChanged += Object.keys(data).length;
        }
      }
      if (rows.length < 100) break;
      cursor = rows[rows.length - 1][idField];
    }
  }
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = new PrismaClient();
  try {
    const apply = process.argv.includes('--apply');
    const result = await migrateCredentials(db, { apply, includeShopify: process.argv.includes('--include-shopify') });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }));
  } catch {
    console.error('Credential migration failed. Check database access, canonical shop domains, and CREDENTIAL_ENCRYPTION_KEY. No credentials are printed.');
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
