import { normalizeShopDomain } from "./normalize";

export function shopifyNumericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const m = gid.match(/(\d+)\s*$/);
  return m?.[1] ?? null;
}

/** Admin deep link. `shop` is a myshopify domain. */
export function shopifyAdminUrl(
  shop: string | null | undefined,
  resource: "orders" | "products",
  gid: string | null | undefined,
): string | null {
  const id = shopifyNumericId(gid);
  const domain = normalizeShopDomain(shop);
  if (!id || !domain) return null;
  const handle = domain.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${handle}/${resource}/${id}`;
}
