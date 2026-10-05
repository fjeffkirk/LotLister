import { z } from 'zod';
import { rangeToDates, type DateRangeKey } from '../../dates';
import { getDashboardData } from '../../ebay-dashboard';
import { centsFromUsd, proposePriceChanges } from '../../ebay-price';
import { applyStoredPrices } from '../../ebay-price-apply';
import { listActiveListingPage, listActiveListings, priceGateway } from '../../ebay-price-live';
import { newPreviewId, prismaPriceStore } from '../../ebay-price-store';
import { registerTool } from '../registry';

const rangeSchema = z.object({
  range: z.enum(['1d', '7d', '30d', '90d']).optional(),
});

export const listingArgsSchema = z.object({
  limit: z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? undefined : value),
    z.coerce.number().int().min(1).max(200).optional()
  ),
  cursor: z.string().min(1).max(20).optional(),
});

const listingInputSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 200, description: 'How many active listings to return. Default 100. Maximum 200.' },
    cursor: { type: 'string', description: 'Cursor from the previous page. Omit to start at the first page.' },
  },
  additionalProperties: false,
};

const previewSchema = z.object({
  listingIds: z.array(z.string().regex(/^\d+$/)).max(500).optional(),
  percentOff: z.coerce.number().positive().lt(100),
  minimumCurrentPrice: z.coerce.number().nonnegative(),
  tradingCardsOnly: z.boolean().optional(),
});

const previewInputSchema = {
  type: 'object',
  properties: {
    listingIds: { type: 'array', items: { type: 'string' }, description: 'eBay item ids. Omit to scan active listings with the filters.' },
    percentOff: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 100, description: 'Percent to subtract. 10 reduces a price by 10%.' },
    minimumCurrentPrice: { type: 'number', minimum: 0, description: 'Include listings whose current price is this amount or higher. 30 includes $30.00.' },
    tradingCardsOnly: { type: 'boolean', description: 'When true, only categories identified as trading cards are included. Uncertain categories are excluded and reported.' },
  },
  required: ['percentOff', 'minimumCurrentPrice'],
  additionalProperties: false,
};

function listingPayload(listing: Awaited<ReturnType<typeof listActiveListingPage>>['listings'][number]) {
  return {
    listingId: listing.itemId,
    title: listing.title,
    price: listing.price,
    currency: listing.currency,
    format: listing.format,
    categoryId: listing.categoryId,
    categoryName: listing.categoryName,
    sku: listing.sku,
    variations: listing.variations.map((variation) => ({
      variationId: variation.id,
      sku: variation.sku,
      price: variation.price,
      currency: variation.currency,
    })),
    url: listing.url,
  };
}

registerTool({
  name: 'ebay_listings_get',
  description: 'Read active eBay listings for the connected seller, one page at a time. Returns listing id, title, price, currency, format, category, SKU, variations, and URL. Pass the returned cursor to get the next page. Does not change listings.',
  effect: 'read',
  inputSchema: listingInputSchema,
  async handler(ctx, args) {
    const { limit, cursor } = listingArgsSchema.parse(args ?? {});
    const page = await listActiveListingPage(ctx.accountId, { limit, cursor });
    return {
      account: page.account,
      total: page.total,
      cursor: page.cursor,
      hasMore: page.hasMore,
      listings: page.listings.map(listingPayload),
    };
  },
});

registerTool({
  name: 'ebay_prices_preview',
  description: 'Preview eBay price reductions for the connected seller. Does not change any listing. Minimum price is applied before the discount, so a $30 minimum includes listings priced exactly $30. Returns a previewId that apply can use once.',
  effect: 'read',
  inputSchema: previewInputSchema,
  async handler(ctx, args) {
    const input = previewSchema.parse(args ?? {});
    const listingIds = input.listingIds ? new Set(input.listingIds) : undefined;
    const scanned = await listActiveListings(ctx.accountId, listingIds);
    const proposed = proposePriceChanges(scanned.listings, {
      percentOff: input.percentOff,
      minimumCents: centsFromUsd(input.minimumCurrentPrice),
      tradingCardsOnly: input.tradingCardsOnly === true,
      listingIds,
    });
    const previewId = proposed.changes.length ? newPreviewId() : null;
    if (previewId) await prismaPriceStore().create(ctx.accountId, previewId, proposed.changes);
    return {
      previewId,
      percentOff: input.percentOff,
      minimumCurrentPrice: input.minimumCurrentPrice,
      tradingCardsOnly: input.tradingCardsOnly === true,
      truncated: scanned.truncated,
      changes: proposed.changes.map((change) => ({
        listingId: change.itemId,
        variationSku: change.variationSku,
        title: change.title,
        originalPrice: change.originalPrice,
        proposedPrice: change.proposedPrice,
        currency: change.currency,
      })),
      exclusions: proposed.exclusions.map((row) => ({
        listingId: row.itemId,
        variationSku: row.variationSku,
        title: row.title,
        reason: row.reason,
      })),
    };
  },
});

registerTool({
  name: 'ebay_prices_apply',
  description: 'Apply one eBay price preview for the connected seller. Uses Trading API ReviseInventoryStatus, which changes only price, because LotLister creates listings with Trading API AddItem. Inventory API listings are revised through that API when eBay says the listing is inventory-managed. The same preview is not discounted twice. Does not publish, end, or otherwise edit listings.',
  effect: 'price',
  inputSchema: {
    type: 'object',
    properties: { previewId: { type: 'string', description: 'previewId returned by ebay_prices_preview.' } },
    required: ['previewId'],
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { previewId } = z.object({ previewId: z.string().min(8).max(80) }).parse(args ?? {});
    const counts = await applyStoredPrices(
      prismaPriceStore(),
      priceGateway(ctx.accountId),
      previewId,
      ctx.accountId,
      { info: (entry) => console.info(JSON.stringify({ source: 'ebay-price', ...entry })) },
      () => new Promise((resolve) => setTimeout(resolve, 200))
    );
    return { previewId, ...counts };
  },
});

registerTool({
  name: 'ebay_sales_get',
  description: 'Read eBay sales for a recent range: gross, net after fees, orders, and the latest sales. Does not change listings.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { range: { type: 'string', enum: ['1d', '7d', '30d', '90d'], description: 'Defaults to 30d.' } },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const { range } = rangeSchema.pick({ range: true }).parse(args);
    const key = (range ?? '30d') as DateRangeKey;
    const window = { ...rangeToDates(key), key };
    const data = await getDashboardData(ctx.accountId, 0, window);
    if (data.sales.status !== 'ok') throw new Error(data.sales.message || 'eBay sales are not available');
    const focus = data.sales.data.focus ?? data.sales.data.ranges['30'];
    return {
      account: data.account,
      range: key,
      gross: focus.summary.gross,
      net: focus.summary.net,
      fees: focus.summary.fees,
      refunds: focus.summary.refunds,
      orders: focus.summary.orders,
      units: focus.summary.units,
      recent: data.sales.data.recent.slice(0, 8).map((sale) => ({
        title: sale.title,
        price: sale.price,
        quantity: sale.quantity,
        soldAt: sale.soldAt,
        player: sale.player,
      })),
    };
  },
});
