import type { PriceChange } from './ebay-price';

export interface StoredPriceLine extends PriceChange {
  id: string;
  previewId: string;
  status: 'pending' | 'applying' | 'verified' | 'skipped' | 'failed';
  reason: string | null;
  verifiedCents: number | null;
}

export interface PriceLineStore {
  create(userEmail: string, previewId: string, changes: PriceChange[]): Promise<void>;
  list(previewId: string, userEmail: string): Promise<StoredPriceLine[] | null>;
  claim(id: string): Promise<boolean>;
  finish(id: string, status: StoredPriceLine['status'], reason: string | null, verifiedCents?: number | null): Promise<void>;
}

export interface ListedPrice {
  cents: number;
  currency: string;
  format: string;
}

export interface ReviseResult {
  ok: boolean;
  error?: string;
  inventoryManaged?: boolean;
}

export interface PriceGateway {
  readPrice(itemId: string, variationSku: string | null): Promise<ListedPrice>;
  reviseTrading(itemId: string, variationSku: string | null, priceCents: number): Promise<ReviseResult>;
  reviseInventory(itemId: string, variationSku: string, priceCents: number): Promise<ReviseResult>;
}

export interface PriceApplyCounts {
  updated: number;
  verified: number;
  skipped: number;
  failed: number;
  results: {
    itemId: string;
    variationSku: string | null;
    title: string;
    originalPrice: number;
    proposedPrice: number;
    outcome: string;
    reason: string | null;
    verifiedPrice: number | null;
  }[];
}

export interface PriceLogger {
  info(entry: Record<string, unknown>): void;
}

function outcomeLog(log: PriceLogger, line: StoredPriceLine, outcome: string, extra?: Record<string, unknown>) {
  log.info({
    listingId: line.itemId,
    variationSku: line.variationSku,
    oldPrice: line.originalPrice,
    newPrice: line.proposedPrice,
    timestamp: new Date().toISOString(),
    outcome,
    ...extra,
  });
}

export async function applyStoredPrices(
  store: PriceLineStore,
  gateway: PriceGateway,
  previewId: string,
  userEmail: string,
  log: PriceLogger,
  pause: () => Promise<void> = async () => {}
): Promise<PriceApplyCounts> {
  const lines = await store.list(previewId, userEmail);
  if (!lines) throw new Error('That preview is not for this seller account');
  if (lines.length === 0) throw new Error('No price preview with that id');
  const counts: PriceApplyCounts = { updated: 0, verified: 0, skipped: 0, failed: 0, results: [] };

  for (const line of lines) {
    if (line.status === 'verified' || line.status === 'skipped') {
      if (line.status === 'verified') counts.verified += 1;
      else counts.skipped += 1;
      counts.results.push(resultOf(line, line.status, line.reason, line.verifiedCents));
      continue;
    }

    if (line.status === 'applying') {
      try {
        const current = await gateway.readPrice(line.itemId, line.variationSku);
        await pause();
        if (current.currency === 'USD' && current.cents === line.proposedCents) {
          await store.finish(line.id, 'verified', 'Already at the previewed price', current.cents);
          counts.verified += 1;
          outcomeLog(log, line, 'verified', { reason: 'already applied' });
          counts.results.push(resultOf(line, 'verified', 'Already at the previewed price', current.cents / 100));
          continue;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Could not read the current price';
        counts.skipped += 1;
        counts.results.push(resultOf(line, 'skipped', reason, null));
        continue;
      }
    }

    const claimed = await store.claim(line.id);
    if (!claimed) {
      counts.skipped += 1;
      counts.results.push(resultOf(line, 'skipped', 'This change is already being applied', null));
      continue;
    }

    try {
      const current = await gateway.readPrice(line.itemId, line.variationSku);
      await pause();
      if (/auction|chinese/i.test(current.format)) {
        await store.finish(line.id, 'skipped', 'Auction listings are skipped');
        counts.skipped += 1;
        outcomeLog(log, line, 'skipped', { reason: 'auction' });
        counts.results.push(resultOf(line, 'skipped', 'Auction listings are skipped', null));
        continue;
      }
      if (current.currency !== 'USD') {
        await store.finish(line.id, 'skipped', `Currency ${current.currency} is not USD`);
        counts.skipped += 1;
        counts.results.push(resultOf(line, 'skipped', `Currency ${current.currency} is not USD`, null));
        continue;
      }
      if (current.cents === line.proposedCents) {
        await store.finish(line.id, 'verified', 'Already at the previewed price', current.cents);
        counts.verified += 1;
        outcomeLog(log, line, 'verified', { reason: 'already applied' });
        counts.results.push(resultOf(line, 'verified', 'Already at the previewed price', current.cents / 100));
        continue;
      }
      if (current.cents !== line.originalCents) {
        const reason = `Price is now ${current.cents / 100}, not the previewed ${line.originalPrice}`;
        await store.finish(line.id, 'skipped', reason, current.cents);
        counts.skipped += 1;
        outcomeLog(log, line, 'skipped', { reason: 'stale', currentPrice: current.cents / 100 });
        counts.results.push(resultOf(line, 'skipped', reason, current.cents / 100));
        continue;
      }

      let revised = await gateway.reviseTrading(line.itemId, line.variationSku, line.proposedCents);
      if (!revised.ok && revised.inventoryManaged) {
        const sku = line.variationSku || line.listingSku;
        revised = sku
          ? await gateway.reviseInventory(line.itemId, sku, line.proposedCents)
          : { ok: false, error: 'This listing is managed by the Inventory API and has no SKU, so the price was not changed' };
      }
      await pause();
      if (!revised.ok) {
        await store.finish(line.id, 'failed', revised.error ?? 'eBay did not change the price');
        counts.failed += 1;
        outcomeLog(log, line, 'failed', { reason: revised.error ?? 'revise failed' });
        counts.results.push(resultOf(line, 'failed', revised.error ?? 'eBay did not change the price', null));
        continue;
      }

      const after = await gateway.readPrice(line.itemId, line.variationSku);
      if (after.cents === line.proposedCents) {
        await store.finish(line.id, 'verified', null, after.cents);
        counts.updated += 1;
        counts.verified += 1;
        outcomeLog(log, line, 'updated', { verifiedPrice: after.cents / 100 });
        counts.results.push(resultOf(line, 'verified', null, after.cents / 100));
      } else {
        const reason = `eBay still shows ${after.cents / 100} after the update`;
        await store.finish(line.id, 'failed', reason, after.cents);
        counts.failed += 1;
        outcomeLog(log, line, 'failed', { reason });
        counts.results.push(resultOf(line, 'failed', reason, after.cents / 100));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Price update failed';
      await store.finish(line.id, 'failed', reason);
      counts.failed += 1;
      outcomeLog(log, line, 'failed', { reason });
      counts.results.push(resultOf(line, 'failed', reason, null));
    }
  }

  return counts;
}

function resultOf(line: StoredPriceLine, outcome: string, reason: string | null, verifiedPrice: number | null) {
  return {
    itemId: line.itemId,
    variationSku: line.variationSku,
    title: line.title,
    originalPrice: line.originalPrice,
    proposedPrice: line.proposedPrice,
    outcome,
    reason,
    verifiedPrice,
  };
}
