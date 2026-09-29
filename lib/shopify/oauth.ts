import crypto from "node:crypto";
import { env } from "@/lib/env";
import { getAppBaseUrl } from "./config";
import { normalizeShopDomain } from "./normalize";

const STATE_COOKIE = "shopify_oauth_state";
const MAX_AGE_SEC = 600;

export { STATE_COOKIE, MAX_AGE_SEC };

function defaultScopes() {
  return (
    env.SHOPIFY_SCOPES ||
    "read_products,read_orders,read_inventory,read_locations,read_fulfillments,read_merchant_managed_fulfillment_orders,read_assigned_fulfillment_orders,read_third_party_fulfillment_orders,read_analytics"
  );
}

export function getOAuthCallbackUrl() {
  return `${getAppBaseUrl()}/api/shopify/auth/callback`;
}

export function buildAuthorizeUrl(shop: string, state: string) {
  const s = normalizeShopDomain(shop);
  if (!s || !env.SHOPIFY_CLIENT_ID) {
    throw new Error("Invalid shop or SHOPIFY_CLIENT_ID is missing");
  }
  const p = new URLSearchParams();
  p.set("client_id", env.SHOPIFY_CLIENT_ID!);
  p.set("scope", defaultScopes());
  p.set("redirect_uri", getOAuthCallbackUrl());
  p.set("state", state);
  p.set("response_type", "code");
  return `https://${s}/admin/oauth/authorize?${p.toString()}`;
}

/**
 * @see https://shopify.dev/docs/apps/auth/oauth/getting-started#step-1-verify-a-redirect
 */
export function verifyOAuthHmac(query: URLSearchParams, clientSecret: string): boolean {
  const hmac = query.get("hmac");
  if (!hmac) return false;
  const keys = Array.from(query.keys())
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort();
  const message = keys
    .map((k) => {
      const v = query.getAll(k);
      return `${k}=${v[0] ?? ""}`;
    })
    .join("&");
  const digest = crypto.createHmac("sha256", clientSecret).update(message).digest("hex");
  if (digest.length !== hmac.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, "utf8"), Buffer.from(hmac, "utf8"));
  } catch {
    return false;
  }
}

export type TokenExchangeResult = { access_token: string; scope?: string };

export async function exchangeCodeForToken(shop: string, code: string): Promise<TokenExchangeResult> {
  const s = normalizeShopDomain(shop);
  if (!s || !env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
    throw new Error("Shop or OAuth client credentials are missing");
  }
  const res = await fetch(`https://${s}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      code,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${t.slice(0, 200)}`);
  }
  return (await res.json()) as TokenExchangeResult;
}
