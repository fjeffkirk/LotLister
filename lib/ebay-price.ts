/** Price math and eBay listing parsing. No network and no tokens. */

import { decodeXml } from './ebay';

/** Categories LotLister itself lists into. Leaf names are classified from the category name eBay returns. */
const CERTAIN_CARD_CATEGORY_IDS = new Set(['261328', '183454', '183050']);

export type CardCategory = 'card' | 'uncertain' | 'other';

export interface ListingVariation {
  id: string;
  sku: string | null;
  price: number;
  currency: string;
}

export interface ActiveListing {
  itemId: string;
  title: string;
  price: number;
  currency: string;
  format: string;
  categoryId: string;
  categoryName: string;
  sku: string | null;
  variations: ListingVariation[];
  url: string;
}

export interface PriceChange {
  itemId: string;
  variationSku: string | null;
  listingSku: string | null;
  title: string;
  currency: string;
  originalPrice: number;
  proposedPrice: number;
  originalCents: number;
  proposedCents: number;
}

export interface PriceExclusion {
  itemId: string;
  variationSku: string | null;
  title: string;
  reason: string;
}

export function centsFromUsd(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('Price is not a number');
  return Math.round((amount + Number.EPSILON) * 100);
}

export function centsFromMoneyString(value: string): number | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const dollars = Number(match[2]);
  const frac = (match[3] ?? '').padEnd(2, '0');
  return sign * (dollars * 100 + Number(frac));
}

export function formatUsdFromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Reduce by percentOff. 10 means 10% off. Rounded to the nearest cent with half-up. */
export function reducedCents(originalCents: number, percentOff: number): number {
  if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff >= 100) {
    throw new Error('percentOff must be greater than 0 and less than 100');
  }
  const keepBps = Math.round((100 - percentOff) * 100);
  return Math.round((originalCents * keepBps) / 10000);
}

export function meetsMinimum(originalCents: number, minimumCents: number): boolean {
  return originalCents >= minimumCents;
}

export function classifyCardCategory(categoryId: string, categoryName: string): CardCategory {
  if (CERTAIN_CARD_CATEGORY_IDS.has(categoryId.trim())) return 'card';
  const name = categoryName.trim();
  if (/\b(trading cards?|sports trading cards?|collectible card games?|non-sport trading cards?)\b/i.test(name)) return 'card';
  if (/\bcards?\b/i.test(name)) return 'uncertain';
  if (!categoryId.trim() && !name) return 'uncertain';
  return 'other';
}

export function isAuctionFormat(format: string): boolean {
  return /^(chinese|auction|personaloffer)$/i.test(format.trim());
}

export function isFixedPriceFormat(format: string): boolean {
  return /^(fixedpriceitem|storesfixedprice)$/i.test(format.trim());
}

export function proposePriceChanges(
  listings: ActiveListing[],
  input: { percentOff: number; minimumCents: number; tradingCardsOnly: boolean; listingIds?: Set<string> }
): { changes: PriceChange[]; exclusions: PriceExclusion[] } {
  const changes: PriceChange[] = [];
  const exclusions: PriceExclusion[] = [];
  const wanted = input.listingIds;

  for (const listing of listings) {
    if (wanted && !wanted.has(listing.itemId)) continue;
    const targets = listing.variations.length
      ? listing.variations.map((variation) => ({
          variationSku: variation.sku,
          variationId: variation.id,
          price: variation.price,
          currency: variation.currency || listing.currency,
          missingSku: !variation.sku,
        }))
      : [{ variationSku: null as string | null, variationId: null as string | null, price: listing.price, currency: listing.currency, missingSku: false }];

    if (isAuctionFormat(listing.format)) {
      exclusions.push({ itemId: listing.itemId, variationSku: null, title: listing.title, reason: 'Auction listings are skipped' });
      continue;
    }
    if (!isFixedPriceFormat(listing.format)) {
      exclusions.push({
        itemId: listing.itemId,
        variationSku: null,
        title: listing.title,
        reason: `Listing format ${listing.format || 'unknown'} is not a fixed-price listing`,
      });
      continue;
    }

    const card = classifyCardCategory(listing.categoryId, listing.categoryName);
    if (input.tradingCardsOnly && card === 'other') {
      exclusions.push({ itemId: listing.itemId, variationSku: null, title: listing.title, reason: 'Category is not a trading-card category' });
      continue;
    }
    if (input.tradingCardsOnly && card === 'uncertain') {
      exclusions.push({
        itemId: listing.itemId,
        variationSku: null,
        title: listing.title,
        reason: `Uncertain category ${listing.categoryId || 'unknown'}${listing.categoryName ? ` (${listing.categoryName})` : ''}. Not discounted.`,
      });
      continue;
    }

    for (const target of targets) {
      if (target.missingSku) {
        exclusions.push({
          itemId: listing.itemId,
          variationSku: null,
          title: listing.title,
          reason: `Variation ${target.variationId || 'without a SKU'} cannot be revised individually`,
        });
        continue;
      }
      if (target.currency !== 'USD') {
        exclusions.push({
          itemId: listing.itemId,
          variationSku: target.variationSku,
          title: listing.title,
          reason: `Currency ${target.currency || 'unknown'} is not USD`,
        });
        continue;
      }
      const originalCents = centsFromUsd(target.price);
      if (!meetsMinimum(originalCents, input.minimumCents)) {
        exclusions.push({
          itemId: listing.itemId,
          variationSku: target.variationSku,
          title: listing.title,
          reason: `Price ${formatUsdFromCents(originalCents)} is below the minimum`,
        });
        continue;
      }
      const proposedCents = reducedCents(originalCents, input.percentOff);
      changes.push({
        itemId: listing.itemId,
        variationSku: target.variationSku,
        listingSku: listing.sku,
        title: listing.title,
        currency: 'USD',
        originalPrice: originalCents / 100,
        proposedPrice: proposedCents / 100,
        originalCents,
        proposedCents,
      });
    }
  }

  return { changes, exclusions };
}

function tag(block: string, name: string): string {
  return decodeXml(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? '');
}

function moneyTag(block: string, name: string): { amount: number; cents: number; currency: string } | null {
  const match = block.match(new RegExp(`<${name}([^>]*)>([^<]*)</${name}>`));
  if (!match) return null;
  const cents = centsFromMoneyString(match[2]);
  if (cents == null) return null;
  const currency = match[1].match(/currencyID="([^"]+)"/)?.[1] ?? 'USD';
  return { amount: cents / 100, cents, currency };
}

export function parseActiveListingsXml(xml: string): { listings: ActiveListing[]; total: number; totalPages: number } {
  const active = xml.match(/<ActiveList>([\s\S]*?)<\/ActiveList>/)?.[1] ?? '';
  const total = Number(tag(active, 'TotalNumberOfEntries') || '0');
  const totalPages = Number(tag(active, 'TotalNumberOfPages') || '0');
  const listings: ActiveListing[] = [];
  for (const match of active.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
    const item = match[1];
    const itemId = tag(item, 'ItemID');
    if (!itemId) continue;
    const variationBlock = item.match(/<Variations>([\s\S]*?)<\/Variations>/)?.[1] ?? '';
    const parent = item.replace(/<Variations>[\s\S]*?<\/Variations>/, '');
    const price = moneyTag(parent, 'CurrentPrice') ?? moneyTag(parent, 'StartPrice');
    const variations: ListingVariation[] = [];
    for (const variationMatch of variationBlock.matchAll(/<Variation>([\s\S]*?)<\/Variation>/g)) {
      const body = variationMatch[1];
      const sku = tag(body, 'SKU') || null;
      const variationPrice = moneyTag(body, 'StartPrice') ?? moneyTag(body, 'CurrentPrice');
      variations.push({
        id: sku || `${itemId}#${variations.length + 1}`,
        sku,
        price: variationPrice?.amount ?? 0,
        currency: variationPrice?.currency ?? price?.currency ?? 'USD',
      });
    }
    const category = item.match(/<PrimaryCategory>([\s\S]*?)<\/PrimaryCategory>/)?.[1] ?? '';
    listings.push({
      itemId,
      title: tag(item, 'Title'),
      price: price?.amount ?? 0,
      currency: price?.currency ?? 'USD',
      format: tag(item, 'ListingType'),
      categoryId: tag(category, 'CategoryID'),
      categoryName: tag(category, 'CategoryName'),
      sku: tag(parent, 'SKU') || null,
      variations,
      url: `https://www.ebay.com/itm/${itemId}`,
    });
  }
  return { listings, total: Number.isFinite(total) ? total : listings.length, totalPages: Number.isFinite(totalPages) ? totalPages : 1 };
}

export function parseItemPriceXml(xml: string, variationSku: string | null): { cents: number; currency: string; format: string } {
  const item = xml.match(/<Item>([\s\S]*?)<\/Item>/)?.[1] ?? xml;
  const format = tag(item, 'ListingType');
  const variationBlock = item.match(/<Variations>([\s\S]*?)<\/Variations>/)?.[1] ?? '';
  if (variationSku) {
    for (const variationMatch of variationBlock.matchAll(/<Variation>([\s\S]*?)<\/Variation>/g)) {
      const body = variationMatch[1];
      if (tag(body, 'SKU') !== variationSku) continue;
      const price = moneyTag(body, 'StartPrice') ?? moneyTag(body, 'CurrentPrice');
      if (!price) throw new Error('eBay did not return that variation price');
      return { cents: price.cents, currency: price.currency, format };
    }
    throw new Error('eBay did not return that variation');
  }
  const parent = item.replace(/<Variations>[\s\S]*?<\/Variations>/, '');
  const price = moneyTag(parent, 'CurrentPrice') ?? moneyTag(parent, 'StartPrice');
  if (!price) throw new Error('eBay did not return the current price');
  return { cents: price.cents, currency: price.currency, format };
}

export function pageFromCursor(cursor?: string | null): number {
  if (!cursor) return 1;
  if (!/^[1-9]\d{0,4}$/.test(cursor)) throw new Error('Page cursor is not valid');
  return Number(cursor);
}

export function nextPageCursor(page: number, totalPages: number): { cursor: string | null; hasMore: boolean } {
  const hasMore = page < totalPages;
  return { hasMore, cursor: hasMore ? String(page + 1) : null };
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trading ReviseInventoryStatus body that sets price and nothing else. */
export function reviseInventoryStatusXml(updates: { itemId: string; sku?: string | null; priceCents: number }[]): string {
  const blocks = updates.map((update) => {
    if (!/^\d+$/.test(update.itemId)) throw new Error('Listing id is not an eBay item id');
    const sku = update.sku ? `<SKU>${xmlEscape(update.sku)}</SKU>` : '';
    return `<InventoryStatus><ItemID>${update.itemId}</ItemID>${sku}<StartPrice currencyID="USD">${formatUsdFromCents(update.priceCents)}</StartPrice></InventoryStatus>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  ${blocks.join('\n  ')}
</ReviseInventoryStatusRequest>`;
}

export interface InventoryOffer {
  offerId?: string;
  status?: string;
  listing?: { listingId?: string };
}

/** Prefer the offer for this eBay item. Otherwise the published offer. */
export function selectInventoryOffer(offers: InventoryOffer[], itemId: string): string | null {
  const usable = offers.filter((offer) => offer.offerId);
  const matched = usable.find((offer) => offer.listing?.listingId === itemId);
  if (matched?.offerId) return matched.offerId;
  const published = usable.find((offer) => offer.status === 'PUBLISHED');
  return published?.offerId ?? usable[0]?.offerId ?? null;
}

export function inventoryUpdateError(status: number, body: unknown): string | null {
  if (status === 403) return 'Sign in with eBay again in LotLister to change prices on Inventory API listings.';
  const responses = body && typeof body === 'object' && 'responses' in body
    ? (body as { responses?: { statusCode?: number; errors?: { message?: string; longMessage?: string }[] }[] }).responses
    : undefined;
  const failed = responses?.find((row) => (row.statusCode ?? 200) >= 400 || (row.errors?.length ?? 0) > 0);
  const message = failed?.errors?.[0]?.longMessage || failed?.errors?.[0]?.message;
  if (failed) return message || `eBay Inventory API rejected the price (${failed.statusCode ?? status})`;
  if (status >= 400) return `eBay Inventory API rejected the price (${status})`;
  return null;
}

export function inventoryPriceBody(sku: string, offerId: string, priceCents: number): string {
  return JSON.stringify({
    requests: [{
      sku,
      offers: [{ offerId, price: { value: formatUsdFromCents(priceCents), currency: 'USD' } }],
    }],
  });
}
