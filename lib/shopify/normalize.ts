/** Client-safe: no server / DB imports. */
export function normalizeShopDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  // OAuth sends a client secret to this host. Reject userinfo, ports, paths,
  // arbitrary domains and lookalike suffixes before any outbound request.
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/.test(s) ? s : '';
}
