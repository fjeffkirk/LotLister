/** Client-safe: no server / DB imports. */
export function normalizeShopDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.replace(/^https?:\/\//, "").split("/")[0] ?? raw;
  s = s.toLowerCase().trim();
  if (!s.endsWith(".myshopify.com") && !s.includes(".")) {
    s = `${s}.myshopify.com`;
  }
  return s;
}
