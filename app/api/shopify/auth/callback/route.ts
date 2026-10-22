import { requireShopifySession, isUnauthorized } from "@/lib/require-session";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import pkg from "@/package.json";
import { exchangeCodeForToken, getOAuthCallbackUrl, verifyOAuthHmac, STATE_COOKIE } from "@/lib/shopify/oauth";
import { getAppBaseUrl, normalizeShopDomain, invalidateShopifyConfigCache } from "@/lib/shopify/config";
import { shopify } from "@/lib/shopify/client";
import { log } from "@/lib/logger";
import { encryptCredential } from '@/lib/credential-crypto.mjs';

export async function GET(request: Request) {
  const session = await requireShopifySession();
  if (isUnauthorized(session)) return session;
  const url = new URL(request.url);
  const sp = url.searchParams;
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }
  if (!env.SHOPIFY_CLIENT_SECRET) {
    return NextResponse.json({ error: "SHOPIFY_CLIENT_SECRET is not set" }, { status: 500 });
  }
  if (!verifyOAuthHmac(sp, env.SHOPIFY_CLIENT_SECRET)) {
    log.warn("Shopify OAuth HMAC verification failed");
    return NextResponse.json({ error: "Invalid HMAC" }, { status: 400 });
  }
  const state = sp.get("state");
  const cookieStore = await cookies();
  const shop = normalizeShopDomain(sp.get("shop"));
  let want: { state?: string; accountId?: string; shop?: string } | null = null;
  try { want = JSON.parse(cookieStore.get(STATE_COOKIE)?.value ?? 'null'); } catch { /* invalid state */ }
  if (!state || !want || state !== want.state || want.accountId !== session.email || !shop || want.shop !== shop) {
    return NextResponse.json({ error: "Invalid or missing state" }, { status: 400 });
  }
  cookieStore.delete(STATE_COOKIE);
  const code = sp.get("code");
  if (!code || !shop) {
    return NextResponse.json({ error: "Missing code or shop" }, { status: 400 });
  }
  const redirect = getOAuthCallbackUrl();
  if (sp.get("redirect_uri") && sp.get("redirect_uri") !== redirect) {
    return NextResponse.json({ error: "redirect_uri mismatch" }, { status: 400 });
  }
  let token: string;
  try {
    const t = await exchangeCodeForToken(shop, code);
    token = t.access_token;
  } catch (e) {
    log.error("token exchange", { e });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Token exchange failed" },
      { status: 400 }
    );
  }
  // Fetch shop branding before persisting (token is now valid)
  let shopName: string | null = null;
  let shopLogoUrl: string | null = null;
  try {
    const info = await shopify.testConnection();
    shopName = info.shopName;
    shopLogoUrl = info.logoUrl;
  } catch (e) {
    log.warn("Could not fetch shop branding after OAuth", { e });
  }

  try {
    const encryptedToken = encryptCredential(token, `shopify:${shop}:access`);
    const existing = await prisma.appSetting.findFirst();
    if (existing) {
      await prisma.appSetting.update({
        where: { id: existing.id },
        data: {
          shopifyShopDomain: shop,
          shopifyAccessToken: encryptedToken,
          shopifyShopName: shopName,
          shopifyShopLogoUrl: shopLogoUrl,
          shopifyConnectedAt: new Date(),
          shopifyConnectedAppVersion: pkg.version,
        },
      });
    } else {
      await prisma.appSetting.create({
        data: {
          shopifyShopDomain: shop,
          shopifyAccessToken: encryptedToken,
          shopifyShopName: shopName,
          shopifyShopLogoUrl: shopLogoUrl,
          shopifyConnectedAt: new Date(),
          shopifyConnectedAppVersion: pkg.version,
        },
      });
    }
  } catch (e) {
    log.error("shopify oauth persist", { e });
    return NextResponse.json(
      { error: "Could not save connection (database unreachable?)" },
      { status: 503 }
    );
  }
  // Bust the server-level Shopify config cache so the new token is picked up immediately
  invalidateShopifyConfigCache();
  const to = new URL("/settings?shopify=connected", getAppBaseUrl());
  return NextResponse.redirect(to);
}
