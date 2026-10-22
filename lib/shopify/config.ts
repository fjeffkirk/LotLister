import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { env } from "@/lib/env";
import { normalizeShopDomain } from "./normalize";

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

  // Fetch from DB, but fall back to the stale cache on any error to avoid
  // false-negative "Shopify is not connected" under transient DB load.
  try {
    if (!prisma) return _configCache?.value ?? null;
    const row = await prisma.appSetting.findFirst({
      select: { shopifyShopDomain: true, shopifyAccessToken: true },
    });
    const shop = normalizeShopDomain(row?.shopifyShopDomain);
    const token = row?.shopifyAccessToken?.trim();
    if (shop && token) {
      _configCache = { value: { shop, token, version }, expiry: Date.now() + CONFIG_TTL_MS };
      return _configCache.value;
    }
    // DB is reachable but no valid config stored — clear cache
    _configCache = null;
    return null;
  } catch (e) {
    // DB temporarily unreachable — return stale cache rather than a false-negative
    if (_configCache) {
      log.warn("Shopify config DB lookup failed, using cached config", { message: (e as Error).message?.slice(0, 100) });
      return _configCache.value;
    }
    return null;
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
