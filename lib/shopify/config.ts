import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { normalizeShopDomain } from "./normalize";
import { decryptCredential, encryptCredential, isEncryptedCredential } from '../credential-crypto.mjs';

export type ShopifyApiConfig = {
  shop: string;
  token: string;
  version: string;
};

// Server-level cache — persists across requests on Render's persistent server.
// Prevents "Shopify is not connected" false-negatives when the DB is briefly under load.
let _configCache: { value: ShopifyApiConfig; expiry: number } | null = null;
const CONFIG_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Call this after OAuth completes or the user disconnects to force a fresh DB read. */
export function invalidateShopifyConfigCache() {
  _configCache = null;
}

/**
 * Token + shop: env vars first (no DB hit), then AppSetting from DB.
 * Falls back to a stale in-memory cache when the DB is temporarily unreachable.
 */
export async function resolveShopifyConfig(): Promise<ShopifyApiConfig | null> {
  const version = env.SHOPIFY_API_VERSION || "2024-10";

  // Fast path: env vars — no DB call needed
  const shopEnv = normalizeShopDomain(env.SHOPIFY_SHOP_DOMAIN);
  const tokenEnv = env.SHOPIFY_ACCESS_TOKEN?.trim();
  if (shopEnv && tokenEnv) {
    return { shop: shopEnv, token: tokenEnv, version };
  }

  // Return cached config if still fresh
  if (_configCache && Date.now() < _configCache.expiry) {
    return _configCache.value;
  }

  if (!prisma) return _configCache?.value ?? null;
  let row;
  try {
    row = await prisma.appSetting.findFirst({
      select: { id: true, shopifyShopDomain: true, shopifyAccessToken: true },
    });
  } catch {
    // Only database availability errors may use the stale cache. Never hide a
    // decryption failure or use a different key's cached token after corruption.
    return _configCache?.value ?? null;
  }
  const shop = normalizeShopDomain(row?.shopifyShopDomain);
  const stored = row?.shopifyAccessToken?.trim();
  if (!row || !shop || !stored) {
    _configCache = null;
    return null;
  }
  try {
    const token = decryptCredential(stored, `shopify:${shop}:access`);
    if (!isEncryptedCredential(stored)) {
      await prisma.appSetting.updateMany({
        where: { id: row.id, shopifyAccessToken: row.shopifyAccessToken, shopifyShopDomain: row.shopifyShopDomain },
        data: { shopifyAccessToken: encryptCredential(token, `shopify:${shop}:access`) },
      });
    }
    _configCache = { value: { shop, token, version }, expiry: Date.now() + CONFIG_TTL_MS };
    return _configCache.value;
  } catch (error) {
    _configCache = null;
    throw error;
  }
}

export { normalizeShopDomain };

export async function isShopifyApiReady(): Promise<boolean> {
  return (await resolveShopifyConfig()) != null;
}

/**
 * true if DEMO_MODE, or if no way to call Admin API (no env pair and no DB token).
 */
export async function isDemoModeAsync(): Promise<boolean> {
  if (env.DEMO_MODE === true) return true;
  if (await resolveShopifyConfig()) return false;
  return true;
}

export function hasOauthClientCredentials(): boolean {
  return Boolean(
    (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_ID.length > 0) &&
      (env.SHOPIFY_CLIENT_SECRET && env.SHOPIFY_CLIENT_SECRET.length > 0)
  );
}

/**
 * Public URL for OAuth callback (add `/api/shopify/auth/callback` in Partners → App → URLs).
 */
export function getAppBaseUrl(): string {
  if (env.SHOPIFY_APP_URL) {
    return env.SHOPIFY_APP_URL.replace(/\/$/, "");
  }
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicUrl) {
    return publicUrl.replace(/\/$/, "");
  }
  return "http://localhost:3000";
}
