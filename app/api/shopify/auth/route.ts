import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthorizeUrl } from "@/lib/shopify/oauth";
import { hasOauthClientCredentials } from "@/lib/shopify/config";
import { env } from "@/lib/env";
import { STATE_COOKIE, MAX_AGE_SEC } from "@/lib/shopify/oauth";
import { normalizeShopDomain } from "@/lib/shopify/normalize";

/**
 * Start OAuth: GET /api/shopify/auth?shop=your-store.myshopify.com
 */
export async function GET(request: Request) {
  if (!env.databaseConfigured) {
    return NextResponse.json(
      { error: "Database required to store the OAuth access token. Set DATABASE_URL." },
      { status: 400 }
    );
  }
  if (!hasOauthClientCredentials()) {
    return NextResponse.json(
      { error: "Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env" },
      { status: 400 }
    );
  }
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const s = normalizeShopDomain(shop);
  if (!s) {
    return NextResponse.json(
      { error: "Missing or invalid ?shop= (e.g. your-store.myshopify.com)" },
      { status: 400 }
    );
  }
  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SEC,
    path: "/",
  });
  const authorize = buildAuthorizeUrl(s, state);
  return NextResponse.redirect(authorize);
}
