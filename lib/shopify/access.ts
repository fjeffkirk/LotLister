/** Store access is separate from permission to use the personal eBay/Etsy workspace.
 * Use immutable eBay account IDs (the session subject), never client-supplied names.
 * An unset allowlist intentionally grants nobody access to this install's Shopify store.
 */
export function isShopifyAccountAllowed(accountId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowed = (env.SHOPIFY_ALLOWED_ACCOUNT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  return Boolean(accountId) && allowed.includes(accountId);
}
