import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { getAppSettings } from "@/lib/queries/app-settings";
import { shopify } from "@/lib/shopify/client";

/** e.g. "OBD Collectibles" → "OBD Collectibles Dashboard" */
export function dashboardTitle(shopName?: string | null): string {
  const name = shopName?.trim();
  if (!name) return "Dashboard";
  return /dashboard$/i.test(name) ? name : `${name} Dashboard`;
}

export async function saveShopifyShopProfile(
  db: PrismaClient,
  info: { shopName: string; logoUrl: string | null },
) {
  const existing = await db.appSetting.findFirst();
  const data = {
    shopifyShopName: info.shopName,
    shopifyShopLogoUrl: info.logoUrl,
  };
  if (existing) {
    await db.appSetting.update({ where: { id: existing.id }, data });
  } else {
    await db.appSetting.create({ data });
  }
}

export async function persistShopifyShopProfile(
  db: PrismaClient,
): Promise<{ shopName: string; logoUrl: string | null } | null> {
  try {
    const info = await shopify.testConnection();
    await saveShopifyShopProfile(db, { shopName: info.shopName, logoUrl: info.logoUrl });
    return { shopName: info.shopName, logoUrl: info.logoUrl };
  } catch (e) {
    log.warn("Could not persist Shopify shop profile", {
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Use the stored shop name, or fetch + save it from Shopify when missing (env-token setups). */
export const ensureShopifyShopProfile = cache(async function ensureShopifyShopProfile(): Promise<{
  shopName: string | null;
  logoUrl: string | null;
}> {
  const settings = await getAppSettings();
  const name = settings?.shopifyShopName?.trim() || null;
  if (name) {
    return { shopName: name, logoUrl: settings?.shopifyShopLogoUrl ?? null };
  }
  if (!prisma) {
    return { shopName: null, logoUrl: settings?.shopifyShopLogoUrl ?? null };
  }
  const saved = await persistShopifyShopProfile(prisma);
  return {
    shopName: saved?.shopName ?? null,
    logoUrl: saved?.logoUrl ?? settings?.shopifyShopLogoUrl ?? null,
  };
});
