import { startBackgroundIndexer } from '@/lib/sync/background-indexer';

/** Arms the in-process Shopify catch-up. Safe to render on every request. */
export function ShopifyIndexer() {
  startBackgroundIndexer();
  return null;
}
